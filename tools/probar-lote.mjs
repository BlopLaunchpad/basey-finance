/* ===========================================================================
   PRUEBA DEL LOTE DE CARTERAS: la moneda NO puede cambiar a mitad del lote.

   Se ejecuta en Node desde la raiz del repo:
     node tools/probar-lote.mjs              el app.js del disco
     node tools/probar-lote.mjs otro/app.js  otro app.js (p. ej. uno de antes del arreglo)

   EL FALLO QUE CUBRE (14-sep): operarConElClúster leia `trToken`, que es el
   campo de la moneda y sigue abierto mientras el lote corre, en CADA cartera.
   Pegando otra direccion en el hueco entre dos, las que quedaban compraban o
   vendian LA NUEVA con la cantidad de su tarjeta, bajo una cabecera que decia
   la vieja. Cazado con carteras simuladas en warp: la segunda compro 0x897c en
   un lote de ARCX10. En V3 tambien: la venta leia el saldo, el tramo y el coste
   de la nueva con la moneda de entrada de la vieja.

   NO PRUEBA UNA COPIA: saca operarUnaConMotor y operarConElClúster del propio
   app.js y los ejecuta tal cual. Lo de alrededor (motor, Quoter, router,
   contratos) es falso: nada toca la red, nada se firma, y las direcciones son
   inventadas. Lo que se mira es QUE moneda opera cada cartera y que dice el log.

   ethers: ETHERS_PATH, "ethers", o el node_modules de cusp-web, blopfun-web o
   blop-indexer al lado de este repo. Sin rutas de disco escritas. */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const RUTA_APP = path.resolve(process.argv[2] || path.join(raiz, "app.js"));
const APP = fs.readFileSync(RUTA_APP, "utf8");
console.log("app.js tested: " + path.basename(RUTA_APP) + "  md5 " + crypto.createHash("md5").update(APP).digest("hex"));

/* ── SACAR LAS FUNCIONES DE app.js ── */
function extraer(cabecera) {
  const i = APP.indexOf(cabecera);
  if (i < 0 || APP.indexOf(cabecera, i + 1) >= 0) throw new Error("header missing or repeated: " + cabecera);
  const m = APP.slice(i).match(/\r?\n\}\r?\n/);
  if (!m) throw new Error("end not found: " + cabecera);
  return APP.slice(i, i + m.index + m[0].length);
}
const UNA = extraer("async function operarUnaConMotor(");
const LOTE = extraer("async function operarConElClúster(esCompra, solo) {");
if (!LOTE.includes("finally { btns.forEach")) throw new Error("operarConElCluster not extracted whole");
if (!UNA.includes("log(fila + \"done\", \"ok\")")) throw new Error("operarUnaConMotor not extracted whole");

/* ── LO FALSO DE ALREDEDOR ── */
const dir = (b) => "0x" + b.repeat(20);
const USDC = "0x3600000000000000000000000000000000000000";
const QUOTE = { address: USDC, symbol: "USDC", decimals: 6 };
const ROUTER = dir("e1");
const W = [0, 1, 2].map((k) => ({ address: dir("c" + k) }));
const min = (a) => String(a).toLowerCase();

/* Monedas inventadas. `motor.rutas[0].token` marca de quien es cada ruta. */
const M_A = { address: dir("a1"), symbol: "ARCX10", decimals: 18, fee: null, pool: null, motor: { rutas: [{ token: dir("a1") }] } };
const M_B = { address: dir("b2"), symbol: "0x897c", decimals: 18, fee: null, pool: null, motor: { rutas: [{ token: dir("b2") }] } };
const V3_A = { address: dir("a3"), symbol: "V3A", decimals: 18, fee: 3000, pool: dir("f3") };
const V3_C = { address: dir("c4"), symbol: "V3C", decimals: 18, fee: 10000, pool: dir("f4") };

let ev = [];        // lo que se habria firmado o cotizado, en orden
let lineas = [];    // el log del panel
let alLog = null;   // gancho: se llama con cada linea del log
let ganchos = {};   // gancho: dentro de las esperas de red
const el = { "#trBuy": { disabled: false }, "#trSell": { disabled: false }, "#trGap": { value: "0" } };
const $ = (s) => el[s] || { value: "", textContent: "", disabled: false };
const logger = () => (msg, cls) => { lineas.push((cls ? "[" + cls + "] " : "") + msg); if (alLog) alLog(msg, cls); };

