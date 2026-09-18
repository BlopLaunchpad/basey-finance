/* ===========================================================================
   PRUEBA DE LA PARTE DE LA PAGINA DEL PASO 6 EN V4 (fabrica-v4.js + plan.js)

     node tools/probar-pagina-v4.mjs

   Lo que hace la pagina, con SUS funciones y el plan por defecto, contra la V4
   real de Arc con eth_simulateV1 (no firma ni manda nada):
     1. fabrica-v4-codigo.js esta al dia: su codigo de creacion de la fabrica y de
        los dos tokens es el que sale de compilar ahora las fuentes, y los tokens
        tienen la huella del BaseyToken verificado;
     2. la fabrica se despliega con datosDespliegue() y fabricaValida() la acepta;
     3. findSalt() da un token por encima de la USDC;
     4. con los ticks de ticksV4() la pool abre al precio del plan (error <= 0,01 %)
        y el muro va donde dice la tabla;
     5. la compra inicial compra lo que tiene que comprar a ese precio;
     6. leerLanzado() saca token, NFT y comprados del recibo, y motivoV4() pone en
        palabras un revert de la fabrica.
   =========================================================================== */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { ethers } = require(path.join(raiz, "..", "blop-contracts", "node_modules", "ethers"));
globalThis.ethers = ethers;   // la pagina lo tiene como global
const imp = (f) => import(pathToFileURL(path.join(raiz, f)).href);
const { entradaEstandar, compilar, compilarToken } = await imp("tools/compilar-v4.mjs");
const { BASEY_TOKEN_SOURCE, argsDelToken } = await imp("basey-token.js");
const PLANMOD = await imp("plan.js");
const F4 = await imp("fabrica-v4.js");
const COD = await imp("fabrica-v4-codigo.js");

const NODO = process.env.NODO || "https://arc.drpc.org";
const HUELLA_TOKEN = "0x4f51a2182fbbb77c55711d2301e9ad4de66be64ea53d1f8c352e7ad08e0e02e4";
let peticiones = 0;
async function rpc(method, params) {
  peticiones++;
  const r = await fetch(NODO, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(90000) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error).slice(0, 300));
  return j.result;
}
const hex = (n) => "0x" + BigInt(n).toString(16);
async function simular(bloques, cuentas) {
  const stateOverrides = {};
  for (const a of cuentas) stateOverrides[a] = { balance: hex(1000n * 10n ** 18n) };
  const blockStateCalls = bloques.map((calls, i) => ({ ...(i === 0 ? { stateOverrides } : {}),
    calls: calls.map((c) => ({ ...c, gas: hex(c.gas || 700_000) })) }));
  for (let intento = 1; ; intento++) {
    try { return (await rpc("eth_simulateV1", [{ blockStateCalls, validation: false }, "latest"])).map((b) => b.calls); }
    catch (e) {
      if (intento >= 3 || !/Temporary internal error/.test(e.message)) throw e;
      await new Promise((ok) => setTimeout(ok, 2500 * intento));
    }
  }
}
const ok = (r, que) => assert.equal(r.status, "0x1", que + " revierte: " + (F4.motivoV4({ data: r.returnData }) || r.returnData.slice(0, 10)));

let bien = 0;
const caso = async (n, fn) => { await fn(); bien++; console.log("ok  " + n); };

/* ── 1. el codigo que sirve la pagina esta al dia ── */
await caso("fabrica-v4-codigo.js es lo que sale de compilar HOY las fuentes", async () => {
  const { out } = compilar(await entradaEstandar());
  const Fab = out.contracts["src/BaseyLaunchFactoryV4.sol"].BaseyLaunchFactoryV4;
  assert.equal(COD.CREACION_FABRICA, "0x" + Fab.evm.bytecode.object, "fabrica desfasada: node tools/compilar-v4.mjs");
  const TK = compilarToken(BASEY_TOKEN_SOURCE);
  assert.equal(COD.CODIGO_TOKEN, "0x" + TK.BaseyToken.evm.bytecode.object);
  assert.equal(COD.CODIGO_EDITABLE, "0x" + TK.BaseyTokenEditable.evm.bytecode.object);
  assert.equal(ethers.keccak256("0x" + TK.BaseyToken.evm.deployedBytecode.object), HUELLA_TOKEN);
  assert.equal(COD.HASH_TOKEN, ethers.keccak256(COD.CODIGO_TOKEN));
  assert.equal(COD.HASH_EDITABLE, ethers.keccak256(COD.CODIGO_EDITABLE));
});

