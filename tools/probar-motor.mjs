/* ===========================================================================
   PRUEBA DEL MOTOR DE RUTAS EN ESTE PANEL: V4, hook de Arguspad, sin comision.

   Se ejecuta en Node desde la raiz del repo:
     node tools/probar-motor.mjs

   NADA SE FIRMA NI SE DIFUNDE. Todo es eth_call con state overrides:
     - la Sonda (arcmagnate/demo/router/sonda, solc 0.8.26) se coloca con
       override de codigo en una direccion ficticia y hace de CARTERA: aprueba,
       llama al UniversalRouter y fotografia saldos antes y despues de cada paso;
     - el USDC se le da con override de saldo NATIVO (en Arc el ERC-20 0x3600 es
       el mismo saldo, visto en 6 decimales);
     - la moneda que vende, con override del slot de balanceOf (buscado en una
       sola llamada) o, si no se encuentra, desde un titular cuyo codigo se
       sustituye por la Sonda y hace transfer().
   Cotizacion, aprobaciones, calldata y simulacion van al MISMO bloque fijado.

   NO PRUEBA UNA COPIA: usa motor-rutas.js y rutas.js DEL DISCO, y el proveedor
   rotativo de rpc.js. Pero apuntado a warp-arc-production (acepta overrides) y
   a rpc.arc-scan.org para lecturas: NUNCA a thecusp.io, que es produccion, y
   sin bucles ni sondeos.

   ethers: ETHERS_PATH, "ethers", o el node_modules de cusp-web, blopfun-web o
   blop-indexer al lado de este repo. La Sonda: SONDA_DIR, o
   ../arcmagnate/demo/router/sonda/out. Sin rutas de disco escritas. */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function cargarEthers() {
  const sitios = [process.env.ETHERS_PATH, "ethers",
    path.join(raiz, "..", "cusp-web", "node_modules", "ethers"),
    path.join(raiz, "..", "blopfun-web", "node_modules", "ethers"),
    path.join(raiz, "..", "blop-indexer", "node_modules", "ethers")].filter(Boolean);
  for (const s of sitios) { try { return require(s); } catch { /* el siguiente */ } }
  throw new Error("ethers not found — set ETHERS_PATH to a node_modules/ethers folder");
}
const { ethers } = cargarEthers();
const Rutas = require(path.join(raiz, "rutas.js"));
const MOTOR = await import(pathToFileURL(path.join(raiz, "motor-rutas.js")).href);
const { crearProveedorRotativo } = await import(pathToFileURL(path.join(raiz, "rpc.js")).href);
const { FEE_TIERS } = await import(pathToFileURL(path.join(raiz, "token-features.js")).href);

const md5 = (f) => crypto.createHash("md5").update(fs.readFileSync(f)).digest("hex");
const CANONICO = path.join(raiz, "..", "arcmagnate", "demo", "router", "rutas.js");
console.log("rutas.js here      md5 " + md5(path.join(raiz, "rutas.js")) + "  version " + Rutas.version);
if (fs.existsSync(CANONICO)) console.log("rutas.js canonical md5 " + md5(CANONICO));

const SIM = "https://warp-arc-production.up.railway.app/rpc";
const LECTURA = "https://rpc.arc-scan.org";
const D = Rutas.DIRECCIONES;
const UR = D.UNIVERSAL_ROUTER;
const NATIVO = D.NATIVO;
const USDC = D.USDC;
const PLATAFORMA = Rutas.CARTERA_COMISION;          // la que cobraria el 1% con el motor por defecto
const abi = ethers.AbiCoder.defaultAbiCoder();
const hex = (n) => "0x" + BigInt(n).toString(16);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* Direcciones ficticias: ni precompilados ni cuentas de sistema. */
const SONDA = "0x5a0da15a0da15a0da15a0da15a0da15a0da15a0d";
const EOA = "0xe0a0e0a0e0a0e0a0e0a0e0a0e0a0e0a0e0a0e0a1";
const SALDO_SONDA = 10n ** 24n;          // 1.000.000 USDC nativos
const GAS = 30_000_000;

