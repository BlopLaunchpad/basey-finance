/* ===========================================================================
   PRUEBA DE LA COMPRA ATOMICA, CONTRA EL ESTADO REAL DE ARC Y SIN FIRMAR NADA.

     node tools/probar-compra-atomica.mjs

   Lo que corre es EL CODIGO DE LA PAGINA, no una copia:
     - lanzarConCompraAtomica e idsDelRecibo se sacan de app.js y se ejecutan;
     - el plan sale de plan.js y el contrato de compra-atomica.js;
     - el token es el que genera solidity.js, compilado con el mismo solc
       0.8.24+commit.e11b9ed9 y los mismos ajustes que el navegador.

   Lo unico falso es la cartera: cada firma se apunta como una llamada, y al
   desplegar el lanzador se ejecuta TODO con eth_simulateV1 sobre un nodo real de
   Arc (el USDC de Arc es el gas y va por un precompilado, asi que un fork de
   anvil NO sirve: ahi un transfer de USDC falla). Nada se envia a la cadena.

   Escenarios:
     A y B  lanzamiento atomico con el token por debajo y por encima de USDC
            (cambia quien es token0, y con ello el lado del muro y el signo);
     C      alguien crea la pool antes a otro precio: el lanzador REVIERTE y el
            creador no pierde nada;
     D      la cartera manda otra transaccion entre medias: se para ANTES de
            desplegar.

   Entorno: NODO (por defecto https://arc.drpc.org, el unico que acepta
   eth_simulateV1 de los medidos el 17-sep), SOLC (ruta al binario 0.8.24),
   ETHERS_PATH. =========================================================== */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
function cargarEthers() {
  const sitios = [process.env.ETHERS_PATH, "ethers",
    path.join(raiz, "..", "cusp-web", "node_modules", "ethers"),
    path.join(raiz, "..", "blop-indexer", "node_modules", "ethers")].filter(Boolean);
  for (const s of sitios) { try { return require(s); } catch { /* el siguiente */ } }
  throw new Error("ethers not found — set ETHERS_PATH");
}
const { ethers } = cargarEthers();
const importar = (f) => import(pathToFileURL(path.join(raiz, f)).href);
const PLANJS = await importar("plan.js");
const { COMPRA_ATOMICA_SOURCE } = await importar("compra-atomica.js");
const { generateSource } = await importar("solidity.js");
const { ARC, QUOTE, FEATURES } = await importar("token-features.js");

const NODO = process.env.NODO || "https://arc.drpc.org";
/* El que instala foundry (svm) se llama sin .exe aunque sea de Windows. */
const SOLC = process.env.SOLC || [".exe", ""].map((ext) => path.join(process.env.APPDATA || "", "svm", "0.8.24", "solc-0.8.24" + ext))
  .find((f) => fs.existsSync(f));
if (!SOLC) throw new Error("solc 0.8.24 not found — set SOLC");
const APP = fs.readFileSync(path.join(raiz, "app.js"), "utf8");

/* ── sacar funciones y constantes de app.js ── */
function extraer(cabecera) {
  const i = APP.indexOf(cabecera);
  if (i < 0 || APP.indexOf(cabecera, i + 1) >= 0) throw new Error("header missing or repeated: " + cabecera);
  const m = APP.slice(i).match(/\r?\n\}\r?\n/);
  if (!m) throw new Error("end not found: " + cabecera);
  return APP.slice(i, i + m.index + m[0].length);
}
const constante = (nombre) => {
  const m = APP.match(new RegExp("^const " + nombre + " = (.+);\\r?$", "m"));
  if (!m) throw new Error("const missing: " + nombre);
  return m[0];
};
const AYUDAS = [
  constante("MIN_TICK"),   // la misma linea declara MAX_TICK
  constante("MIN_SQRT_RATIO"), constante("MAX_SQRT_RATIO"),
  constante("ARC_SWAP_ROUTER"),
  extraer("function sortPair("), extraer("function ratioRaw("), extraer("function sqrtPriceX96From("),
  extraer("function apartarDelPrecio("), extraer("function tickFromPrice("), extraer("function usable("),
  extraer("function idsDelRecibo("), extraer("function idDelRecibo("),
  extraer("async function lanzarConCompraAtomica("),
].join("\n");
assert.match(AYUDAS, /tokensBought/, "lanzarConCompraAtomica extracted whole");