class FalsoContrato {
  constructor(address, abi, runner) { this.address = address; this.runner = runner; }
  async balanceOf(quien) {
    ev.push({ tipo: "balanceOf", token: min(this.address), cartera: min(quien) });
    if (ganchos.balanceOf) await ganchos.balanceOf(this.address, quien);
    return 1000n * 10n ** 18n;
  }
  async exactInputSingle(p) {
    ev.push({ tipo: "swapV3", cartera: min(this.runner.address), tokenIn: min(p.tokenIn), tokenOut: min(p.tokenOut), fee: p.fee });
    return { hash: "0x" + "ab".repeat(32), wait: async () => ({}) };
  }
}
const E = Object.assign({}, ethers, { Contract: FalsoContrato });
const MOTOR = {
  operar: async (a) => {
    ev.push({ tipo: "motor", cartera: min(a.firmante.address), ruta: min(a.rutas[0].token), simbolo: a.simbolo, lado: a.lado });
    if (ganchos.operar) await ganchos.operar(a);
    return { plan: { cot: { ruta: { nativo: true } } }, recibo: { logs: [] } };
  },
  usdcGastado: () => 1,
  usdcDeVenta: () => 1,
};
const stubs = {
  ethers: E, MOTOR, window: { Rutas: {} }, QUOTE,
  proveedorRPC: () => ({ getTransactionReceipt: async () => ({ logs: [] }) }),
  $, logger,
  elegidas: (solo) => W.map((w, i) => ({ i, w, cantidad: 2, slippage: 5 })).filter((t) => !solo || solo.includes(t.i)),
  ["clúster"]: W,
  costeAnotar: (c, t) => ev.push({ tipo: "coste", cartera: min(c), token: min(t) }),
  pintarCarteras: () => {},
  etiquetaFila: (i) => "#" + i,
  readableError: (e) => (e && e.message) || String(e),
  motorDeRutas: () => ({}),
  cotizar: async (tin, tout, amt, fee) => { ev.push({ tipo: "cotizar", tokenIn: min(tin), tokenOut: min(tout), fee }); return amt; },
  permisoSuficiente: async () => {},
  ARC_SWAP_ROUTER: ROUTER, ROUTER_ABI: [], ERC20_ABI: [],
};
const nombres = Object.keys(stubs);
const cuerpo = "let trToken = null;\n" + UNA + "\n" + LOTE +
  "\nreturn { setT: (v) => { trToken = v; }, getT: () => trToken, operar: operarConElClúster };";
const app = new Function(...nombres, cuerpo)(...nombres.map((k) => stubs[k]));