/* `conV3`: si buscarPool() de app.js encuentra pool V3 contra USDC. Con pool
   V3 el panel NO usa el motor (lo de V3 no cambia); BARC va igual, porque es
   la moneda que da a Permit2 permiso infinito de fabrica y prueba ese camino.
   0x897c...c43f: V4 contra USDC nativo sin hook y SIN pool V3, la de mas
   operaciones de su clase en 3 dias (234) en la tabla del indexer, 14-sep. */
const CASOS = [
  { nombre: "ARCX10 — V4, ERC-20 USDC, Arguspad hook", token: "0x12ce1f970722ca6e08364b60099b3d25c09b5434",
    conV3: false, compra: 5_000000n, adverso: 3000_000000n, titular: null },
  { nombre: "0x897c…c43f — V4, native USDC, no hook, no V3 pool", token: "0x897ceac5f9ca540c889829607bf03f8b2624c43f",
    conV3: false, compra: 5_000000n, adverso: 3000_000000n, titular: "0x06f2c6eecf39f395925d25acbb69a424c6f4b0ae" },
  { nombre: "BARC — V4, native USDC, no hook (has V3 pools: the panel keeps V3 for it)", token: "0x4753c45fb550fecaa143a47968659117e6ffc2ce",
    conV3: true, compra: 5_000000n, adverso: 3000_000000n, titular: "0xa3a482054ae9eaf4a22473bcdc93813bb2913316" },
];
const SLIPPAGE_BPS = 500;               // el 5% que trae cada tarjeta por defecto

/* JSON-RPC a mano para lo que lleva overrides (ethers no los pasa). Un revert
   no se reintenta; un 503/429 si. */
let idRpc = 1;
async function rpc(method, params, intentos = 6) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(SIM, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: idRpc++, method, params }) });
      const txt = await r.text();
      let j;
      try { j = JSON.parse(txt); } catch { throw new Error("HTTP " + r.status + " " + txt.slice(0, 120)); }
      if (j.error) {
        const e = new Error(j.error.message);
        e.rpc = j.error;
        if (j.error.code === 3 || /revert/i.test(j.error.message || "")) e.revert = true;
        throw e;
      }
      return j.result;
    } catch (e) {
      if (e.revert) throw e;
      ultimo = e;
      await esperar(500 * (i + 1));
    }
  }
  throw ultimo;
}

/* LAS LECTURAS DEL MOTOR, SIN LOTES. Medido en la primera pasada (14-sep): el
   proveedor rotativo junta lecturas en lotes y warp-arc-production contesta
   "batch disabled for this project", mientras rpc.arc-scan.org daba 503; el
   descubrimiento de ARCX10 se quedo sin rutas por eso, no por la moneda. Aqui
   va un JsonRpcProvider de una peticion por viaje contra warp, como
   probar-rutas.cjs. El proveedor rotativo de la pagina se prueba en el
   navegador (y el suyo propio en tools/test-rpc.mjs). */
void crearProveedorRotativo; void LECTURA;
const provider = new ethers.JsonRpcProvider(SIM, ethers.Network.from(5042), { staticNetwork: ethers.Network.from(5042), batchMaxCount: 1 });
const motor = MOTOR.crearMotorPropio(ethers, Rutas, provider);
console.log("engine fee wallet  " + motor.carteraComision + " (MSG_SENDER)  bips " + motor.comisionBips + "  default platform wallet " + PLATAFORMA);

/* ── LA SONDA ── */
const DIR_SONDA = process.env.SONDA_DIR || path.join(raiz, "..", "arcmagnate", "demo", "router", "sonda", "out");
const CODIGO_SONDA = "0x" + fs.readFileSync(path.join(DIR_SONDA, "Sonda.bin-runtime"), "utf8").trim();
const iSonda = new ethers.Interface(JSON.parse(fs.readFileSync(path.join(DIR_SONDA, "Sonda.abi"), "utf8")));