/* ── compilar como el navegador ── */
function compilar(fuente) {
  const entrada = JSON.stringify({
    language: "Solidity", sources: { "Token.sol": { content: fuente } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  });
  const tmp = path.join(os.tmpdir(), "probar-compra-atomica-" + process.pid + ".json");
  fs.writeFileSync(tmp, entrada);
  const out = JSON.parse(execFileSync(SOLC, ["--standard-json", tmp], { maxBuffer: 64e6 }).toString());
  fs.unlinkSync(tmp);
  const errores = (out.errors || []).filter((e) => e.severity === "error");
  if (errores.length) throw new Error(errores.map((e) => e.formattedMessage).join("\n"));
  const avisos = (out.errors || []).filter((e) => e.severity === "warning");
  return { file: out.contracts["Token.sol"], avisos };
}
const LANZADOR = compilar(COMPRA_ATOMICA_SOURCE);
assert.equal(LANZADOR.avisos.length, 0, "the launcher compiles without warnings");

/* ── el nodo ── */
let peticiones = 0;
async function rpc(method, params) {
  peticiones++;
  const r = await fetch(NODO, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error).slice(0, 300));
  return j.result;
}
const hex = (n) => "0x" + BigInt(n).toString(16);
/* El texto de un revert Error(string), si lo trae. */
function motivo(datos) {
  try {
    if (datos && datos.startsWith("0x08c379a0")) return ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + datos.slice(10))[0];
  } catch { /* no era un Error(string) */ }
  return datos || "";
}
const MIL_USDC_NATIVO = hex(1000n * 10n ** 18n);   // en Arc el saldo nativo ES el USDC

/* Ejecuta una lista de llamadas en orden sobre el ultimo bloque. */
/* Sin `gas` por llamada: con 8M en cada una, cuatro llamadas pasan del gas de un
 * bloque y drpc contesta "Temporary internal error" en vez de decirlo. Se deja
 * que el nodo ponga el suyo, y un error temporal se reintenta dos veces. */
/* Y sin gas explicito tampoco: detras de drpc hay varios nodos con topes
 * distintos, y crear una pool V3 cuesta ~5 M. En uno salia bien y en otro el
 * mismo lanzamiento revertia con "0x" (sin gas). Asi que gas justo por tipo,
 * sumando por debajo del bloque: desplegar 12 M, lo demas 400 k. */
async function simular(llamadas, saldos) {
  const stateOverrides = {};
  for (const a of saldos) stateOverrides[a] = { balance: MIL_USDC_NATIVO };
  const conGas = llamadas.map((c) => ({ ...c, gas: hex(c.gas || (c.to ? 400_000 : 8_000_000)) }));
  const params = [{ blockStateCalls: [{ stateOverrides, calls: conGas }], validation: false }, "latest"];
  for (let intento = 1; ; intento++) {
    try {
      const res = await rpc("eth_simulateV1", params);
      return res[0].calls;
    } catch (e) {
      if (intento >= 3 || !/Temporary internal error/.test(e.message)) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * intento));
    }
  }
}
const leerCon = (abi) => new ethers.Interface(abi);
const ERC20 = leerCon(["function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const NPM = leerCon(["function balanceOf(address) view returns (uint256)", "function ownerOf(uint256) view returns (address)",
  "function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)",
  "function createAndInitializePoolIfNecessary(address,address,uint24,uint160) returns (address)"]);
const FAB = leerCon(["function getPool(address,address,uint24) view returns (address)"]);
const POOL = leerCon(["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"]);