/* ── el plan por defecto de la pagina, con el muro bloqueado ── */
const PLAN = PLANMOD.planPorDefecto();
PLAN.nombre = "Pagina V4"; PLAN.símbolo = "PV4";
PLAN.imagen = "https://ipfs.io/ipfs/QmSWKk2f5tdpN5rZyRHYosW8XSMVx2cZybnB1W3no1wv2J";
PLAN.tramos[0].bloquear = true;
assert.ok(PLANMOD.usaV4(PLAN), "el plan por defecto va por V4");
const r = PLANMOD.resumen(PLAN);
assert.equal(r.pasos, 2, "en V4: aprobar la USDC y launch()");
const P0 = PLANMOD.precioDe(PLAN);
const t = PLAN.tramos[0];
const ticks = F4.ticksV4(P0, Math.max(t.desde, PLANMOD.SEPARACIÓN_MÍNIMA), t.hasta);
const wallTokens = ethers.parseUnits(String(Math.floor(r.posiciones[0].tokens)), 18);
const compraUsd = PLANMOD.compraDe(PLAN);
const buyUsdc = ethers.parseUnits(compraUsd.toFixed(6), 6);
const argsToken = argsDelToken(PLAN);
console.log("plan: supply " + PLAN.supply + ", mcap $" + PLAN.mcapObjetivo + ", precio $" + P0.toExponential(4) +
  " | ticks inicio " + ticks.startTick + ", muro " + ticks.wallLower + " -> " + ticks.wallUpper + " | compra $" + compraUsd);