/* ── COMPROBACIONES ── */
const checks = [];
function ok(nombre, cond, detalle) {
  checks.push({ nombre, ok: !!cond, detalle });
  console.log((cond ? "  ok   " : "  FAIL ") + nombre + (cond ? "" : "  :: " + String(detalle).slice(0, 600)));
}
async function lote({ nombre, token, esCompra, gap = "0", onLog = null, hooks = {} }) {
  console.log("\n## " + nombre);
  ev = []; lineas = []; alLog = onLog; ganchos = hooks;
  el["#trGap"].value = gap;
  app.setT(token);
  await app.operar(esCompra);
  alLog = null; ganchos = {};
  const r = { ev, lineas, parado: lineas.filter((l) => /stopped/.test(l)), fin: lineas.some((l) => /finished/.test(l)) };
  ok(nombre + ": buttons enabled again", !el["#trBuy"].disabled && !el["#trSell"].disabled, "buttons stay disabled");
  return r;
}
const deCartera = (r, tipo, k) => r.ev.filter((e) => e.tipo === tipo && e.cartera === min(W[k].address));
const resumen = (r) => JSON.stringify(r.ev.filter((e) => e.tipo !== "balanceOf")) + " | log " + JSON.stringify(r.lineas);
/* El campo cambia en cuanto la cartera #0 termina, antes de que empiece la #1. */
const alTerminarLa0 = (nueva) => (msg) => { if (/#0: done/.test(msg)) app.setT(nueva); };

/* S0 CONTROL: sin tocar el campo, el lote entero opera su moneda y acaba normal. */
{
  const r = await lote({ nombre: "S0 engine buy, field untouched", token: M_A, esCompra: true });
  const m = r.ev.filter((e) => e.tipo === "motor");
  ok("S0 all 3 wallets traded", m.length === 3, resumen(r));
  ok("S0 every trade used ARCX10's routes", m.every((e) => e.ruta === min(M_A.address) && e.simbolo === "ARCX10"), resumen(r));
  ok("S0 log says finished and never stopped", r.fin && r.parado.length === 0, resumen(r));
}

/* S1 EL HALLAZGO: lote de ARCX10 por el motor, el campo pasa a 0x897c tras la #0. */
{
  const r = await lote({ nombre: "S1 engine buy ARCX10, field switched to another engine token after #0", token: M_A, esCompra: true, onLog: alTerminarLa0(M_B) });
  const m = r.ev.filter((e) => e.tipo === "motor");
  ok("S1 header names ARCX10", /3 buying ARCX10/.test(r.lineas[0]), r.lineas[0]);
  ok("S1 no wallet traded the new token", m.every((e) => e.ruta === min(M_A.address)), resumen(r));
  ok("S1 wallets #1 and #2 were not traded at all", deCartera(r, "motor", 1).length === 0 && deCartera(r, "motor", 2).length === 0, resumen(r));
  ok("S1 the batch says it stopped, with 2 wallets left", r.parado.length === 1 && /ARCX10/.test(r.parado[0]) && /2 wallet\(s\) left untouched/.test(r.parado[0]), resumen(r));
  ok("S1 it does not also say finished", !r.fin, resumen(r));
  ok("S1 no cost noted against the new token", r.ev.filter((e) => e.tipo === "coste").every((e) => e.token === min(M_A.address)), resumen(r));
}

/* S2 EN EL HUECO ENTRE CARTERAS, como lo haria una persona: el campo se vacia
   (leerTokenDeCompra pone trToken a null mientras lee) y luego llega la nueva. */
{
  const r = await lote({ nombre: "S2 engine buy with a 0.05 s gap, field re-read to null then another token during the gap", token: M_A, esCompra: true, gap: "0.05",
    onLog: (msg) => { if (/#0: done/.test(msg)) { setTimeout(() => app.setT(null), 10); setTimeout(() => app.setT(M_B), 20); } } });
  const m = r.ev.filter((e) => e.tipo === "motor");
  ok("S2 only wallet #0 traded, and it traded ARCX10", m.length === 1 && m[0].cartera === min(W[0].address) && m[0].ruta === min(M_A.address), resumen(r));
  ok("S2 no V3 swap was attempted either", r.ev.filter((e) => e.tipo === "swapV3" || e.tipo === "cotizar").length === 0, resumen(r));
  ok("S2 the batch says it stopped", r.parado.length === 1 && !r.fin, resumen(r));
  ok("S2 no wallet logged an error (a null token must not reach the per-wallet code)", !r.lineas.some((l) => /^\[err\]\s+#/.test(l)), resumen(r));
}

/* S3 V3 -> MOTOR: una venta V3 no puede acabar cruzando al motor con otra moneda. */
{
  const r = await lote({ nombre: "S3 V3 sell, field switched to an engine token after #0", token: V3_A, esCompra: false, onLog: alTerminarLa0(M_B) });
  ok("S3 the engine was never called", r.ev.filter((e) => e.tipo === "motor").length === 0, resumen(r));
  ok("S3 only wallet #0 swapped, selling V3A", r.ev.filter((e) => e.tipo === "swapV3").length === 1 && deCartera(r, "swapV3", 0)[0].tokenIn === min(V3_A.address), resumen(r));
  ok("S3 the batch says it stopped", r.parado.length === 1 && /selling V3A/.test(r.parado[0]) && !r.fin, resumen(r));
}

/* S4 V3 -> V3 DE OTRO TRAMO: ni el tramo ni el coste pueden salir de la nueva. */
{
  const r = await lote({ nombre: "S4 V3 buy, field switched to another V3 token (1% tier) after #0", token: V3_A, esCompra: true, onLog: alTerminarLa0(V3_C) });
  const sw = r.ev.filter((e) => e.tipo === "swapV3");
  ok("S4 only wallet #0 swapped", sw.length === 1 && sw[0].cartera === min(W[0].address), resumen(r));
  ok("S4 every quote and swap used V3A and its 0.3% tier", sw.every((e) => e.tokenOut === min(V3_A.address) && e.fee === 3000) &&
     r.ev.filter((e) => e.tipo === "cotizar").every((e) => e.fee === 3000), resumen(r));
  ok("S4 no cost noted against V3C", r.ev.filter((e) => e.tipo === "coste").every((e) => e.token === min(V3_A.address)), resumen(r));
  ok("S4 the batch says it stopped", r.parado.length === 1 && !r.fin, resumen(r));
}

/* S5 A MITAD DE UNA CARTERA V3: el campo cambia mientras #0 lee su saldo, es
   decir DESPUES de la comprobacion del principio del bucle. La operacion de #0
   ya empezada tiene que acabar entera con la moneda del lote; un arreglo que
   solo pare el bucle y siga leyendo trToken.fee aqui mezcla dos monedas. */
{
  let hecho = false;
  const r = await lote({ nombre: "S5 V3 sell, field switched while wallet #0 reads its balance", token: V3_A, esCompra: false,
    hooks: { balanceOf: async () => { if (!hecho) { hecho = true; app.setT(V3_C); } } } });
  const b0 = deCartera(r, "balanceOf", 0), s0 = deCartera(r, "swapV3", 0), c0 = deCartera(r, "coste", 0);
  const q = r.ev.filter((e) => e.tipo === "cotizar");
  ok("S5 wallet #0 read its V3A balance", b0.length === 1 && b0[0].token === min(V3_A.address), resumen(r));
  ok("S5 wallet #0 quoted and swapped V3A on the 0.3% tier (not V3C's 1%)", q.length === 1 && q[0].fee === 3000 && s0.length === 1 && s0[0].tokenIn === min(V3_A.address) && s0[0].fee === 3000, resumen(r));
  ok("S5 wallet #0's cost is noted against V3A", c0.length === 1 && c0[0].token === min(V3_A.address), resumen(r));
  ok("S5 wallets #1 and #2 did nothing", deCartera(r, "balanceOf", 1).length + deCartera(r, "swapV3", 1).length + deCartera(r, "swapV3", 2).length === 0, resumen(r));
  ok("S5 the batch says it stopped, with 2 wallets left", r.parado.length === 1 && /2 wallet\(s\) left untouched/.test(r.parado[0]) && !r.fin, resumen(r));
}

/* S6 A MITAD DE UNA CARTERA DEL MOTOR: igual, mientras #0 esta dentro de operar. */
{
  let hecho = false;
  const r = await lote({ nombre: "S6 engine buy, field switched while wallet #0 is inside the engine", token: M_A, esCompra: true,
    hooks: { operar: async () => { if (!hecho) { hecho = true; app.setT(M_B); } } } });
  const c0 = deCartera(r, "coste", 0);
  ok("S6 wallet #0's cost is noted against ARCX10", c0.length === 1 && c0[0].token === min(M_A.address), resumen(r));
  ok("S6 wallets #1 and #2 were not traded", deCartera(r, "motor", 1).length === 0 && deCartera(r, "motor", 2).length === 0, resumen(r));
  ok("S6 the batch says it stopped", r.parado.length === 1 && !r.fin, resumen(r));
}

/* S7 UNA SOLA TARJETA (su boton Buy): mismo camino, sin cambio, acaba normal. */
{
  const r = await lote({ nombre: "S7 single-card engine buy, field untouched", token: M_A, esCompra: true });
  ok("S7 control still finishes", r.fin && r.parado.length === 0, resumen(r));
}

const fallidos = checks.filter((c) => !c.ok);
console.log("\n" + checks.length + " checks, " + fallidos.length + " failed");
for (const f of fallidos) console.log("FAIL " + f.nombre);
process.exitCode = fallidos.length ? 1 : 0;