/* ── un escenario ── */
async function escenario({ nombre, tokenDebajo, atacante, nonceCambia }) {
  console.log("\n== " + nombre);
  /* Una cartera nueva cuyo token (su primer despliegue) quede del lado pedido de USDC. */
  let cuenta, tokenDir;
  for (let i = 1; ; i++) {
    cuenta = ethers.getAddress("0x" + (0xa11ce000 + i + (tokenDebajo ? 0 : 5000)).toString(16).padStart(40, "0"));
    tokenDir = ethers.getCreateAddress({ from: cuenta, nonce: 0 });
    if ((tokenDir.toLowerCase() < QUOTE.address.toLowerCase()) === tokenDebajo) break;
  }
  const noncePrimero = Number(await rpc("eth_getTransactionCount", [cuenta, "latest"]));
  assert.equal(noncePrimero, 0, "fresh test wallet");

  /* El plan de la pagina, tal cual. */
  const PLAN = PLANJS.planPorDefecto();
  PLAN.símbolo = "ATOM";
  PLAN.compra.usdc = 25;
  const cfg = {
    name: "Atomic Test", symbol: PLAN.símbolo, supply: String(PLAN.supply), decimals: 18,
    ownership: "keep", metaMode: "inline", metaMutable: true, metaImage: "", metaDescription: "",
    metaWebsite: "", metaTwitter: "", metaTelegram: "",
    taxBps: 0, taxCeilingBps: 1000, maxSupply: "0", maxTxAmount: "0", maxWalletAmount: "0",
  };
  for (const f of FEATURES) cfg[f.id] = false;
  const tokenC = compilar(generateSource(cfg)).file[PLAN.símbolo];
  const DEC = 18;
  const r = PLANJS.resumen(PLAN);
  assert.equal(r.posiciones.length, 1, "one wall");

  /* La cadena simulada: cada firma es una llamada. */
  const llamadas = [{ from: cuenta, data: "0x" + tokenC.evm.bytecode.object }];
  const saldos = [cuenta];
  if (atacante) {
    const sAt = ethers.getAddress("0x00000000000000000000000000000000bad0c0de");
    saldos.push(sAt);
  }

  const fn = new Function("ethers", "PLAN", "QUOTE", "ARC", "ERC20_ABI", "account", "signer", "provider", "compileAll", "COMPRA_ATOMICA_SOURCE",
    AYUDAS + "\nreturn { sortPair, sqrtPriceX96From, tickFromPrice, usable, apartarDelPrecio, lanzarConCompraAtomica, ARC_SWAP_ROUTER };");

  let nonce = 1;       // el token ya gasto el 0
  let receta = null;
  const falsos = {
    ...ethers,
    Contract: function (addr, abi) {
      return {
        approve: async (sp, amt) => {
          llamadas.push({ from: cuenta, to: addr, data: ERC20.encodeFunctionData("approve", [sp, amt]) });
          nonce++;
          return { wait: async () => ({ status: 1 }) };
        },
      };
    },
    ContractFactory: function (abi, bytecode) {
      return {
        deploy: async (plan) => {
          const datos = bytecode + new ethers.Interface(abi).encodeDeploy([plan]).slice(2);
          const dirEsperada = ethers.getCreateAddress({ from: cuenta, nonce });
          llamadas.push({ from: cuenta, data: datos });
          nonce++;
          const indice = llamadas.length - 1;
          receta = { indice, dirEsperada };
          return {
            deploymentTransaction: () => ({
              wait: async () => {
                const res = await simular(llamadas, saldos);
                const d = res[indice];
                if (Number(d.status) !== 1) {
                  const e = new Error("deploy reverted: " + JSON.stringify(d.error || {}).slice(0, 200) + " " + d.returnData);
                  e.simulado = d;
                  throw e;
                }
                console.log("   gas used: token " + Number(res[0].gasUsed).toLocaleString("es") +
                            ", launcher (pool + wall + buy) " + Number(d.gasUsed).toLocaleString("es"));
                return { hash: "0x(simulated)", status: 1, logs: d.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })) };
              },
            }),
            getAddress: async () => dirEsperada,
          };
        },
      };
    },
  };
  const proveedor = {
    getTransactionCount: async () => nonce + (nonceCambia && llamadas.length >= 3 ? 1 : 0),
  };
  const compileAll = async () => LANZADOR.file;
  const H = fn(falsos, PLAN, QUOTE, ARC, [], cuenta, {}, proveedor, compileAll, COMPRA_ATOMICA_SOURCE);

  /* Las cuentas del muro, IGUAL que ejecutarPlan. */
  const s = H.sortPair(tokenDir, QUOTE.address);
  const sq = H.sqrtPriceX96From(PLANJS.precioDe(PLAN), DEC, QUOTE.decimals, s.aIsZero);
  const tickSpot = H.tickFromPrice(PLANJS.precioDe(PLAN), DEC, QUOTE.decimals, s.aIsZero);
  const p = r.posiciones[0];
  const lo0 = H.tickFromPrice(p.min, DEC, QUOTE.decimals, s.aIsZero);
  const hi0 = H.tickFromPrice(p.max, DEC, QUOTE.decimals, s.aIsZero);
  const amtTok = ethers.parseUnits(String(Math.floor(p.tokens)), DEC);
  const soloToken0 = p.usdc > 0 ? !s.aIsZero : s.aIsZero;
  const ap = H.apartarDelPrecio(H.usable(Math.min(lo0, hi0), 200, "down"), H.usable(Math.max(lo0, hi0), 200, "up"),
    Math.floor(tickSpot), 200, soloToken0);
  const q = { i: 0, p, lower: ap.lower, upper: ap.upper, a0: s.aIsZero ? amtTok : 0n, a1: s.aIsZero ? 0n : amtTok };
  const amtCompra = ethers.parseUnits(String(PLAN.compra.usdc), QUOTE.decimals);
  console.log("token " + tokenDir + " es token" + (s.aIsZero ? "0" : "1") + ", muro ticks " + q.lower + " → " + q.upper);

  if (atacante) {
    const sAt = saldos[1];
    /* Con gas de sobra: crear una pool cuesta ~5 M, y con 400 k esta llamada
       revertia sin crear nada y el escenario no probaba lo que dice. */
    llamadas.push({ from: sAt, to: ARC.positionManager, gas: 6_000_000,
      data: NPM.encodeFunctionData("createAndInitializePoolIfNecessary", [s.token0, s.token1, PLAN.fee, sq * 2n]) });
  }

  const registro = [];
  const log = (m, c) => registro.push((c ? "[" + c + "] " : "") + m);
  let firmas = 0;
  const firma = (m) => { firmas++; registro.push("sign: " + m); };

  let hecha = null, error = null;
  try {
    hecha = await H.lanzarConCompraAtomica({ s, sq, q, amtCompra, compraUsd: PLAN.compra.usdc, DEC, firma, log });
  } catch (e) { error = e; }
  return { cuenta, tokenDir, s, sq, q, amtCompra, PLAN, llamadas, saldos, receta, hecha, error, registro, firmas, H };
}

