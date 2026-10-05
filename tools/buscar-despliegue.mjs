/* Solo lectura (5-oct-2026): busca en los ultimos N minutos de Arc la creacion de un contrato con el bytecode de la pestaña 9
   (TEST u OLIG) y da su direccion, quien lo desplego y el bloque. Lotes de 50 en rpc.arc-scan.org (acepta lotes sin registro).
   node tools/buscar-despliegue.mjs [test|olig] [minutos=40] */
import { OLIG_BYTECODE } from "../olig-codigo.js";
import { OLIGTEST_BYTECODE } from "../olig-test-codigo.js";
const cual = process.argv[2] === "olig" ? "olig" : "test";
const BC = (cual === "olig" ? OLIG_BYTECODE : OLIGTEST_BYTECODE).toLowerCase();
const minutos = Number(process.argv[3] || 40);
const RPCS = ["https://rpc.arc-scan.org", "https://rpc.mainnet.arc.io"];
let id = 0;
async function lote(llamadas) {
  for (let i = 0; i < 6; i++) {
    const url = RPCS[i % RPCS.length];
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(llamadas.map(([m, p]) => ({ jsonrpc: "2.0", id: ++id, method: m, params: p }))) });
      const j = await r.json();
      if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 200));
      j.sort((a, b) => a.id - b.id);
      if (j.some((x) => x.error)) throw new Error(JSON.stringify(j.find((x) => x.error).error).slice(0, 200));
      return j.map((x) => x.result);
    } catch (e) { await new Promise((ok) => setTimeout(ok, 1200 * (i + 1))); if (i === 5) throw e; }
  }
}
const [cabezaHex] = await lote([["eth_blockNumber", []]]);
const cabeza = parseInt(cabezaHex, 16);
const desde = cabeza - Math.ceil((minutos * 60) / 0.5);
console.log("buscando", cual, "en los bloques", desde, "-", cabeza);
const hallados = [];
for (let b = cabeza; b >= desde; b -= 50) {
  const ns = []; for (let k = 0; k < 50 && b - k >= desde; k++) ns.push(b - k);
  const bloques = await lote(ns.map((n) => ["eth_getBlockByNumber", ["0x" + n.toString(16), true]]));
  for (const bl of bloques) for (const tx of (bl && bl.transactions) || []) if (!tx.to && String(tx.input).toLowerCase() === BC) hallados.push(tx);
  if (hallados.length) break;
}
if (!hallados.length) { console.log("no hay ninguna creacion con ese bytecode en", minutos, "minutos"); process.exit(0); }
for (const tx of hallados) {
  const [rc] = await lote([["eth_getTransactionReceipt", [tx.hash]]]);
  console.log("tx", tx.hash, "| de", tx.from, "| bloque", parseInt(tx.blockNumber, 16), "| contrato", rc && rc.contractAddress, "| estado", rc && rc.status);
}
