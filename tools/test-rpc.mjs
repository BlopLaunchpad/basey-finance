/* ===========================================================================
   PRUEBA DEL PROVEEDOR DE LA RÁPIDA, con un fetch falso.

   Se ejecuta en Node desde la raíz del repo:
     node tools/test-rpc.mjs          el código del disco: app.js + rpc.js
     node tools/test-rpc.mjs --old    el de HEAD, sacado con git show HEAD:app.js

   NO prueba una copia: saca `proveedorRPC()`, `readProvider()` y `rawCall()`
   del propio app.js y los ejecuta tal cual, con un `ethers` de verdad y la red
   falsa de abajo. Por eso la misma prueba vale para el código de antes y el de
   ahora.

   Lo que se prueba es lo que pasa a las 3 de la mañana y no se puede provocar
   sin machacar a un tercero: un 503, un 429, un 500, un nodo colgado, un
   "out of capacity", un nodo atrasado, y sobre todo QUÉ se reintenta al enviar
   y qué se le dice al usuario cuando la transacción YA salió.

   No firma nada y no toca la red. Los "envíos" son o un blob que no es una
   transacción, o una transacción con una firma FABRICADA (r = x(G), s = 1) que
   ninguna clave produjo: ethers la puede leer y sacarle hash, remitente y
   nonce, y nada más. fetch es falso de principio a fin.

   ethers: ETHERS_PATH, "ethers", o el node_modules de cusp-web o blopfun-web al
   lado de este repo. Sin rutas de disco escritas: el repo es público y GitHub
   Pages sirve este fichero. OJO: la página carga ethers 6.13.2 del CDN y aquí
   se prueba con el que haya; la prueba de navegador cubre la 6.13.2.

   DOS TRAMPAS DE LA PROPIA PRUEBA:
   - ethers guarda ~250 ms las peticiones idénticas en vuelo y las contesta de
     ahí. Tres getBalance iguales seguidos NO son tres preguntas a la red. Por
     eso cada vuelta cambia los parámetros, y donde importa se espera 300 ms.
   - Una prueba que pasa porque el nodo que debía fallar ni se preguntó no
     prueba nada: cada una comprueba en el registro que sí se preguntó.
   =========================================================================== */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VIEJO = process.argv.includes("--old");
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function cargarEthers() {
  const sitios = [process.env.ETHERS_PATH, "ethers",
    path.join(raiz, "..", "cusp-web", "node_modules", "ethers"),
    path.join(raiz, "..", "blopfun-web", "node_modules", "ethers")].filter(Boolean);
  for (const s of sitios) { try { return require(s); } catch { /* el siguiente */ } }
  throw new Error("ethers not found — set ETHERS_PATH to a node_modules/ethers folder");
}
const { ethers } = cargarEthers();

const A = "https://rpc.arc-scan.org";
const C = "https://thecusp.io/api/arc-rpc";
const N = "https://niorfun.com/api/rpc";
const DIR = "0x000000000000000000000000000000000000dEaD";
const DIR2 = "0x000000000000000000000000000000000000bEEF";
/* Una dirección distinta por vuelta, para que ethers no conteste de su caché */
const dirN = (k) => "0x" + (0x1000 + k).toString(16).padStart(40, "0");
const hex = (n) => "0x" + n.toString(16);
const QUOTER = "0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468";
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];
const SEL_QUOTE = new ethers.Interface(QUOTER_ABI).getFunction("quoteExactInputSingle").selector;
/* No es una transacción: son bytes cualquiera. Sirven igual para ver qué nodo
   los recibe, cuántas veces y si llegan idénticos. */
const BLOB = "0x02" + "ab".repeat(120);
const HASH = ethers.keccak256(BLOB);
/* Una transacción que ethers SÍ lee, con una firma que no salió de ninguna
   clave: r es la coordenada x del generador y s = 1. Nonce 7. */
const TX_FALSA = (() => {
  const tx = ethers.Transaction.from({ type: 2, chainId: 5042, nonce: 7, maxFeePerGas: 20000000000n,
    maxPriorityFeePerGas: 0n, gasLimit: 21000n, to: DIR2, value: 1n, data: "0x" });
  tx.signature = ethers.Signature.from({
    r: "0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    s: "0x0000000000000000000000000000000000000000000000000000000000000001", v: 27 });
  return tx;
})();
const RAW = TX_FALSA.serialized;
const RAW_HASH = TX_FALSA.hash;
const RAW_FROM = TX_FALSA.from;
const VUELTAS = 6;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── la red falsa ──────────────────────────────────────────────────────── */

let conducta = {};   // url -> (cuerpo, init) => Response ; "*" = el resto
let registro = [];   // cada POST: { url, metodos, cuerpo, tipo }

const lista = (c) => (Array.isArray(c) ? c : [c]);
const responder = (status, cuerpo, cabeceras = {}) =>
  new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), {
    /* statusText vacío a propósito: es lo que trae un navegador por HTTP/2 */
    status, statusText: "", headers: { "content-type": "application/json", ...cabeceras },
  });

const BLOQUE = {
  hash: "0x" + "11".repeat(32), parentHash: "0x" + "22".repeat(32), number: "0x10",
  timestamp: "0x68c6a000", nonce: "0x0000000000000000", difficulty: "0x0",
  gasLimit: "0x1c9c380", gasUsed: "0x5208", miner: "0x" + "00".repeat(20), extraData: "0x",
  baseFeePerGas: "0x4a817c800", transactions: [], stateRoot: "0x" + "33".repeat(32),
  receiptsRoot: "0x" + "44".repeat(32), sha3Uncles: "0x" + "55".repeat(32),
  logsBloom: "0x" + "00".repeat(256), size: "0x200", uncles: [],
};

function resultado(p) {
  switch (p.method) {
    case "eth_chainId": return "0x13b2";   // 5042: rpc.js lo pregunta una vez por nodo
    case "eth_getTransactionCount": return "0x7";
    case "eth_getBlockByNumber": return BLOQUE;
    case "eth_gasPrice": return "0x4a817c800";
    case "eth_maxPriorityFeePerGas": return "0x0";
    case "eth_getBalance": return "0x456391824508d41c";
    case "eth_estimateGas": return "0x7530";
    case "eth_blockNumber": return "0x10";
    case "eth_getTransactionReceipt": return null;
    case "eth_sendRawTransaction": return ethers.keccak256(p.params[0]);
    case "eth_call": {
      const w = (n) => n.toString(16).padStart(64, "0");
      const data = String((p.params[0] || {}).data || "");
      return data.startsWith(SEL_QUOTE) ? "0x" + w(123456789n) + w(1n) + w(1n) + w(90000n) : "0x" + w(200000000n);
    }
    default: return "0x0";
  }
}
const ok = (p) => ({ jsonrpc: "2.0", id: p.id, result: resultado(p) });
const mal = (p, code, message) => ({ jsonrpc: "2.0", id: p.id, error: { code, message } });