/* ── lecturas despues, en la misma simulacion ── */
async function leerDespues(x, extra) {
  const lecturas = [];
  const add = (to, iface, fn, args) => { lecturas.push({ to, iface, fn }); return { from: x.cuenta, to, data: iface.encodeFunctionData(fn, args) }; };
  const calls = [...x.llamadas];
  calls.push(add(ARC.v3Factory, FAB, "getPool", [x.s.token0, x.s.token1, x.PLAN.fee]));
  for (const e of extra) calls.push(add(e[0], e[1], e[2], e[3]));
  const res = await simular(calls, x.saldos);
  const base = x.llamadas.length;
  /* Las firmas tienen que volver a salir bien en ESTA simulacion: si no, las
     lecturas de despues mirarian una cadena en la que no se lanzo nada. */
  res.slice(0, base).forEach((c, k) => assert.equal(Number(c.status), 1,
    "call " + k + " failed on re-simulation: " + JSON.stringify(c.error || {}).slice(0, 200) + " " + motivo(c.returnData)));
  return res.slice(base).map((c, k) => {
    assert.equal(Number(c.status), 1, "read " + lecturas[k].fn + " failed");
    return lecturas[k].iface.decodeFunctionResult(lecturas[k].fn, c.returnData);
  });
}

let casos = 0;
const ok = (m) => { casos++; console.log("OK  " + m); };

