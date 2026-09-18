/* Solo lectura: busca en los ultimos N bloques los despliegues del contrato fijo del
   paso 6 (BaseyToken / BaseyTokenEditable), por el comienzo de su bytecode de creacion.
     node tools/buscar-despliegues.mjs [bloques=1200]
   Sirve para saber si un lanzamiento que "se quedo clavado" llego a salir o no. */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { ethers } = require(path.join(raiz, "..", "blop-contracts", "node_modules", "ethers"));
const { BASEY_TOKEN_SOURCE } = await import(pathToFileURL(path.join(raiz, "basey-token.js")).href);
const NODO = process.env.NODO || "https://rpc.mainnet.arc.io";
const SOLC = path.join(process.env.APPDATA || "", "svm", "0.8.24", "solc-0.8.24");
const N = Number(process.argv[2] || 1200);

const entrada = { language: "Solidity", sources: { "Token.sol": { content: BASEY_TOKEN_SOURCE } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["evm.bytecode.object"] } } } };
const K = JSON.parse(execFileSync(fs.existsSync(SOLC + ".exe") ? SOLC + ".exe" : SOLC, ["--standard-json"], { input: JSON.stringify(entrada), maxBuffer: 64e6 }).toString()).contracts["Token.sol"];
const prefijos = { BaseyToken: "0x" + K.BaseyToken.evm.bytecode.object, BaseyTokenEditable: "0x" + K.BaseyTokenEditable.evm.bytecode.object };

async function lote(llamadas) {
  const r = await fetch(NODO, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(llamadas.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, ...c }))), signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  return (Array.isArray(j) ? j : [j]).sort((a, b) => a.id - b.id);
}
const [cab] = await lote([{ method: "eth_blockNumber", params: [] }]);
const cabeza = Number(cab.result);
console.log("cabeza", cabeza, "| mirando los ultimos", N, "bloques (~" + Math.round(N / 2 / 60) + " min)");
const hallados = [];
for (let a = cabeza - N + 1; a <= cabeza; a += 20) {
  const pide = [];
  for (let b = a; b < Math.min(a + 20, cabeza + 1); b++) pide.push({ method: "eth_getBlockByNumber", params: ["0x" + b.toString(16), true] });
  for (const r of await lote(pide)) {
    const blq = r.result;
    if (!blq) continue;
    for (const tx of blq.transactions || []) {
      if (tx.to) continue;
      const inp = String(tx.input || "").toLowerCase();
      for (const [n, p] of Object.entries(prefijos)) {
        if (inp.startsWith(p.toLowerCase())) hallados.push({ n, hash: tx.hash, from: tx.from, bloque: Number(blq.number), hora: new Date(Number(blq.timestamp) * 1000).toISOString().slice(11, 19) });
      }
    }
  }
}
if (!hallados.length) console.log("NINGUN despliegue del contrato fijo en ese tramo: la transaccion no llego a la cadena.");
for (const h of hallados) {
  const [rec] = await lote([{ method: "eth_getTransactionReceipt", params: [h.hash] }]);
  const r = rec.result || {};
  console.log(h.hora + " UTC  bloque " + h.bloque + "  " + h.n + "  desde " + h.from + "\n   tx " + h.hash + "\n   estado " + (r.status === "0x1" ? "OK" : r.status === "0x0" ? "REVERTIDA" : "sin recibo") + "  token " + (r.contractAddress || "-"));
}