const porElemento = (fn, status = 200, cab = {}) => (c) => {
  const out = lista(c).map(fn);
  return responder(status, Array.isArray(c) ? out : out[0], cab);
};
const segun = (porMetodo, resto) => (c, init) => {
  const m = lista(c).map((p) => p.method).find((x) => porMetodo[x]);
  return m ? porMetodo[m](c, init) : resto(c, init);
};
/* Sano, pero con algunos resultados propios de ese nodo */
const sanoCon = (propios) => porElemento((p) =>
  (p.method in propios ? { jsonrpc: "2.0", id: p.id, result: propios[p.method] } : ok(p)));

/* Las formas de fallar, copiadas de lo medido el 14-sep-2026 */
const TEXTO_503 = "arc-scan.org could not complete this request. No answer was obtained, so nothing about the result should be assumed.";
const SANO = porElemento(ok);
/* Un nodo que dice su cadena cuando se le pregunta SÓLO eso (lo que rpc.js hace
   antes de darle un envío a un nodo que aún no la ha dicho) y lo demás lo
   contesta como `fn`. Sin esto, un nodo "que falla las lecturas" no llega nunca
   a recibir el envío que la prueba quiere ver. */
const conCadena = (fn) => (c, init) => (lista(c).every((p) => p.method === "eth_chainId") ? SANO(c, init) : fn(c, init));
const ARCSCAN_503 = porElemento((p) => mal(p, -32603, TEXTO_503), 503);
const LIMITE_429 = porElemento((p) => mal(p, -32005,
  "arc-scan.org is rate limiting requests from this client. Retry shortly."), 429, { "retry-after": "1" });
const LIMITE_EN_200 = porElemento((p) => mal(p, -32005, "arc-scan.org is rate limiting requests from this client. Retry shortly."));
const SIN_CAPACIDAD = porElemento((p) => mal(p, -32005, "arc-scan.org is temporarily out of capacity for " + p.method));
const HTTP_500 = porElemento((p) => mal(p, -32603, "Internal error"), 500);
const EDGE_503 = () => new Response("Service Unavailable", { status: 503, statusText: "", headers: { "content-type": "text/plain" } });
/* revierte lo que se le pida, pero su cadena la dice: un revert no es un nodo roto */
const REVIERTE = porElemento((p) => (p.method === "eth_chainId" ? ok(p) : mal(p, 3, "execution reverted")));
const YA_CONOCIDA = porElemento((p) => mal(p, -32000, "already known"));
const CUELGA = (c, init) => new Promise((_, rechazar) => {
  if (init && init.signal) init.signal.addEventListener("abort", () => rechazar(new DOMException("This operation was aborted", "AbortError")));
});
const RED_CAIDA = async () => { throw new TypeError("Failed to fetch"); };
/* El envío entra y toda lectura da el 503 de arc-scan. En un lote mezclado
   (el código viejo manda los dos juntos) cada elemento lleva lo suyo. */
const LEE_MAL_ENVIA_BIEN = conCadena((c) => {
  const l = lista(c);
  const out = l.map((p) => (p.method === "eth_sendRawTransaction" ? ok(p) : mal(p, -32603, TEXTO_503)));
  return responder(l.some((p) => p.method === "eth_sendRawTransaction") ? 200 : 503, Array.isArray(c) ? out : out[0]);
});
const LENTO = (ms, fn) => (c, init) => new Promise((resolver, rechazar) => {
  const t = setTimeout(() => resolver(fn(c, init)), ms);
  if (init && init.signal) init.signal.addEventListener("abort", () => {
    clearTimeout(t);
    rechazar(new DOMException("This operation was aborted", "AbortError"));
  });
});

async function fetchFalso(url, init = {}) {
  const cuerpo = JSON.parse(init.body);
  const cab = init.headers || {};
  registro.push({ url, metodos: lista(cuerpo).map((p) => p.method), cuerpo, tipo: cab["content-type"] || cab["Content-Type"] });
  const fn = conducta[url] || conducta["*"] || SANO;
  return fn(cuerpo, init);
}
globalThis.fetch = fetchFalso;

/* El código viejo usa el transporte de ethers, no fetch: se le da el mismo
   fetch falso, con el mismo reloj que `geturl-browser.js` (req.timeout). */
ethers.FetchRequest.registerGetUrl(async (req, signal) => {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), req.timeout);
  if (signal) signal.addListener(() => ctrl.abort());
  try {
    const res = await fetchFalso(req.url, {
      method: req.method, headers: req.headers,
      body: req.body ? Buffer.from(req.body).toString("utf8") : undefined, signal: ctrl.signal,
    });
    const headers = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { statusCode: res.status, statusMessage: res.statusText, headers, body: new Uint8Array(await res.arrayBuffer()) };
  } finally { clearTimeout(reloj); }
});

/* ── el código de app.js, tal cual ───────────────────────────────────────── */

const SRC = VIEJO
  ? execFileSync("git", ["show", "HEAD:app.js"], { cwd: raiz, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  : fs.readFileSync(path.join(raiz, "app.js"), "utf8");
const trozo = (re, que, opcional) => {
  const m = SRC.match(re);
  if (!m && opcional) return "";
  if (!m) throw new Error("could not find " + que + " in " + (VIEJO ? "HEAD:app.js" : "app.js"));
  return m[0];
};
const CODIGO = [
  /* sólo el código de antes tiene su propia lista: rawCall la recorría */
  trozo(/const FALLBACK_RPCS = [\s\S]*?;\r?\n/, "FALLBACK_RPCS", true),
  "let provRPC = null; const provider = null;",
  trozo(/function proveedorRPC\(\) \{[\s\S]*?\r?\n\}\r?\n/, "proveedorRPC()"),
  trozo(/function readProvider\(\) \{[\s\S]*?\r?\n\}\r?\n/, "readProvider()"),
  trozo(/async function rawCall\(method, params\) \{[\s\S]*?\r?\n\}\r?\n/, "rawCall()"),
  "return { proveedorRPC, readProvider, rawCall };",
].join("\n");

let mod = {};
if (!VIEJO) {
  mod = await import(pathToFileURL(path.join(raiz, "rpc.js")).href);
  const T = mod.TIEMPOS;
  console.log("production timeouts: read " + T.lecturaMs + " ms (thecusp " + T.lecturaProxyMs + " ms), send " + T.envioMs +
    " ms, penalty " + T.castigoMs + " ms, preflight " + T.preflightMs + " ms, batch cap " + mod.LOTE_MAXIMO +
    ", height margin " + mod.MARGEN_BLOQUES + " blocks; clocks shrunk below for the test");
  T.lecturaMs = 250;
  T.lecturaProxyMs = 320;
  T.envioMs = 400;
  T.getLogsMs = 400;
}
const nuevaApp = () => new Function("ethers", "ARC", "crearProveedorRotativo", "NODOS_ARC", CODIGO)(
  ethers, { chainId: 5042 }, mod.crearProveedorRotativo, mod.NODOS_ARC);

/* ── las pruebas ─────────────────────────────────────────────────────────── */

const PLAZO = 3000;
const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });
const assert = (c, msg) => { if (!c) throw new Error(msg); };
/* Lo mismo que readableError() en app.js: shortMessage primero */
const mensaje = (e) => (e && (e.shortMessage || e.reason || e.message)) || String(e);
const pedidos = (metodo, url) => registro.filter((r) => r.metodos.includes(metodo) && (!url || r.url === url));