for (const tokenDebajo of [true, false]) {
  const x = await escenario({ nombre: (tokenDebajo ? "A" : "B") + ": atomic launch, token " + (tokenDebajo ? "below" : "above") + " USDC", tokenDebajo });
  if (x.error) { console.log(x.registro.join("\n")); throw x.error; }
  const lanz = x.receta.dirEsperada;
  assert.equal(x.firmas, 3, "3 signatures: approve token, approve USDC, launch");
  ok("3 signatures, and the launcher at the address that was approved (" + lanz + ")");
  assert.notEqual(x.hecha.id, null, "NFT id read from the receipt");
  assert(x.hecha.comprados > 0n, "tokens bought read from the Launched event");
  ok("NFT #" + x.hecha.id + " and " + ethers.formatUnits(x.hecha.comprados, 18) + " ATOM bought, both read from the receipt");

  const [pool] = await leerDespues(x, []);
  const [[poolDir], slot, dueñoNft, pos, tokUsuario, tokLanz, usdLanz, usdPool, alTok, alUsd, tokPool] = await leerDespues(x, [
    [pool[0], POOL, "slot0", []],
    [ARC.positionManager, NPM, "ownerOf", [x.hecha.id]],
    [ARC.positionManager, NPM, "positions", [x.hecha.id]],
    [x.tokenDir, ERC20, "balanceOf", [x.cuenta]],
    [x.tokenDir, ERC20, "balanceOf", [lanz]],
    [QUOTE.address, ERC20, "balanceOf", [lanz]],
    [QUOTE.address, ERC20, "balanceOf", [pool[0]]],
    [x.tokenDir, ERC20, "allowance", [x.cuenta, lanz]],
    [QUOTE.address, ERC20, "allowance", [x.cuenta, lanz]],
    [x.tokenDir, ERC20, "balanceOf", [pool[0]]],
  ]);
  assert.notEqual(poolDir, ethers.ZeroAddress);
  assert.equal(dueñoNft[0].toLowerCase(), x.cuenta.toLowerCase(), "the creator owns the wall NFT");
  ok("the pool exists and the creator owns the wall NFT");
  assert.equal(Number(pos[5]), x.q.lower); assert.equal(Number(pos[6]), x.q.upper); assert(pos[7] > 0n);
  ok("the wall sits exactly at ticks " + x.q.lower + " → " + x.q.upper + " with liquidity");
  const supply = ethers.parseUnits(String(x.PLAN.supply), 18);
  const muro = x.q.a0 + x.q.a1;
  /* El position manager usa un poco MENOS del maximo pedido (redondeo de la
     liquidez) y el lanzador devuelve la diferencia: eso es correcto, y es lo
     mismo que pasaba con el lote de antes, donde el resto se quedaba en la
     cartera. Lo exacto es la conservacion. */
  assert.equal(tokUsuario[0] + tokPool[0], supply, "creator + pool = supply, to the wei");
  ok("creator + pool = supply, to the wei: no token lost or stuck anywhere");
  const devuelto = tokUsuario[0] - (supply - muro + x.hecha.comprados);
  assert(devuelto >= 0n && devuelto * 1000n < muro, "the refund is the rounding, under 0.1% of the wall");
  ok("the unused rounding of the wall came back to the creator (" + (Number(devuelto * 1000000n / muro) / 10000).toFixed(4) + "% of the wall)");
  assert.equal(tokLanz[0], 0n); assert.equal(usdLanz[0], 0n);
  ok("the launcher keeps nothing: 0 tokens, 0 USDC");
  assert.equal(usdPool[0], x.amtCompra, "all of the buy's USDC is in the pool");
  ok("the pool holds exactly the $" + x.PLAN.compra.usdc + " of the buy (the wall took no USDC)");
  assert.equal(alTok[0], 0n); assert.equal(alUsd[0], 0n);
  ok("both approvals to the launcher are fully spent");
  const sqAhora = slot[0];
  if (x.s.aIsZero) assert(sqAhora > x.sq, "buying the token pushes its price up (token0 → sqrt up)");
  else assert(sqAhora < x.sq, "buying the token pushes its price up (token1 → sqrt down)");
  ok("the buy moved the price the right way from the plan price");
}

{
  const x = await escenario({ nombre: "C: someone created the pool first at another price", tokenDebajo: true, atacante: true });
  assert(x.error, "must fail");
  assert.match(JSON.stringify(x.error.simulado || {}) + x.error.message, /pool price is not the planned one|706f6f6c207072696365/, "reverts with the price guard");
  ok("the launcher reverts with \"pool price is not the planned one\"");
  const lecturas = [...x.llamadas.slice(0, -1)];   // sin el despliegue que revierte
  lecturas.push({ from: x.cuenta, to: x.tokenDir, data: ERC20.encodeFunctionData("balanceOf", [x.cuenta]) });
  const res = await simular(lecturas, x.saldos);
  assert.equal(Number(res[1].status), 1, "the attacker's pool creation itself must succeed, or this proves nothing");
  ok("the attacker's pool at twice the price was really created first");
  const bal = ERC20.decodeFunctionResult("balanceOf", res[res.length - 1].returnData)[0];
  assert.equal(bal, ethers.parseUnits(String(x.PLAN.supply), 18), "the creator still holds the whole supply");
  ok("the creator still holds the whole supply: nothing moved");
}

{
  const x = await escenario({ nombre: "D: another transaction left the wallet in between", tokenDebajo: true, nonceCambia: true });
  assert(x.error && /another transaction/.test(x.error.message), "stops on the nonce");
  assert.equal(x.receta, null, "never tried to deploy");
  assert.equal(x.firmas, 2, "only the two approvals were signed");
  ok("stops before deploying, with the two approvals as the only signatures");
}

console.log("\n" + casos + " checks, all good (" + peticiones + " requests to " + NODO + ", nothing sent to the chain)");