async function sonda({ llamadas, monedas, cuentas, bloque, override }) {
  const data = iSonda.encodeFunctionData("ejecutar",
    [llamadas.map((l) => [l.to, BigInt(l.value || 0), l.data]), monedas, cuentas]);
  const ov = { [SONDA]: { code: CODIGO_SONDA, balance: hex(SALDO_SONDA) } };
  for (const [k, v] of Object.entries(override || {})) ov[k] = Object.assign({}, ov[k] || {}, v);
  const raw = await rpc("eth_call", [{ from: EOA, to: SONDA, data, gas: hex(GAS) }, hex(bloque), ov]);
  const [saldos, ok, ret, gas] = iSonda.decodeFunctionResult("ejecutar", raw);
  const nC = cuentas.length;
  const foto = (paso, moneda, cuenta) => saldos[paso][monedas.indexOf(moneda) * nC + cuentas.indexOf(cuenta)];
  return { ok: [...ok], ret: [...ret], gas: [...gas], foto, n: llamadas.length };
}

/* ── EL SLOT DE balanceOf, en una llamada (igual que probar-rutas.cjs) ── */
const OZ5_ERC20 = "0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00";
async function buscarSlotSaldo(token, titular, bloque) {
  const cands = [];
  for (let s = 0; s < 64; s++) {
    cands.push({ tipo: "solidity", slot: s, clave: ethers.keccak256(abi.encode(["address", "uint256"], [titular, s])) });
    cands.push({ tipo: "vyper", slot: s, clave: ethers.keccak256(abi.encode(["uint256", "address"], [s, titular])) });
  }
  cands.push({ tipo: "oz5", clave: ethers.keccak256(abi.encode(["address", "bytes32"], [titular, OZ5_ERC20])) });
  cands.push({ tipo: "solady", clave: ethers.keccak256(ethers.concat([titular, "0x0000000087a211a2"])) });
  const base = 10n ** 30n;
  const stateDiff = {};
  cands.forEach((c, i) => { stateDiff[c.clave] = ethers.toBeHex(base + BigInt(i), 32); });
  const data = "0x70a08231" + abi.encode(["address"], [titular]).slice(2);
  const r = BigInt(await rpc("eth_call", [{ to: token, data }, hex(bloque), { [token]: { stateDiff } }]));
  const idx = r - base;
  if (idx < 0n || idx >= BigInt(cands.length)) return null;
  const c = cands[Number(idx)];
  const v = 777n * 10n ** 18n;
  const r2 = BigInt(await rpc("eth_call", [{ to: token, data }, hex(bloque), { [token]: { stateDiff: { [c.clave]: ethers.toBeHex(v, 32) } } }]));
  return r2 === v ? c : null;
}

const checks = [];
function comprobar(caso, nombre, ok, detalle) {
  checks.push({ caso, nombre, ok: !!ok, detalle });
  console.log("   " + (ok ? "PASS" : "FAIL") + "  " + nombre + ": " + detalle);
}
const err = (m, r, k) => (r.ok[k] ? "ok" : m.decodificarError(ethers.hexlify(r.ret[k])));

async function bloqueFijo() {
  const n = parseInt(await rpc("eth_blockNumber", []), 16) - 3;
  const b = await rpc("eth_getBlockByNumber", [hex(n), false]);
  return { bloque: n, ts: parseInt(b.timestamp, 16) };
}