async function plazo(promesa, que) {
  let t;
  try {
    return await Promise.race([promesa, new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error("no answer after " + PLAZO + " ms (" + que + ")")), PLAZO);
    })]);
  } finally { clearTimeout(t); }
}
async function debeFallar(promesa, que) {
  try { await plazo(promesa, que); } catch (e) { return e; }
  throw new Error(que + " resolved, and it should have failed");
}

/* Para que la lectura de antes deje a arc-scan sano y al resto sin contestar
   lecturas: así el envío va primero a arc-scan, que es el caso real. */
const RESTO_SOLO_ENVIA = (envio) => conCadena(segun({ eth_sendRawTransaction: envio }, EDGE_503));

function lecturaQueFallaEnA(nombre, fallo) {
  prueba("read: " + nombre + " on rpc.arc-scan.org -> balance still read", async (app) => {
    conducta[A] = fallo;
    const p = app.proveedorRPC();
    for (let k = 0; k < VUELTAS && !pedidos("eth_getBalance", A).length; k++) {
      const b = await plazo(p.getBalance(dirN(k)), "getBalance #" + (k + 1));
      assert(b === 0x456391824508d41cn, "wrong balance " + b);
    }
    assert(pedidos("eth_getBalance", A).length >= 1, "rpc.arc-scan.org was never asked, the test proves nothing");
  });
}
lecturaQueFallaEnA("HTTP 503 (its real body)", ARCSCAN_503);
lecturaQueFallaEnA("HTTP 429 rate limit", LIMITE_429);
lecturaQueFallaEnA("HTTP 500", HTTP_500);
lecturaQueFallaEnA("a hang (timeout)", CUELGA);
lecturaQueFallaEnA("a network error (Failed to fetch)", RED_CAIDA);

prueba("read: JSON-RPC \"out of capacity\" on the quote -> quote comes from the next node", async (app) => {
  conducta[A] = segun({ eth_call: SIN_CAPACIDAD }, SANO);
  const q = new ethers.Contract(QUOTER, QUOTER_ABI, app.proveedorRPC());
  for (let k = 0; k < VUELTAS && !pedidos("eth_call", A).length; k++) {
    const r = await plazo(q.quoteExactInputSingle.staticCall({
      tokenIn: DIR, tokenOut: DIR2, amountIn: 1000000n + BigInt(k), fee: 10000, sqrtPriceLimitX96: 0n,
    }), "quote #" + (k + 1));
    assert(r[0] === 123456789n, "wrong quote " + r[0]);
  }
  assert(pedidos("eth_call", A).length >= 1, "rpc.arc-scan.org was never asked, the test proves nothing");
});

prueba("read: \"execution reverted\" is the chain's answer -> NOT asked again elsewhere", async (app) => {
  conducta["*"] = REVIERTE;
  const q = new ethers.Contract(QUOTER, QUOTER_ABI, app.proveedorRPC());
  const e = await debeFallar(q.quoteExactInputSingle.staticCall({
    tokenIn: DIR, tokenOut: DIR2, amountIn: 1n, fee: 10000, sqrtPriceLimitX96: 0n,
  }), "reverting quote");
  assert(e.code === "CALL_EXCEPTION", "expected CALL_EXCEPTION, got " + e.code + " " + mensaje(e));
  assert(pedidos("eth_call").length === 1, "a revert was asked " + pedidos("eth_call").length + " times");
});

prueba("batch: one element fails inside the fee-data batch -> only that one is retried", async (app) => {
  conducta[A] = porElemento((p) => (p.method === "eth_getBlockByNumber"
    ? mal(p, -32005, "arc-scan.org is temporarily out of capacity for eth_getBlockByNumber") : ok(p)));
  const p = app.proveedorRPC();
  const loteEnA = () => registro.findIndex((r) => r.url === A && r.metodos.length > 1 && r.metodos.includes("eth_getBlockByNumber"));
  for (let k = 0; k < VUELTAS && loteEnA() < 0; k++) {
    if (k) await espera(300);   // el lote de gas es idéntico: que caduque la caché de ethers
    const tx = await plazo(new ethers.VoidSigner(dirN(k), p).populateTransaction({ to: DIR2, value: 1n, gasLimit: 30000n }),
      "populate #" + (k + 1));
    assert(tx.nonce === 7 && tx.maxFeePerGas != null, "populate came back incomplete");
  }
  const i = loteEnA();
  assert(i >= 0, "rpc.arc-scan.org never got the fee-data batch, the test proves nothing");
  const siguiente = registro[i + 1];
  assert(siguiente && siguiente.url !== A && siguiente.metodos.filter((m) => m !== "eth_chainId").join() === "eth_getBlockByNumber",
    "after the partial failure the next request was " + JSON.stringify(siguiente && siguiente.metodos));
});

prueba("withdraw-shaped flow with rpc.arc-scan.org answering 503 to everything", async (app) => {
  conducta[A] = ARCSCAN_503;
  const p = app.proveedorRPC();
  const tx = await plazo(new ethers.VoidSigner(DIR, p).populateTransaction({ to: DIR2, value: 10n ** 18n, gasLimit: 30000n }), "populate");
  assert(tx.nonce === 7 && tx.maxFeePerGas != null, "populate came back incomplete");
  const h = await plazo(p.send("eth_sendRawTransaction", [BLOB]), "broadcast");
  assert(h === HASH, "wrong hash " + h);
  const rec = await plazo(p.getTransactionReceipt(h), "receipt");
  assert(rec === null, "receipt should be null in the fake chain");
  assert(pedidos("eth_sendRawTransaction").length === 1, "the transaction went out " + pedidos("eth_sendRawTransaction").length + " times");
  assert(registro.some((r) => r.url === A), "rpc.arc-scan.org was never asked, the test proves nothing");
});