const DEPLOYER = "0x00000000000000000000000000000000000de902";
const L = "0x000000000000000000000000000000000000ba53";
const nonce = Number(await rpc("eth_getTransactionCount", [DEPLOYER, "latest"]));
const FAB = ethers.getCreateAddress({ from: DEPLOYER, nonce });
const iF = new ethers.Interface(F4.ABI_FABRICA);
const iE = new ethers.Interface(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
const iS = new ethers.Interface(["function getSlot0(bytes32) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);
const c = (from, to, iface, fn, args = [], gas) => ({ from, to, data: iface.encodeFunctionData(fn, args), gas });
const desplegar = { from: DEPLOYER, data: F4.datosDespliegue(), gas: 12_000_000 };

/* ── 2 y 3: desplegar y buscar la sal, como la pagina ── */
const [s1, s2] = await simular([[desplegar], [
  c(L, FAB, iF, "tokenCodeHash"), c(L, FAB, iF, "editableCodeHash"), c(L, FAB, iF, "usdc"),
  c(L, FAB, iF, "poolManager"), c(L, FAB, iF, "positionManager"),
  c(L, FAB, iF, "findSalt", [L, F4.salBase(), F4.codigoDelToken(false), F4.argsTokenCodificados(argsToken), 64], 3_000_000),
]], [DEPLOYER, L]);
let salt, previsto;
await caso("datosDespliegue() despliega la fabrica y fabricaValida() la acepta", async () => {
  ok(s1[0], "despliegue");
  const respuestas = s2.slice(0, 5);
  const fn = ["tokenCodeHash", "editableCodeHash", "usdc", "poolManager", "positionManager"];
  const leer = async (dir, abi, f) => iF.decodeFunctionResult(f, respuestas[fn.indexOf(f)].returnData);
  assert.equal(await F4.fabricaValida(FAB, leer), true);
  assert.equal(await F4.fabricaValida(FAB, async () => { throw new Error("nodo mudo"); }), false, "sin respuesta no es valida");
});
await caso("findSalt() da una direccion por encima de la USDC", async () => {
  ok(s2[5], "findSalt");
  [salt, previsto] = iF.decodeFunctionResult("findSalt", s2[5].returnData);
  assert.ok(BigInt(previsto) > BigInt(F4.USDC_ERC20));
});

/* ── 4, 5 y 6: el lanzamiento con los parametros de la pagina ── */
/* otra sal con el token por encima de la USDC, calculada aqui como la calcula la fabrica */
function salArriba(base) {
  const initHash = ethers.keccak256(ethers.concat([F4.codigoDelToken(false), F4.argsTokenCodificados(argsToken)]));
  for (let i = 0; i < 500; i++) {
    const sal = ethers.id(base + "-" + i);
    const dir = ethers.getCreate2Address(FAB, ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [L, sal])), initHash);
    if (BigInt(dir) > BigInt(F4.USDC_ERC20)) return sal;
  }
  throw new Error("sin sal");
}
const p = F4.paramsV4({ editable: false, argsToken, salt, lpFee: PLAN.fee, ticks, wallTokens, lock: true, buyUsdc, minTokensOut: 0n });
const pSinCompra = F4.paramsV4({ editable: false, argsToken, salt: salArriba("sin-compra"), lpFee: PLAN.fee, ticks, wallTokens, lock: false, buyUsdc: 0n, minTokensOut: 0n });
const [, , b3] = await simular([[desplegar], [], [
  c(L, F4.USDC_ERC20, iE, "approve", [FAB, buyUsdc]),
  c(L, FAB, iF, "launch", [p], 8_000_000),
  c(L, previsto, iE, "balanceOf", [L]),
  c(L, FAB, iF, "infoOf", [previsto]),
  c(L, FAB, iF, "launch", [pSinCompra], 8_000_000),
  c(L, FAB, iF, "launch", [{ ...pSinCompra, salt: ethers.id("malo"), startTick: ticks.wallUpper - 200 }], 2_000_000),
]], [DEPLOYER, L]);

let lanzado;
await caso("la compra inicial compra lo que corresponde al precio del plan", async () => {
  ok(b3[0], "approve");
  ok(b3[1], "launch");
  const [tok, , comprados] = iF.decodeFunctionResult("launch", b3[1].returnData);
  assert.equal(tok.toLowerCase(), previsto.toLowerCase(), "el token sale donde dijo findSalt");
  /* $2 al precio del muro (desde 1,02x), menos el 1 %: ~1,94 $ al precio de salida */
  const valor = Number(ethers.formatUnits(comprados, 18)) * P0;
  assert.ok(valor > 1.85 && valor < 1.99, "lo comprado vale $" + valor.toFixed(4) + " al precio de salida");
  console.log("      $" + compraUsd + " -> " + Number(ethers.formatUnits(comprados, 18)).toLocaleString("es") + " PV4 (valen $" + valor.toFixed(4) + " al precio de salida)");
  const info = iF.decodeFunctionResult("infoOf", b3[3].returnData);
  assert.equal(info[1].toLowerCase(), L);
  assert.equal(info[4], true, "bloqueado");
  lanzado = { tokenId: info[0], comprados };
});

await caso("leerLanzado() saca token, NFT y comprados del recibo", async () => {
  const hecho = F4.leerLanzado({ logs: b3[1].logs }, FAB);
  assert.ok(hecho, "encuentra el evento Launched");
  assert.equal(hecho.token.toLowerCase(), previsto.toLowerCase());
  assert.equal(hecho.tokenId, lanzado.tokenId);
  assert.equal(hecho.tokensBought, lanzado.comprados);
  assert.equal(hecho.locked, true);
  assert.equal(F4.leerLanzado({ logs: b3[1].logs }, F4.USDC_ERC20), null, "solo cuenta el evento de la fabrica");
});

await caso("la pool abre al precio del plan (error <= 0,01 %) y el muro esta donde dice la tabla", async () => {
  ok(b3[4], "launch sin compra");
  const [tok] = iF.decodeFunctionResult("launch", b3[4].returnData);
  const key = [F4.USDC_ERC20, tok, PLAN.fee, F4.TICK_SPACING, ethers.ZeroAddress];
  const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], key));
  const [s] = await simular([[desplegar], [], [
    c(L, FAB, iF, "launch", [pSinCompra], 8_000_000),
    c(L, "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b", iS, "getSlot0", [id]),
  ]], [DEPLOYER, L]).then((x) => [x[2]]);
  const slot = iS.decodeFunctionResult("getSlot0", s[1].returnData);
  assert.equal(Number(slot.tick), ticks.startTick, "tick de salida");
  /* tokens crudos por USDC cruda -> $ por token */
  const precioPool = 1 / (1.0001 ** Number(slot.tick) / 1e12);
  const error = Math.abs(precioPool / P0 - 1);
  assert.ok(error <= 1e-4, "la pool abre a $" + precioPool.toExponential(6) + " y el plan dice $" + P0.toExponential(6));
  const muroBajo = 1 / (1.0001 ** ticks.wallUpper / 1e12), muroAlto = 1 / (1.0001 ** ticks.wallLower / 1e12);
  /* lo que pinta la tabla (precioDeTick) es lo mismo */
  assert.ok(Math.abs(F4.precioDeTick(ticks.wallUpper) / muroBajo - 1) < 1e-9 && Math.abs(F4.precioDeTick(ticks.wallLower) / muroAlto - 1) < 1e-9);
  assert.ok(Math.abs(F4.precioDeTick(Number(slot.tick)) / precioPool - 1) < 1e-9);
  assert.ok(muroBajo >= P0 * 1.02 * 0.99 && muroBajo <= P0 * 1.02 * 1.03, "el muro empieza en ~1,02x: " + (muroBajo / P0).toFixed(4) + "x");
  assert.ok(muroAlto >= P0 * 100 && muroAlto <= P0 * 103, "el muro acaba en ~100x: " + (muroAlto / P0).toFixed(2) + "x");
  console.log("      abre a $" + precioPool.toExponential(6) + " (plan $" + P0.toExponential(6) + ", error " + (error * 100).toFixed(4) + " %) · muro " + (muroBajo / P0).toFixed(3) + "x -> " + (muroAlto / P0).toFixed(1) + "x");
});

