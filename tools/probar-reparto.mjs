/* ===========================================================================
   PRUEBA DEL REPARTO DE ENVIOS Y DEL NODO OFICIAL (rpc.js, 18-sep-2026)

     node tools/probar-reparto.mjs

   El 18-sep se perdieron dos envios de la rapida igual: un nodo devolvio el hash y
   no paso la transaccion a nadie. Desde entonces rpc.js pone primero el nodo
   oficial (rpc.mainnet.arc.io) y, cuando un nodo ACEPTA un envio, manda los mismos
   bytes firmados a los demas (`repartir`). Lo que tiene que ser verdad, con el
   rpc.js del disco y una red falsa (no toca la red ni firma nada):
     1. el oficial va primero, para leer y para enviar;
     2. un envio aceptado sale tambien, con los MISMOS bytes, hacia cada otro nodo
        que ha dicho la cadena 5042, y lo que devuelve el envio no cambia;
     3. lo que contesten esos repartos (429, "nonce too low", red caida) no cambia
        el resultado ni castiga a nadie;
     4. si el primero rechaza limpio (429) y acepta el segundo, el reparto llega
        tambien al primero;
     5. un envio DUDOSO (el nodo corta la conexion) NO se reparte: no se sabe si
        salio, y eso se sigue diciendo asi;
     6. un nodo que contesta OTRA cadena no recibe nunca los bytes firmados;
     7. sin bytes firmados (eth_sendTransaction) no hay nada que repartir.
   =========================================================================== */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { ethers } = require(path.join(raiz, "..", "blop-contracts", "node_modules", "ethers"));
const { crearProveedorRotativo, NODOS_ARC } = await import(pathToFileURL(path.join(raiz, "rpc.js")).href);

const OFICIAL = "https://rpc.mainnet.arc.io";
const DRPC = "https://arc.drpc.org";
const BLOB = "0x02" + "ab".repeat(120);          // no es una transaccion: solo bytes con hash
const HASH = ethers.keccak256(BLOB);

/* ── la red falsa ── */
let registro = [];
let conducta = {};
const SANO = (p) => {
  switch (p.method) {
    case "eth_chainId": return { result: "0x13b2" };
    case "eth_blockNumber": return { result: "0x1000" };
    case "eth_getBlockByNumber": return { result: { number: "0x1000", timestamp: "0x1" } };
    case "eth_getBalance": return { result: "0x1" };
    case "eth_getTransactionCount": return { result: "0x5" };
    case "eth_sendRawTransaction": return { result: ethers.keccak256(p.params[0]) };
    case "eth_sendTransaction": return { result: HASH };
    default: return { result: "0x" };
  }
};
const conEnvio = (envio) => (p) => (p.method === "eth_sendRawTransaction" || p.method === "eth_sendTransaction" ? envio(p) : SANO(p));
const L429 = () => ({ http: 429, error: { code: -32005, message: "rate limit exceeded" } });
const NONCE_BAJO = () => ({ error: { code: -32000, message: "nonce too low" } });
const CORTA = () => ({ red: true });
const OTRA_CADENA = (p) => (p.method === "eth_chainId" ? { result: "0x1" } : SANO(p));

async function fetchFalso(url, init) {
  const cuerpo = JSON.parse(init.body);
  registro.push({ url, cuerpo, t: Date.now() });
  const lista = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
  const f = conducta[url] || SANO;
  const salidas = lista.map((p) => ({ p, r: f(p) }));
  if (salidas.some((x) => x.r.red)) throw new TypeError("Failed to fetch");
  const http = Math.max(200, ...salidas.map((x) => x.r.http || 200));
  const resp = salidas.map(({ p, r }) => (r.error ? { jsonrpc: "2.0", id: p.id, error: r.error } : { jsonrpc: "2.0", id: p.id, result: r.result }));
  const texto = JSON.stringify(Array.isArray(cuerpo) ? resp : resp[0]);
  return { status: http, text: async () => texto };
}
const envios = () => registro.flatMap((x) => (Array.isArray(x.cuerpo) ? x.cuerpo : [x.cuerpo])
  .filter((p) => p.method === "eth_sendRawTransaction").map((p) => ({ url: x.url, bytes: p.params[0] })));
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const nuevo = () => { registro = []; return crearProveedorRotativo(ethers, NODOS_ARC, { fetch: fetchFalso }); };