prueba("send: HTTP 429 (clean rejection) -> sent once through the next node, same bytes", async (app) => {
  conducta[A] = segun({ eth_sendRawTransaction: LIMITE_429 }, SANO);
  conducta["*"] = RESTO_SOLO_ENVIA(SANO);
  const p = app.proveedorRPC();
  await plazo(p.getBalance(DIR), "read before the send");
  const h = await plazo(p.send("eth_sendRawTransaction", [BLOB]), "send");
  assert(h === HASH, "wrong hash " + h);
  const envios = pedidos("eth_sendRawTransaction");
  assert(envios.length === 2 && envios[0].url === A && envios[1].url !== A,
    "sends went to " + JSON.stringify(envios.map((r) => r.url)));
  assert(envios.every((r) => lista(r.cuerpo)[0].params[0] === BLOB), "the retried bytes differ from the signed ones");
});

prueba("send: a hang (timeout) -> NOT retried, and it says it may have gone out", async (app) => {
  conducta[A] = segun({ eth_sendRawTransaction: CUELGA }, SANO);
  conducta["*"] = RESTO_SOLO_ENVIA(SANO);
  const p = app.proveedorRPC();
  await plazo(p.getBalance(DIR), "read before the send");
  const e = await debeFallar(p.send("eth_sendRawTransaction", [BLOB]), "send");
  assert(/may or may not have been broadcast/.test(mensaje(e)), "message was: " + mensaje(e));
  assert(pedidos("eth_sendRawTransaction").length === 1, "a timed-out send was retried");
});

prueba("send: arc-scan's own 503 (\"No answer was obtained\") -> NOT retried", async (app) => {
  conducta[A] = segun({ eth_sendRawTransaction: ARCSCAN_503 }, SANO);
  conducta["*"] = RESTO_SOLO_ENVIA(SANO);
  const p = app.proveedorRPC();
  await plazo(p.getBalance(DIR), "read before the send");
  const e = await debeFallar(p.send("eth_sendRawTransaction", [BLOB]), "send");
  assert(pedidos("eth_sendRawTransaction").length === 1, "an ambiguous send was retried");
  assert(/may or may not have been broadcast/.test(mensaje(e)), "message was: " + mensaje(e));
});

prueba("send: HTTP 500 -> NOT retried", async (app) => {
  conducta[A] = segun({ eth_sendRawTransaction: HTTP_500 }, SANO);
  conducta["*"] = RESTO_SOLO_ENVIA(SANO);
  const p = app.proveedorRPC();
  await plazo(p.getBalance(DIR), "read before the send");
  const e = await debeFallar(p.send("eth_sendRawTransaction", [BLOB]), "send");
  assert(pedidos("eth_sendRawTransaction").length === 1, "an ambiguous send was retried");
  assert(/may or may not have been broadcast/.test(mensaje(e)), "message was: " + mensaje(e));
});

prueba("send: rate limit, then \"already known\" on the next node -> treated as sent", async (app) => {
  conducta[A] = segun({ eth_sendRawTransaction: LIMITE_EN_200 }, SANO);
  conducta["*"] = RESTO_SOLO_ENVIA(YA_CONOCIDA);
  const p = app.proveedorRPC();
  await plazo(p.getBalance(DIR), "read before the send");
  const h = await plazo(p.send("eth_sendRawTransaction", [BLOB]), "send");
  assert(h === HASH, "expected the transaction hash, got " + h);
  assert(pedidos("eth_sendRawTransaction").length === 2, "expected exactly one retry");
});

/* ── lo que cazó la revisión adversarial del 14-sep ─────────────────────── */

prueba("broadcast: a node took the transaction and no node answers eth_blockNumber -> it says it was sent, never \"Try again\"", async (app) => {
  conducta["*"] = LEE_MAL_ENVIA_BIEN;
  const p = app.proveedorRPC();
  let m = null, h = null;
  try { h = (await plazo(p.broadcastTransaction(RAW), "broadcast")).hash; } catch (e) { m = mensaje(e); }
  assert(pedidos("eth_sendRawTransaction").length >= 1, "the send never went out, the test proves nothing");
  if (m == null) {
    assert(h === RAW_HASH, "wrong hash " + h);
  } else {
    assert(!/try again/i.test(m), "an accepted transaction was reported as: " + m);
    assert(m.toLowerCase().includes(RAW_HASH.toLowerCase()) && /already sent/.test(m), "the message does not say it was sent: " + m);
  }
});

prueba("broadcast: same, with a block seen moments before -> resolves with the hash", async (app) => {
  const p = app.proveedorRPC();
  await plazo(p.getBlockNumber(), "block number before");
  await espera(300);   // ethers contesta el mismo getBlockNumber de su caché ~250 ms
  conducta["*"] = LEE_MAL_ENVIA_BIEN;
  const antes = registro.length;
  const tx = await plazo(p.broadcastTransaction(RAW), "broadcast");
  assert(tx.hash === RAW_HASH, "wrong hash " + tx.hash);
  assert(registro.slice(antes).some((r) => r.metodos.includes("eth_blockNumber")),
    "eth_blockNumber was not asked after the network broke, the test proves nothing");
});

prueba("tx.wait(): no node answers the receipt of an accepted send -> it says it was sent, never \"Try again\"", async (app) => {
  const p = app.proveedorRPC();
  await plazo(p.getBlockNumber(), "block number before");
  await espera(300);
  conducta["*"] = LEE_MAL_ENVIA_BIEN;
  const tx = await plazo(p.broadcastTransaction(RAW), "broadcast");
  const e = await debeFallar(tx.wait(), "wait");
  const m = mensaje(e);
  assert(pedidos("eth_getTransactionReceipt").length >= 1, "the receipt was never asked, the test proves nothing");
  assert(!/try again/i.test(m) && m.toLowerCase().includes(RAW_HASH.toLowerCase()), "message was: " + m);
});

prueba("broadcast: the send is ambiguous AND the reads fail -> the user reads the send's \"may or may not\"", async (app) => {
  conducta[A] = conCadena(ARCSCAN_503);
  conducta[C] = LIMITE_429;
  conducta[N] = RED_CAIDA;
  const e = await debeFallar(app.proveedorRPC().broadcastTransaction(RAW), "broadcast");
  const m = mensaje(e);
  assert(pedidos("eth_sendRawTransaction").length >= 1, "the send never went out, the test proves nothing");
  assert(/may or may not have been broadcast/.test(m) && !/try again/i.test(m), "message was: " + m);
});