const iErc = new ethers.Interface(["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
const iP2 = new ethers.Interface(["function approve(address token, address spender, uint160 amount, uint48 expiration)", "function allowance(address,address,address) view returns (uint160,uint48,uint48)"]);
const iFac = new ethers.Interface(["function getPool(address,address,uint24) view returns (address)"]);

async function probarCaso(caso) {
  const { bloque, ts } = await bloqueFijo();
  const token = caso.token;
  console.log("\n== " + caso.nombre + "  (" + token + ")  block " + bloque);

  /* Por que el panel lo manda al motor: buscarPool() de app.js no encuentra
     pool V3 contra USDC en ninguno de FEE_TIERS. La misma pregunta, aqui. */
  const [t0, t1] = token < USDC ? [token, USDC] : [USDC, token];
  const v3 = [];
  for (const t of FEE_TIERS) {
    const [p] = iFac.decodeFunctionResult("getPool", await rpc("eth_call", [{ to: D.V3_FACTORY, data: iFac.encodeFunctionData("getPool", [t0, t1, t.fee]) }, hex(bloque)]));
    v3.push(t.fee + ":" + (p === ethers.ZeroAddress ? "none" : p));
  }
  const sinV3 = v3.every((x) => x.endsWith("none"));
  comprobar(caso.nombre, caso.conV3 ? "has a V3 pool against USDC, so the panel keeps its V3 path (engine proven anyway)" : "no V3 pool against USDC, so the panel uses the engine",
    caso.conV3 ? !sinV3 : sinV3, v3.join(" "));

  const d = await MOTOR.descubrir({ ethers, Rutas, motor, provider, token, blockTag: bloque });
  console.log("   candidates: " + d.candidatas.map((p) => p.version + (p.hooks && p.hooks !== NATIVO ? "+hook" : "") + " " + (p.token0 === NATIVO ? "native" : "") + " fee " + p.fee + (p.tickSpacing != null ? "/" + p.tickSpacing : "")).join(" ; "));
  console.log("   routes: " + d.rutas.map((r) => r.clave).join(" ; "));
  if (d.descartes.length) console.log("   discarded: " + d.descartes.map((x) => x.error).join(" | "));
  comprobar(caso.nombre, "the engine found an executable route", d.rutas.length > 0, d.rutas.length + " route(s)");
  if (!d.rutas.length) return;

  /* ── COMPRA ── */
  const planC = await MOTOR.planificar({ ethers, Rutas, motor, rutas: d.rutas, lado: "compra", cantidad: caso.compra,
    slippageBps: SLIPPAGE_BPS, usuario: SONDA, blockTag: bloque, ahora: ts, deadline: ts + 600 });
  const c = planC.cot;
  const ruta = c.ruta;
  const hook = ruta.saltos.map((s) => s.pool.hook).find((h) => h && h.ok);
  if (hook) console.log("   Arguspad proof: hook " + hook.hook + " portal " + hook.portal + " token " + hook.token + " splitter " + hook.splitter + " quote " + hook.quote + " buyTax " + hook.buyTaxBps + " sellTax " + hook.sellTaxBps);
  console.log("   route used: " + ruta.clave + "  " + MOTOR.textoRuta(ruta, "compra", "TOKEN"));
  console.log("   buy log line: " + MOTOR.textoCotizacion(ethers, planC, "compra", "TOKEN", 18));
  console.log("   buy commands " + planC.swap.comandos + " (" + planC.swap.pasos.join(" / ") + ")  value " + planC.swap.value + "  loss vs spot " + (planC.guarda.perdidaBps / 100).toFixed(2) + "%");
  const intermedios = [...new Set(ruta.saltos.flatMap((s) => [s.entra, s.sale]))].filter((m) => m !== NATIVO && m !== USDC && m !== ruta.token);
  const monedas = [NATIVO, USDC, token, ...intermedios];
  const cuentas = [SONDA, PLATAFORMA, UR];

  comprobar(caso.nombre, "[buy] every router payment goes to the signer (PAY_PORTION to MSG_SENDER)", MOTOR.comprobarDestinos(ethers, Rutas, planC.swap),
    planC.swap.inputs.map((inp, k) => ethers.getBytes(planC.swap.comandos)[k] === 0x06 ? "PAY_PORTION -> " + abi.decode(["address", "address", "uint256"], inp)[1] : null).filter(Boolean).join(", "));
  comprobar(caso.nombre, "[buy] no approvals needed (paid with msg.value)", planC.aprobaciones.length === 0, planC.aprobaciones.map((a) => a.tipo).join(",") || "none");

  const rc = await sonda({ llamadas: [...planC.aprobaciones, planC.swap], monedas, cuentas, bloque });
  const L = rc.n, A = L - 1;
  const dC = (m, q) => rc.foto(L, m, q) - rc.foto(A, m, q);
  comprobar(caso.nombre, "[buy] all calls succeeded", rc.ok.every(Boolean), rc.ok.map((o, k) => err(motor, rc, k)).join(" | ") + "  gas " + rc.gas[L - 1]);
  const recibido = dC(token, SONDA);
  comprobar(caso.nombre, "[buy] received equals the quote", recibido === c.sale, recibido + " vs " + c.sale);
  comprobar(caso.nombre, "[buy] received >= minOut", recibido >= planC.swap.minSalida, recibido + " >= " + planC.swap.minSalida);
  const pagado = -dC(NATIVO, SONDA);
  const neto = c.entra - c.comision;
  comprobar(caso.nombre, "[buy] wallet paid the input minus the 1% that came back (no fee)", pagado <= neto && pagado >= neto - 10n ** 12n && pagado < c.entra,
    "paid " + pagado + " wei; sent " + c.entra + ", 1% back " + c.comision + (ruta.nativo ? "" : " (ERC-20 route: < 1e12 wei of rounding also swept back)"));
  comprobar(caso.nombre, "[buy] platform fee wallet received nothing", dC(NATIVO, PLATAFORMA) === 0n && dC(USDC, PLATAFORMA) === 0n,
    "native " + dC(NATIVO, PLATAFORMA) + ", USDC " + dC(USDC, PLATAFORMA));
  const polvoC = monedas.map((m) => [m, rc.foto(0, m, UR), rc.foto(L, m, UR)]);
  comprobar(caso.nombre, "[buy] no dust left in the UniversalRouter", polvoC.every(([, a, b]) => a === b), polvoC.map(([m, a, b]) => m.slice(0, 8) + " " + a + "->" + b).join(", "));

  /* EL PRECIO SE MUEVE ANTES: una compra grande entra primero y la nuestra
     lleva el minimo de la cotizacion vieja. Tiene que revertir. */
  const cotAdv = await motor.cotizar({ ruta, lado: "compra", cantidad: caso.adverso, blockTag: bloque, modoPago: "valor" });
  const swapAdv = motor.construirSwap({ cotizacion: cotAdv, slippageBps: 10000, deadline: ts + 600 });
  const rAdv = await sonda({ llamadas: [swapAdv, planC.swap], monedas, cuentas, bloque });
  comprobar(caso.nombre, "[buy] after a " + ethers.formatUnits(caso.adverso, 6) + " USDC buy lands first, ours reverts on minOut", rAdv.ok[0] && !rAdv.ok[1],
    "front buy " + err(motor, rAdv, 0) + "; ours " + err(motor, rAdv, 1));

  /* ── VENTA de lo comprado ── */
  const vender = c.sale;
  let override = {}, previas = [], fondeo;
  const slot = await buscarSlotSaldo(token, SONDA, bloque);
  if (slot) {
    override = { [token]: { stateDiff: { [slot.clave]: ethers.toBeHex(vender, 32) } } };
    fondeo = "balance slot " + slot.tipo + (slot.slot !== undefined ? " " + slot.slot : "");
  } else if (caso.titular) {
    override = { [caso.titular]: { code: CODIGO_SONDA } };
    previas = [{ to: caso.titular, value: 0n, data: iSonda.encodeFunctionData("ejecutar", [[[token, 0n, iErc.encodeFunctionData("transfer", [SONDA, vender])]], [], []]) }];
    fondeo = "transfer from holder " + caso.titular;
  } else {
    throw new Error("no balance slot for " + token + " and no holder given");
  }
  const planV = await MOTOR.planificar({ ethers, Rutas, motor, rutas: d.rutas, lado: "venta", cantidad: vender,
    slippageBps: SLIPPAGE_BPS, usuario: SONDA, blockTag: bloque, ahora: ts, deadline: ts + 600 });
  const v = planV.cot;
  console.log("   sell log line: " + MOTOR.textoCotizacion(ethers, planV, "venta", "TOKEN", 18));
  console.log("   sell commands " + planV.swap.comandos + " (" + planV.swap.pasos.join(" / ") + ")  approvals: " + (planV.aprobaciones.map((a) => a.tipo).join(", ") || "none") + "  funded by " + fondeo);
  comprobar(caso.nombre, "[sell] every router payment goes to the signer (PAY_PORTION to MSG_SENDER)", MOTOR.comprobarDestinos(ethers, Rutas, planV.swap),
    planV.swap.inputs.map((inp, k) => ethers.getBytes(planV.swap.comandos)[k] === 0x06 ? "PAY_PORTION -> " + abi.decode(["address", "address", "uint256"], inp)[1] : null).filter(Boolean).join(", "));
  const exactas = planV.aprobaciones.every((a) => {
    if (a.tipo === "erc20-approve") { const [s, q] = iErc.decodeFunctionData("approve", a.data); return s.toLowerCase() === D.PERMIT2 && q === vender; }
    const [tk, sp, q, exp] = iP2.decodeFunctionData("approve", a.data);
    return tk.toLowerCase() === token && sp.toLowerCase() === UR && q === vender && Number(exp) === ts + 1800;
  });
  comprobar(caso.nombre, "[sell] approvals are for the exact amount (Permit2 for 30 min)", exactas && planV.aprobaciones.length > 0, planV.aprobaciones.map((a) => a.tipo).join(", "));

  /* Y despues del swap, lo que queda aprobado: se lee con dos llamadas mas. */
  const lecturas = [
    { to: token, value: 0n, data: iErc.encodeFunctionData("allowance", [SONDA, D.PERMIT2]) },
    { to: D.PERMIT2, value: 0n, data: iP2.encodeFunctionData("allowance", [SONDA, token, UR]) },
  ];
  const monedasV = monedas;
  const rv = await sonda({ llamadas: [...previas, ...planV.aprobaciones, planV.swap, ...lecturas], monedas: monedasV, cuentas, bloque, override });
  const S = previas.length + planV.aprobaciones.length;      // indice del swap
  const dV = (m, q) => rv.foto(S + 1, m, q) - rv.foto(S, m, q);
  comprobar(caso.nombre, "[sell] all calls succeeded", rv.ok.every(Boolean), rv.ok.map((o, k) => err(motor, rv, k)).join(" | ") + "  gas " + rv.gas[S]);
  comprobar(caso.nombre, "[sell] wallet sold exactly the input", -dV(token, SONDA) === vender, (-dV(token, SONDA)) + " vs " + vender);
  const monedaSalida = ruta.nativo ? NATIVO : USDC;
  const cobrado = dV(monedaSalida, SONDA);
  const minimoTotal = (v.sale * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;
  comprobar(caso.nombre, "[sell] received the WHOLE router output (the 1% came back too)", cobrado === v.sale,
    cobrado + " vs quote " + v.sale + (ruta.nativo ? " wei" : " USDC 6dec"));
  comprobar(caso.nombre, "[sell] received >= minOut", cobrado >= minimoTotal && cobrado - v.comision >= planV.swap.minSalida,
    cobrado + " >= " + minimoTotal + " (SWEEP part " + (cobrado - v.comision) + " >= " + planV.swap.minSalida + ")");
  comprobar(caso.nombre, "[sell] platform fee wallet received nothing", dV(NATIVO, PLATAFORMA) === 0n && dV(USDC, PLATAFORMA) === 0n,
    "native " + dV(NATIVO, PLATAFORMA) + ", USDC " + dV(USDC, PLATAFORMA));
  const polvoV = monedasV.map((m) => [m, rv.foto(0, m, UR), rv.foto(S + 1, m, UR)]);
  comprobar(caso.nombre, "[sell] no dust left in the UniversalRouter", polvoV.every(([, a, b]) => a === b), polvoV.map(([m, a, b]) => m.slice(0, 8) + " " + a + "->" + b).join(", "));
  const al = rv.ok[S + 1] ? BigInt(abi.decode(["uint256"], rv.ret[S + 1])[0]) : null;
  const p2 = rv.ok[S + 2] ? abi.decode(["uint160", "uint48", "uint48"], rv.ret[S + 2]) : null;
  /* Si el motor no pidio el approve del ERC-20 es que la moneda ya da a Permit2
     permiso infinito DE FABRICA (Solady, como BARC): ese no lo firmo nadie. */
  const pidioErc20 = planV.aprobaciones.some((a) => a.tipo === "erc20-approve");
  comprobar(caso.nombre, "[sell] nothing we approved stays approved after the swap", p2 && BigInt(p2[0]) === 0n && (pidioErc20 ? al === 0n : true),
    "token->Permit2 " + al + (pidioErc20 ? "" : " (the token's own built-in allowance, no approve was signed)") + ", Permit2->router " + (p2 ? p2[0] : null));
}

for (const caso of CASOS) {
  try { await probarCaso(caso); } catch (e) { comprobar(caso.nombre, "case ran to the end", false, e.stack || String(e)); }
}
const fallos = checks.filter((c) => !c.ok);
console.log("\n" + checks.length + " checks, " + fallos.length + " failed");
for (const f of fallos) console.log("FAIL " + f.caso + ": " + f.nombre + " — " + f.detalle);
process.exitCode = fallos.length ? 1 : 0;
