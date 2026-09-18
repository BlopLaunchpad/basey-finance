/* Solo lectura: reproduce EL MISMO camino que sigue la rapida en el paso 6 hasta justo
   antes de firmar — el proveedor rotativo de la pagina (rpc.js), el contrato fijo y
   ContractFactory.getDeployTransaction + populateTransaction — con un VoidSigner, que
   tiene direccion pero NO clave: no puede firmar ni mandar nada.
     node tools/reproducir-despliegue.mjs [direccion-con-saldo]
   Cronometra cada paso para ver cual se queda colgado. */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { ethers } = require(path.join(raiz, "..", "blop-contracts", "node_modules", "ethers"));
const imp = (f) => import(pathToFileURL(path.join(raiz, f)).href);
const { crearProveedorRotativo, NODOS_ARC } = await imp("rpc.js");
const { BASEY_TOKEN_SOURCE, argsDelToken } = await imp("basey-token.js");

const DESDE = process.argv[2] || "0xb39924FFb4fCEb6f080e0f2d7260A08c8e467276";   // tiene USDC para el gas
const SOLC = path.join(process.env.APPDATA || "", "svm", "0.8.24", "solc-0.8.24");
const entrada = { language: "Solidity", sources: { "Token.sol": { content: BASEY_TOKEN_SOURCE } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
const K = JSON.parse(execFileSync(fs.existsSync(SOLC + ".exe") ? SOLC + ".exe" : SOLC, ["--standard-json"], { input: JSON.stringify(entrada), maxBuffer: 64e6 }).toString()).contracts["Token.sol"].BaseyToken;

const prov = crearProveedorRotativo(ethers, NODOS_ARC, { chainId: 5042 });
prov.pollingInterval = 500;
const firmante = new ethers.VoidSigner(DESDE, prov);
const PLAN = { nombre: "TEST", símbolo: "TEST", supply: 1_000_000_000, imagen: "https://ipfs.io/ipfs/QmSWKk2f5tdpN5rZyRHYosW8XSMVx2cZybnB1W3no1wv2J",
  descripción: "test", web: "", twitter: "", telegram: "" };

const conPlazo = (p, ms, nombre) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(nombre + ": SIN RESPUESTA en " + ms / 1000 + " s")), ms))]);
async function paso(nombre, fn, ms = 45000) {
  const t0 = Date.now();
  try { const r = await conPlazo(fn(), ms, nombre); console.log("ok   " + nombre.padEnd(34) + (Date.now() - t0) + " ms  " + String(r).slice(0, 90)); return r; }
  catch (e) { console.log("MAL  " + nombre.padEnd(34) + (Date.now() - t0) + " ms  " + String(e.shortMessage || e.message).slice(0, 200)); return null; }
}

console.log("nodos:", NODOS_ARC.join(", "), "| desde", DESDE, "\n");
await paso("getNetwork", async () => (await prov.getNetwork()).chainId);
await paso("getBlockNumber", () => prov.getBlockNumber());
await paso("getTransactionCount (nonce)", () => prov.getTransactionCount(DESDE, "pending"));
await paso("getFeeData", async () => { const f = await prov.getFeeData(); return "gasPrice " + f.gasPrice + " maxFee " + f.maxFeePerGas; });
const fab = new ethers.ContractFactory(K.abi, "0x" + K.evm.bytecode.object, firmante);
const tx = await paso("getDeployTransaction", async () => { const t = await fab.getDeployTransaction(...argsDelToken(PLAN)); globalThis.__tx = t; return (t.data.length - 2) / 2 + " bytes"; });
if (globalThis.__tx) {
  await paso("estimateGas del despliegue", () => prov.estimateGas({ ...globalThis.__tx, from: DESDE }));
  await paso("populateTransaction (lo que hace deploy)", async () => { const p = await firmante.populateTransaction(globalThis.__tx); return "gasLimit " + p.gasLimit + " nonce " + p.nonce + " type " + p.type; });
}
process.exit(0);