prueba("order: every node healthy, 20 fresh providers -> reads start at rpc.arc-scan.org, no send starts at niorfun", async () => {
  for (let k = 0; k < 20; k++) {
    registro = [];
    const p = nuevaApp().proveedorRPC();
    await plazo(new ethers.VoidSigner(dirN(k), p).populateTransaction({ to: DIR2, value: 1n, gasLimit: 30000n }), "populate");
    await plazo(p.send("eth_sendRawTransaction", [BLOB]), "send");
    assert(registro[0].url === A, "round " + k + ": the first read went to " + registro[0].url);
    const primero = pedidos("eth_sendRawTransaction")[0];
    assert(primero && primero.url !== N, "round " + k + ": the send went to niorfun first");
  }
});

prueba("height: a node 50 blocks behind the head already seen is not believed, and is set aside", async (app) => {
  const CABEZA = 0x100000;
  conducta[A] = sanoCon({ eth_blockNumber: hex(CABEZA) });
  conducta[C] = sanoCon({ eth_getBlockByNumber: { ...BLOQUE, number: hex(CABEZA - 50) }, eth_getBalance: "0x1" });
  conducta[N] = sanoCon({ eth_getBlockByNumber: { ...BLOQUE, number: hex(CABEZA) }, eth_getBalance: "0x2" });
  const p = app.proveedorRPC();
  await plazo(p.getBlockNumber(), "head from rpc.arc-scan.org");
  conducta[A] = ARCSCAN_503;
  const b = await plazo(p.getBlock("latest"), "latest block");
  assert(pedidos("eth_getBlockByNumber", C).length === 1, "thecusp was never asked, the test proves nothing");
  assert(b.number === CABEZA, "believed block " + b.number + " from a node 50 blocks behind");
  const bal = await plazo(p.getBalance(DIR), "balance after");
  assert(bal === 2n, "the next read went to " + (bal === 1n ? "the node just found 50 blocks behind" : "? (" + bal + ")"));
});

prueba("nonce: after this page sends nonce 7 from a wallet, a node still saying 7 is not believed", async (app) => {
  const p = app.proveedorRPC();
  await plazo(p.send("eth_sendRawTransaction", [RAW]), "send nonce 7");
  conducta[A] = sanoCon({ eth_getTransactionCount: "0x7" });
  conducta["*"] = sanoCon({ eth_getTransactionCount: "0x8" });
  const n = await plazo(p.getTransactionCount(RAW_FROM, "pending"), "pending nonce");
  assert(pedidos("eth_getTransactionCount", A).length === 1, "rpc.arc-scan.org was never asked, the test proves nothing");
  assert(n === 8, "believed pending nonce " + n);
  await plazo(p.getTransactionCount(RAW_FROM, "latest"), "latest nonce (tx.wait asks it, it must not be blocked)");
});

prueba("id: a single answer carrying a DIFFERENT id is a node failure, not the answer", async (app) => {
  conducta[A] = () => responder(200, { jsonrpc: "2.0", id: 424242, result: "0x1" });
  const b = await plazo(app.proveedorRPC().getBalance(DIR), "getBalance");
  assert(pedidos("eth_getBalance", A).length === 1, "rpc.arc-scan.org was never asked, the test proves nothing");
  assert(b === 0x456391824508d41cn, "believed the answer with id 424242: " + b);
});

prueba("preflight: text/plain to rpc.arc-scan.org and niorfun, JSON to thecusp (its handler needs it)", async (app) => {
  conducta[A] = ARCSCAN_503;
  conducta[C] = HTTP_500;
  await plazo(app.proveedorRPC().getBalance(DIR), "getBalance");
  const tipo = (u) => (registro.find((r) => r.url === u) || {}).tipo;
  assert(tipo(A) === "text/plain" && tipo(N) === "text/plain" && tipo(C) === "application/json",
    "content-types: " + JSON.stringify({ arcscan: tipo(A), thecusp: tipo(C), niorfun: tipo(N) }));
});

prueba("send: after an ambiguous send on rpc.arc-scan.org the next starts elsewhere; thecusp gets a read first, and when it fails the send never reaches it", async (app) => {
  const castigo = mod.TIEMPOS && mod.TIEMPOS.castigoMs;
  if (mod.TIEMPOS) mod.TIEMPOS.castigoMs = 50;
  try {
    conducta[A] = conCadena(ARCSCAN_503);
    conducta[C] = RED_CAIDA;
    const p = app.proveedorRPC();
    await debeFallar(p.send("eth_sendRawTransaction", [BLOB]), "first send (ambiguous at rpc.arc-scan.org)");
    await espera(80);   // castigo acabado: sólo el historial de envíos aparta ya a arc-scan
    const h = await plazo(p.send("eth_sendRawTransaction", [BLOB]), "second send");
    assert(h === HASH, "wrong hash " + h);
    const envios = pedidos("eth_sendRawTransaction");
    assert(registro.some((r) => r.url === C), "thecusp was never tried, the test proves nothing");
    assert(envios.length === 2 && envios[0].url === A && envios[1].url === N,
      "sends went to " + JSON.stringify(envios.map((r) => r.url)));
  } finally { if (mod.TIEMPOS) mod.TIEMPOS.castigoMs = castigo; }
});

prueba("clock: thecusp.io gets its own longer clock -- a correct answer past the read clock is kept", async (app) => {
  conducta[A] = ARCSCAN_503;
  conducta[C] = LENTO(280, sanoCon({ eth_getBalance: "0x5" }));
  const b = await plazo(app.proveedorRPC().getBalance(DIR), "getBalance");
  assert(pedidos("eth_getBalance", C).length === 1, "thecusp was never asked, the test proves nothing");
  assert(b === 5n, "balance " + b + " did not come from thecusp");
  assert(!pedidos("eth_getBalance", N).length, "niorfun was asked: thecusp's slow but correct answer was thrown away");
});

prueba("rawCall: a node already seen hanging is not waited on again", async (app) => {
  conducta[A] = ARCSCAN_503;
  conducta[C] = CUELGA;
  const b1 = await plazo(app.rawCall("eth_getBalance", [dirN(1), "latest"]), "rawCall #1");
  const antes = registro.filter((r) => r.url === C).length;
  const b2 = await plazo(app.rawCall("eth_getBalance", [dirN(2), "latest"]), "rawCall #2");
  assert(b1 === "0x456391824508d41c" && b2 === b1, "wrong balance " + b1 + " / " + b2);
  assert(registro.filter((r) => r.url === C).length === antes, "rawCall asked the hanging thecusp.io again");
});

prueba("rawCall: nothing answers -> the error still carries noNode (readToken reads it)", async (app) => {
  conducta["*"] = ARCSCAN_503;
  const e = await debeFallar(app.rawCall("eth_call", [{ to: DIR, data: "0x" }, "latest"]), "rawCall");
  assert(e.noNode === true, "noNode missing: " + mensaje(e));
});

