/* Solo lectura: el estado de una cartera en CADA nodo — nonce minado, nonce pendiente y
   saldo — y sus transacciones en los ultimos N bloques. Para diagnosticar un envio que
   "se quedo clavado" sin firmar ni mandar nada.
     node tools/mirar-cartera.mjs 0xCARTERA [bloques=3000] */
const DIR = (process.argv[2] || "").toLowerCase();
const N = Number(process.argv[3] || 3000);
if (!/^0x[0-9a-f]{40}$/.test(DIR)) { console.error("uso: node tools/mirar-cartera.mjs 0xCARTERA [bloques]"); process.exit(1); }
const NODOS = ["https://arc.drpc.org", "https://rpc.arc-scan.org", "https://thecusp.io/api/arc-rpc", "https://niorfun.com/api/rpc", "https://rpc.mainnet.arc.io"];

async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 120));
  return j.result;
}
async function lote(url, llamadas) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(llamadas.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, ...c }))), signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  return (Array.isArray(j) ? j : [j]).sort((a, b) => a.id - b.id);
}

console.log("cartera", DIR, "\n");
console.log("nodo".padEnd(34), "cabeza".padEnd(10), "minado".padEnd(8), "pendiente".padEnd(10), "saldo USDC");
for (const url of NODOS) {
  try {
    const [cab, lat, pen, bal] = await Promise.all([
      rpc(url, "eth_blockNumber", []), rpc(url, "eth_getTransactionCount", [DIR, "latest"]),
      rpc(url, "eth_getTransactionCount", [DIR, "pending"]), rpc(url, "eth_getBalance", [DIR, "latest"]),
    ]);
    const l = Number(lat), p = Number(pen);
    console.log(url.replace("https://", "").padEnd(34), String(Number(cab)).padEnd(10), String(l).padEnd(8), (String(p) + (p > l ? "  <- " + (p - l) + " en espera" : "")).padEnd(10), (Number(BigInt(bal) / 10n ** 12n) / 1e6).toFixed(4));
  } catch (e) { console.log(url.replace("https://", "").padEnd(34), "no contesta: " + e.message.slice(0, 80)); }
}

/* sus transacciones minadas en los ultimos N bloques, por rpc.mainnet.arc.io */
const NODO = "https://rpc.mainnet.arc.io";
const cabeza = Number(await rpc(NODO, "eth_blockNumber", []));
console.log("\nsus transacciones minadas en los ultimos " + N + " bloques (~" + Math.round(N / 120) + " min):");
let vistas = 0;
for (let a = cabeza - N + 1; a <= cabeza; a += 20) {
  const pide = [];
  for (let b = a; b < Math.min(a + 20, cabeza + 1); b++) pide.push({ method: "eth_getBlockByNumber", params: ["0x" + b.toString(16), true] });
  for (const r of await lote(NODO, pide)) {
    const blq = r.result;
    if (!blq) continue;
    for (const tx of blq.transactions || []) {
      if (String(tx.from).toLowerCase() !== DIR) continue;
      vistas++;
      const hora = new Date(Number(blq.timestamp) * 1000).toISOString().slice(11, 19);
      console.log("  " + hora + " UTC  nonce " + Number(tx.nonce) + "  " + (tx.to ? "a " + tx.to : "DESPLIEGUE") + "  " + ((tx.input || "0x").length - 2) / 2 + " B  " + tx.hash);
    }
  }
}
if (!vistas) console.log("  ninguna");