await caso("motivoV4() pone en palabras un revert de la fabrica", async () => {
  assert.equal(b3[5].status, "0x0", "un muro por encima del precio de salida revierte");
  assert.equal(F4.nombreErrorV4({ data: b3[5].returnData }), "BadTicks");
  assert.match(F4.motivoV4({ data: b3[5].returnData }), /out of range/);
  assert.equal(F4.motivoV4({ data: "0x" }), null);
  assert.throws(() => F4.ticksV4(P0, 1.02, 1.01), /wall/);
});

await caso("la identidad que no cabe se DICE (problemaDeIdentidad), no se recorta", async () => {
  const base = { ...PLANMOD.planPorDefecto(), imagen: "data:image/webp;base64," + "A".repeat(2600) };
  assert.equal(PLANMOD.problemaDeIdentidad(base), null, "una imagen de 2.600 caracteres cabe");
  const grande = { ...base, imagen: "data:image/png;base64," + "A".repeat(PLANMOD.MAX_IMAGEN) };
  assert.match(PLANMOD.problemaDeIdentidad(grande), /limit is 8,000/);
  assert.ok(PLANMOD.avisosDe(grande).some((x) => /Nothing will be signed/.test(x)), "sale en los avisos");
  assert.equal(PLANMOD.problemaDeIdentidad({ ...grande, modo: "existente" }), null, "con un token que ya existe no aplica");
  assert.match(PLANMOD.problemaDeIdentidad({ ...base, web: "https://" + "x".repeat(600) }), /website/);
});

console.log("\n" + bien + " casos, todos bien | peticiones al nodo: " + peticiones + " | nada enviado a la cadena");