prueba("every node down -> the message names them (not \"could not coalesce error\")", async (app) => {
  conducta["*"] = ARCSCAN_503;
  const e = await debeFallar(app.proveedorRPC().getBalance(DIR), "getBalance");
  const m = mensaje(e);
  assert(/rpc\.arc-scan\.org/.test(m) && !/could not coalesce|server response/.test(m), "message was: " + m);
});

prueba("readProvider() without a wallet is not pinned to one node either", async (app) => {
  conducta[A] = ARCSCAN_503;
  for (let k = 0; k < VUELTAS && !pedidos("eth_getBalance", A).length; k++) {
    await plazo(app.readProvider().getBalance(dirN(k)), "getBalance #" + (k + 1));
  }
  assert(pedidos("eth_getBalance", A).length >= 1, "rpc.arc-scan.org was never asked, the test proves nothing");
});

prueba("chain stays pinned to 5042 (no eth_chainId round trip of its own) and polling stays at 500 ms", async (app) => {
  const p = app.proveedorRPC();
  await plazo(p.getBalance(DIR), "getBalance");
  const red = await p.getNetwork();
  assert(red.chainId === 5042n, "chainId " + red.chainId);
  assert(p.pollingInterval === 500, "pollingInterval " + p.pollingInterval);
  /* rpc.js pregunta eth_chainId a cada nodo, pero DENTRO de su primer lote */
  assert(!registro.some((r) => r.metodos.length === 1 && r.metodos[0] === "eth_chainId"), "eth_chainId was asked in a request of its own");
});

/* ── lo que cazó la segunda revisión adversarial del 14-sep ─────────────── */

prueba("nonce: accepted nonce 7 is dropped and every node keeps saying 7 -> the next populates still get 7, the wallet is not locked", async (app) => {
  const p = app.proveedorRPC();
  const h = await plazo(p.send("eth_sendRawTransaction", [RAW]), "send nonce 7");
  assert(h === RAW_HASH, "the send was not accepted, the test proves nothing: " + h);
  for (let k = 0; k < 2; k++) {
    if (k) await espera(300);
    const tx = await plazo(new ethers.VoidSigner(RAW_FROM, p).populateTransaction({ to: DIR2, value: BigInt(k + 1), gasLimit: 30000n }),
      "populate #" + (k + 1));
    assert(tx.nonce === 7, "populate #" + (k + 1) + " gave nonce " + tx.nonce);
  }
  assert(pedidos("eth_getTransactionCount", A).length >= 1, "rpc.arc-scan.org was never asked, the test proves nothing");
});

for (const [nombre, envio] of [
  ["HTTP 200 with result null", porElemento((q) => ({ jsonrpc: "2.0", id: q.id, result: null }))],
  ["HTTP 200 with another transaction's hash", porElemento((q) => ({ jsonrpc: "2.0", id: q.id, result: "0x" + "ab".repeat(32) }))],
  ["\"unknown transaction type\" (it contains \"known transaction\")", porElemento((q) => mal(q, -32000, "unknown transaction type"))],
]) {
  prueba("send: " + nombre + " is not an accepted send -> no hash, no \"already sent\", no nonce floor", async (app) => {
    conducta[A] = segun({ eth_sendRawTransaction: envio }, SANO);
    const p = app.proveedorRPC();
    let h, m = null;
    try { h = await plazo(p.send("eth_sendRawTransaction", [RAW]), "send"); } catch (e) { m = mensaje(e); }
    assert(pedidos("eth_sendRawTransaction", A).length === 1, "rpc.arc-scan.org never got the send, the test proves nothing");
    assert(m != null, "the send resolved with " + JSON.stringify(h));
    assert(/may or may not have been broadcast/.test(m) && !/already sent/.test(m), "message was: " + m);
    conducta = {};
    const antes = pedidos("eth_getTransactionCount").length;
    const n = await plazo(p.getTransactionCount(RAW_FROM, "pending"), "pending nonce");
    const veces = pedidos("eth_getTransactionCount").length - antes;
    assert(n === 7 && veces === 1, "pending nonce " + n + " asked " + veces + " times: a nonce floor was set for a send nobody accepted");
  });
}

prueba("height: ONE far-ahead head (+100000), then honest nodes -> getBlockNumber and populate still work", async (app) => {
  conducta[A] = sanoCon({ eth_blockNumber: hex(0x10 + 100000) });
  const p = app.proveedorRPC();
  const falsa = await plazo(p.getBlockNumber(), "the wrong head");
  assert(falsa === 0x10 + 100000, "the wrong head was not read, the test proves nothing: " + falsa);
  conducta = {};
  await espera(300);
  const b = await plazo(p.getBlockNumber(), "getBlockNumber, every node honest");
  assert(b === 0x10, "block " + b);
  await espera(300);
  const tx = await plazo(new ethers.VoidSigner(dirN(1), p).populateTransaction({ to: DIR2, value: 1n, gasLimit: 30000n }), "populate");
  assert(tx.nonce === 7 && tx.maxFeePerGas != null, "populate came back incomplete");
});

prueba("already sent: the note goes on reads about that transaction or its wallet, not on another wallet's", async (app) => {
  const p = app.proveedorRPC();
  const h = await plazo(p.send("eth_sendRawTransaction", [RAW]), "send nonce 7");
  assert(h === RAW_HASH, "the send was not accepted, the test proves nothing: " + h);
  conducta["*"] = ARCSCAN_503;
  const otra = mensaje(await debeFallar(p.getBalance(DIR), "balance of another wallet"));
  assert(!/already sent/.test(otra) && /try again/i.test(otra), "another wallet's read said: " + otra);
  const recibo = mensaje(await debeFallar(p.getTransactionReceipt(RAW_HASH), "receipt of the sent transaction"));
  assert(recibo.toLowerCase().includes(RAW_HASH.toLowerCase()) && /already sent/.test(recibo), "the receipt read said: " + recibo);
  const suya = mensaje(await debeFallar(p.getBalance(RAW_FROM), "balance of the sending wallet"));
  assert(/already sent/.test(suya) && !/try again/i.test(suya), "the sending wallet's read said: " + suya);
});

prueba("send: a balancer 503 took the POST, then \"nonce too low\" on the next node -> \"may or may not\", not the chain's answer", async (app) => {
  conducta[A] = segun({ eth_sendRawTransaction: EDGE_503 }, SANO);
  conducta["*"] = RESTO_SOLO_ENVIA(porElemento((q) => mal(q, -32000, "nonce too low: next nonce 8, tx nonce 7")));
  const p = app.proveedorRPC();
  await plazo(p.getBalance(DIR), "read before the send");
  const m = mensaje(await debeFallar(p.send("eth_sendRawTransaction", [RAW]), "send"));
  const envios = pedidos("eth_sendRawTransaction");
  assert(envios.length === 2 && envios[0].url === A, "sends went to " + JSON.stringify(envios.map((r) => r.url)) + ", the test proves nothing");
  assert(/may or may not have been broadcast/.test(m) && !/nonce has already been used/.test(m), "message was: " + m);
});