let bien = 0, mal = 0;
async function caso(nombre, fn) {
  conducta = {};
  try { await fn(); bien++; console.log("ok   " + nombre); }
  catch (e) { mal++; console.log("MAL  " + nombre + "\n       " + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

await caso("1. el oficial va primero en la lista, para leer y para enviar", async () => {
  assert(NODOS_ARC[0] === OFICIAL, "NODOS_ARC[0] es " + NODOS_ARC[0]);
  const p = nuevo();
  await p.getBlockNumber();
  assert(registro[0].url === OFICIAL, "la primera lectura fue a " + registro[0].url);
  const h = await p.send("eth_sendRawTransaction", [BLOB]);
  assert(h === HASH, "hash " + h);
  assert(envios()[0].url === OFICIAL, "el envio fue primero a " + envios()[0].url);
});

await caso("2. un envio aceptado sale con los MISMOS bytes hacia cada otro nodo, y el resultado no cambia", async () => {
  const p = nuevo();
  await p.getBlockNumber();
  const h = await p.send("eth_sendRawTransaction", [BLOB]);
  assert(h === HASH, "hash " + h);
  await dormir(300);
  const e = envios();
  const otros = NODOS_ARC.filter((u) => u !== OFICIAL);
  for (const u of otros) assert(e.some((x) => x.url === u), "no se repartio a " + u + ": " + JSON.stringify(e.map((x) => x.url)));
  assert(e.every((x) => x.bytes === BLOB), "se repartieron otros bytes");
  assert(e.filter((x) => x.url === OFICIAL).length === 1, "al que acepto se le volvio a mandar");
});

await caso("3. lo que contesten los repartos (429, nonce too low, red caida) no cambia nada ni castiga", async () => {
  conducta[DRPC] = conEnvio(L429);
  conducta["https://rpc.arc-scan.org"] = conEnvio(NONCE_BAJO);
  conducta["https://niorfun.com/api/rpc"] = conEnvio(CORTA);
  const p = nuevo();
  await p.getBlockNumber();
  const h = await p.send("eth_sendRawTransaction", [BLOB]);
  assert(h === HASH, "hash " + h);
  await dormir(300);
  /* sin castigo: si ahora el oficial rechaza limpio, el siguiente envio va a drpc */
  conducta = { [OFICIAL]: conEnvio(L429) };
  registro = [];
  const h2 = await p.send("eth_sendRawTransaction", [BLOB.replace(/ab$/, "cd")]);
  const orden = envios().map((x) => x.url);
  assert(orden[0] === OFICIAL && orden[1] === DRPC, "tras los repartos fallidos el orden de envio fue " + JSON.stringify(orden.slice(0, 3)));
  assert(h2 === ethers.keccak256(BLOB.replace(/ab$/, "cd")), "segundo hash " + h2);
});

await caso("4. si el primero rechaza limpio (429) y acepta el segundo, el reparto llega tambien al primero", async () => {
  conducta[OFICIAL] = conEnvio(L429);
  const p = nuevo();
  await p.getBlockNumber();
  const h = await p.send("eth_sendRawTransaction", [BLOB]);
  assert(h === HASH, "hash " + h);
  await dormir(300);
  const e = envios().map((x) => x.url);
  assert(e[0] === OFICIAL && e[1] === DRPC, "orden " + JSON.stringify(e));
  assert(e.filter((u) => u === OFICIAL).length === 2, "el reparto no volvio al oficial: " + JSON.stringify(e));
  assert(e.filter((u) => u === DRPC).length === 1, "a drpc, que acepto, se le repitio");
});

await caso("5. un envio DUDOSO (el nodo corta la conexion) NO se reparte y dice que no se sabe", async () => {
  conducta[OFICIAL] = conEnvio(CORTA);
  const p = nuevo();
  await p.getBlockNumber();
  let err = null;
  try { await p.send("eth_sendRawTransaction", [BLOB]); } catch (e) { err = e; }
  assert(err && /may or may not have been broadcast/.test(String(err.message || err)), "mensaje: " + (err && err.message));
  await dormir(300);
  assert(envios().length === 1, "un envio dudoso salio " + envios().length + " veces: " + JSON.stringify(envios().map((x) => x.url)));
});

await caso("6. un nodo que contesta OTRA cadena no recibe nunca los bytes firmados", async () => {
  conducta["https://rpc.arc-scan.org"] = OTRA_CADENA;
  const p = nuevo();
  await p.getBlockNumber();
  await p.send("eth_sendRawTransaction", [BLOB]);
  await dormir(300);
  assert(!envios().some((x) => x.url === "https://rpc.arc-scan.org"), "arc-scan, con otra cadena, recibio los bytes");
  assert(envios().some((x) => x.url === DRPC), "y a los buenos si les llega (drpc no lo recibio)");
});

await caso("7. sin bytes firmados (eth_sendTransaction) no se reparte nada", async () => {
  const p = nuevo();
  await p.getBlockNumber();
  await p.send("eth_sendTransaction", [{ from: "0x" + "11".repeat(20), to: "0x" + "22".repeat(20) }]).catch(() => null);
  await dormir(300);
  const n = registro.flatMap((x) => (Array.isArray(x.cuerpo) ? x.cuerpo : [x.cuerpo])).filter((q) => q.method === "eth_sendTransaction").length;
  assert(n <= 1, "eth_sendTransaction salio " + n + " veces");
});

console.log("\n" + bien + " bien, " + mal + " mal");
process.exit(mal ? 1 : 0);