/* ── lo que cazó la tercera revisión adversarial del 14-sep ─────────────── */

prueba("chain: a node that answers ANOTHER chain id is never used -- not for a read when the others fail, not for a send -- and the error says why", async (app) => {
  conducta[N] = sanoCon({ eth_chainId: "0x4cef52", eth_getBalance: "0x0", eth_blockNumber: hex(0x10 + 1000000), eth_getTransactionCount: "0x96" });
  conducta[A] = ARCSCAN_503;
  conducta[C] = LIMITE_429;
  const p = app.proveedorRPC();
  let b = null, m = null;
  try { b = await plazo(p.getBalance(DIR), "balance while rpc.arc-scan.org and thecusp fail"); } catch (e) { m = mensaje(e); }
  assert(pedidos("eth_getBalance", N).length === 1, "niorfun was never asked, the test proves nothing");
  assert(m != null, "read a balance of " + b + " from a node on chain 5042002");
  assert(/niorfun\.com answered chain id 5042002/.test(m), "the error does not say why niorfun was not used: " + m);
  conducta[A] = segun({ eth_sendRawTransaction: LIMITE_429 }, SANO);
  conducta[C] = conCadena(segun({ eth_sendRawTransaction: LIMITE_429 }, SANO));
  let h = null, m2 = null;
  try { h = await plazo(p.send("eth_sendRawTransaction", [RAW]), "send while arc-scan and thecusp refuse it"); } catch (e) { m2 = mensaje(e); }
  assert(pedidos("eth_sendRawTransaction", A).length === 1, "rpc.arc-scan.org never got the send, the test proves nothing");
  assert(!pedidos("eth_sendRawTransaction", N).length, "the signed transaction went to the node on another chain");
  assert(m2 != null && /not broadcast/.test(m2), "the send came back with: " + (m2 || h));
  assert(registro.filter((r) => r.url === N).length === 1, "niorfun was asked again after answering another chain id");
});

prueba("chain: eth_chainId rides inside the first batch to a node (no extra round trip), and only a 5042 answer is kept", async (app) => {
  const castigo = mod.TIEMPOS && mod.TIEMPOS.castigoMs;
  if (mod.TIEMPOS) mod.TIEMPOS.castigoMs = 50;
  try {
    conducta[A] = ARCSCAN_503;
    const p = app.proveedorRPC();
    await plazo(p.getBalance(dirN(1)), "balance #1, rpc.arc-scan.org down");
    conducta = {};
    await espera(80);   // castigo acabado: rpc.arc-scan.org vuelve a ir primero
    await plazo(p.getBalance(dirN(2)), "balance #2, rpc.arc-scan.org back");
    await plazo(p.getBalance(dirN(3)), "balance #3");
    const enA = registro.filter((r) => r.url === A).map((r) => r.metodos.join("+"));
    assert(JSON.stringify(enA) === JSON.stringify(["eth_chainId+eth_getBalance", "eth_chainId+eth_getBalance", "eth_getBalance"]),
      "requests to rpc.arc-scan.org: " + JSON.stringify(enA));
    assert(!registro.some((r) => r.metodos.length === 1 && r.metodos[0] === "eth_chainId"), "eth_chainId went out on its own");
  } finally { if (mod.TIEMPOS) mod.TIEMPOS.castigoMs = castigo; }
});

prueba("height: after an honest head, ONE node 100000 blocks ahead is not believed alone; a second node saying the same is", async (app) => {
  const p = app.proveedorRPC();
  const b0 = await plazo(p.getBlockNumber(), "honest head");
  assert(b0 === 0x10, "honest head " + b0);
  await espera(300);
  conducta[A] = ARCSCAN_503;
  conducta[C] = LIMITE_429;
  conducta[N] = sanoCon({ eth_blockNumber: hex(0x10 + 100000) });
  let b1 = null, m = null;
  try { b1 = await plazo(p.getBlockNumber(), "one node's jump"); } catch (e) { m = mensaje(e); }
  assert(pedidos("eth_blockNumber", N).length === 1, "niorfun was never asked, the test proves nothing");
  assert(m != null, "believed block " + b1 + " from one node alone");
  /* +200000 y no +100000: niorfun acaba de decir +100000, y eso ya sería un segundo nodo de acuerdo */
  conducta = { [A]: sanoCon({ eth_blockNumber: hex(0x10 + 200000) }), [C]: sanoCon({ eth_blockNumber: hex(0x10 + 200005) }) };
  await espera(300);
  const b2 = await plazo(p.getBlockNumber(), "two nodes agreeing");
  assert(pedidos("eth_blockNumber", C).length >= 2, "thecusp was not asked after rpc.arc-scan.org's jump, the test proves nothing");
  assert(b2 === 0x10 + 200005, "two nodes within 20 blocks of each other were not believed: " + b2);
});

prueba("height: every node that answers is more than 600 blocks behind the head -> nothing served from them; 12 behind still is", async (app) => {
  const CABEZA = 0x100000;
  conducta[A] = sanoCon({ eth_blockNumber: hex(CABEZA) });
  const p = app.proveedorRPC();
  await plazo(p.getBlockNumber(), "head from rpc.arc-scan.org");
  await espera(300);
  conducta[A] = ARCSCAN_503;
  conducta[C] = sanoCon({ eth_blockNumber: hex(CABEZA - 700) });
  conducta[N] = sanoCon({ eth_blockNumber: hex(CABEZA - 800) });
  let b = null, m = null;
  try { b = await plazo(p.getBlockNumber(), "every node 700+ behind"); } catch (e) { m = mensaje(e); }
  assert(pedidos("eth_blockNumber", C).length === 1 && pedidos("eth_blockNumber", N).length === 1,
    "thecusp and niorfun were not both asked, the test proves nothing");
  assert(m != null, "served block " + b + ", 700 blocks behind the head");
  conducta[C] = sanoCon({ eth_blockNumber: hex(CABEZA - 12) });
  await espera(300);
  const b2 = await plazo(p.getBlockNumber(), "thecusp 12 behind");
  assert(b2 === CABEZA - 12, "block " + b2);
});

prueba("per element: a node confirms the head but cannot give the eth_call batched with it -> the call comes from the node 15 blocks behind", async (app) => {
  const CABEZA = 0x100000;
  const castigo = mod.TIEMPOS && mod.TIEMPOS.castigoMs;
  if (mod.TIEMPOS) mod.TIEMPOS.castigoMs = 50;   // que rpc.arc-scan.org vuelva a ir primero
  try {
    conducta[A] = ARCSCAN_503;
    conducta[C] = sanoCon({ eth_blockNumber: hex(CABEZA) });
    const p = app.proveedorRPC();
    await plazo(p.getBlockNumber(), "head from thecusp");
    await espera(300);
    conducta[A] = sanoCon({ eth_blockNumber: hex(CABEZA - 15) });
    conducta[C] = porElemento((q) => (q.method === "eth_call" ? mal(q, -32000, "Please contact thirdweb support")
      : { jsonrpc: "2.0", id: q.id, result: q.method === "eth_blockNumber" ? hex(CABEZA) : resultado(q) }));
    conducta[N] = CUELGA;
    const [b, r] = await plazo(Promise.all([p.getBlockNumber(), p.call({ to: QUOTER, data: "0x12345678" })]), "block + call in one batch");
    assert(registro.some((x) => x.url === A && x.metodos.includes("eth_blockNumber") && x.metodos.includes("eth_call")),
      "the block poll and the call did not share a batch at rpc.arc-scan.org, the test proves nothing");
    assert(pedidos("eth_call", C).length === 1, "thecusp was never asked the call, the test proves nothing");
    assert(b === CABEZA, "block " + b);
    assert(r === "0x" + (200000000n).toString(16).padStart(64, "0"), "call " + r);
  } finally { if (mod.TIEMPOS) mod.TIEMPOS.castigoMs = castigo; }
});

prueba("send: the node answers the transaction's own hash in UPPERCASE -> accepted, and broadcastTransaction resolves", async (app) => {
  conducta[A] = segun({ eth_sendRawTransaction: porElemento((q) => ({ jsonrpc: "2.0", id: q.id,
    result: "0x" + ethers.keccak256(q.params[0]).slice(2).toUpperCase() })) }, SANO);
  const tx = await plazo(app.proveedorRPC().broadcastTransaction(RAW), "broadcast");
  assert(pedidos("eth_sendRawTransaction", A).length === 1, "rpc.arc-scan.org never got the send, the test proves nothing");
  assert(tx.hash === RAW_HASH, "hash " + tx.hash);
});

prueba("already sent: a send accepted in the same batch as ANOTHER wallet's failing read -> that read says try again, the batch's block number says sent", async (app) => {
  conducta["*"] = LEE_MAL_ENVIA_BIEN;
  const p = app.proveedorRPC();
  const [envio, saldo] = await Promise.allSettled([plazo(p.broadcastTransaction(RAW), "broadcast"), plazo(p.getBalance(DIR), "balance")]);
  assert(registro.some((x) => x.metodos.includes("eth_blockNumber") && x.metodos.includes("eth_getBalance")),
    "the balance did not share the broadcast's batch, the test proves nothing");
  assert(pedidos("eth_sendRawTransaction").length >= 1, "the send never went out, the test proves nothing");
  assert(saldo.status === "rejected", "the balance was read, the test proves nothing");
  const otra = mensaje(saldo.reason);
  assert(!/already sent/.test(otra) && /try again/i.test(otra), "another wallet's read said: " + otra);
  if (envio.status === "rejected") {
    const m = mensaje(envio.reason);
    assert(/already sent/.test(m) && m.toLowerCase().includes(RAW_HASH.toLowerCase()), "the broadcast said: " + m);
  }
});

prueba("batch: 40 balance reads at once never go out in a batch over 20 -- niorfun rejects bigger ones", async (app) => {
  conducta[A] = ARCSCAN_503;
  conducta[C] = LIMITE_429;
  conducta[N] = (c, init) => (Array.isArray(c) && c.length > 20
    ? responder(200, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch too large (max 20)" } })
    : SANO(c, init));
  const p = app.proveedorRPC();
  const saldos = await plazo(Promise.all(Array.from({ length: 40 }, (_, k) => p.getBalance(dirN(100 + k)))), "40 balances");
  assert(pedidos("eth_getBalance", N).length >= 1, "niorfun was never asked, the test proves nothing");
  assert(saldos.every((b) => b === 0x456391824508d41cn), "wrong balances");
  const mayor = Math.max(...registro.map((r) => r.metodos.length));
  assert(mayor <= 20, "a batch of " + mayor + " went out");
});

prueba("nonce: with an answer already in hand, a hanging node gets a short clock, and one that just failed is skipped", async (app) => {
  const reloj = mod.TIEMPOS && mod.TIEMPOS.segundaOpinionMs;
  if (mod.TIEMPOS) mod.TIEMPOS.segundaOpinionMs = 40;
  try {
    const p = app.proveedorRPC();
    const h = await plazo(p.send("eth_sendRawTransaction", [RAW]), "send nonce 7");
    assert(h === RAW_HASH, "the send was not accepted, the test proves nothing: " + h);
    conducta[C] = CUELGA;
    conducta[N] = CUELGA;
    const t0 = Date.now();
    const n1 = await plazo(p.getTransactionCount(RAW_FROM, "pending"), "pending nonce under the floor");
    const t1 = Date.now() - t0;
    assert(pedidos("eth_getTransactionCount", C).length === 1, "thecusp was never asked, the test proves nothing");
    assert(n1 === 7, "pending nonce " + n1);
    assert(t1 < 200, "waited " + t1 + " ms for two hanging nodes with the answer in hand (read clocks 250/320 ms, short clock 40 ms)");
    await plazo(p.send("eth_sendRawTransaction", [RAW]), "send nonce 7 again: the floor is back");
    await espera(300);
    const antes = registro.length;
    const n2 = await plazo(p.getTransactionCount(RAW_FROM, "pending"), "pending nonce under the floor, again");
    assert(n2 === 7, "pending nonce " + n2);
    assert(!registro.slice(antes).some((r) => r.url === C || r.url === N), "asked a node that had just hung, with the answer in hand");
  } finally { if (mod.TIEMPOS) mod.TIEMPOS.segundaOpinionMs = reloj; }
});

/* ── a correr ────────────────────────────────────────────────────────────── */

let sueltas = 0;
process.on("unhandledRejection", () => { sueltas++; });

console.log((VIEJO ? "OLD code (git show HEAD:app.js)" : "NEW code (app.js + rpc.js on disk)") + " · ethers " + ethers.version);
let bien = 0, fallos = 0;
for (const { nombre, fn } of pruebas) {
  conducta = {}; registro = [];
  const app = nuevaApp();
  try {
    await fn(app);
    bien++;
    console.log("PASS  " + nombre);
  } catch (e) {
    fallos++;
    console.log("FAIL  " + nombre + "\n        " + mensaje(e));
  }
}
console.log("\n" + bien + " passed, " + fallos + " failed" + (sueltas ? " (" + sueltas + " stray rejections from abandoned requests)" : ""));
process.exit(fallos ? 1 : 0);
