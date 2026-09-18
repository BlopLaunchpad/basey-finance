/* ===========================================================================
   VERIFICA LA LANZADERA DE UN SOLO USO DEL PASO 6 (AtomicLaunch, compra-atomica.js)

     node tools/verificar-lanzadera.mjs 0xLANZADERA            ensayo
     node tools/verificar-lanzadera.mjs 0xLANZADERA --enviar   Sourcify y arc.etherscan.io

   La lanzadera hace todo en su constructor (crea la pool, pone el muro y compra) y
   en la cadena solo deja unos 63 bytes. Verificarla publica ese constructor, que es
   donde esta la logica: cualquiera puede leer que hizo con el dinero. Su codigo de
   ejecucion es el mismo en todos los lanzamientos, asi que Blockscout emparejara
   las siguientes solo, igual que los tokens.

   Se compila EXACTAMENTE como la pagina (app.js, compileAll): fichero "Token.sol",
   solc 0.8.24+commit.e11b9ed9, optimizador 200, evm paris. Si el bytecode no casa
   con el de la cadena, no se manda nada.
   explorer.arc.io va aparte, desde el navegador (Cloudflare delante).
   =========================================================================== */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { ethers } = require(path.join(raiz, "..", "blop-contracts", "node_modules", "ethers"));
const { COMPRA_ATOMICA_SOURCE } = await import(pathToFileURL(path.join(raiz, "compra-atomica.js")).href);

const CADENA = 5042;
const NODO = process.env.NODO || "https://rpc.mainnet.arc.io";
const SOURCIFY = "https://sourcify.dev/server";
const VERSION_SOLC = "0.8.24+commit.e11b9ed9";
const SOLC = [".exe", ""].map((e) => path.join(process.env.APPDATA || "", "svm", "0.8.24", "solc-0.8.24" + e)).find((f) => fs.existsSync(f));
const direccion = (process.argv[2] || "").trim();
const enviar = process.argv.includes("--enviar");
if (!/^0x[0-9a-fA-F]{40}$/.test(direccion)) { console.error("uso: node tools/verificar-lanzadera.mjs 0xLANZADERA [--enviar]"); process.exit(1); }

async function rpc(method, params) {
  const r = await fetch(NODO, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error).slice(0, 200));
  return j.result;
}

const entrada = {
  language: "Solidity", sources: { "Token.sol": { content: COMPRA_ATOMICA_SOURCE } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } } },
};
const K = JSON.parse(execFileSync(SOLC, ["--standard-json"], { input: JSON.stringify(entrada), maxBuffer: 64e6 }).toString()).contracts["Token.sol"].AtomicLaunch;
const code = await rpc("eth_getCode", [direccion, "latest"]);
const igual = ("0x" + K.evm.deployedBytecode.object).toLowerCase() === String(code).toLowerCase();
console.log("lanzadera: " + direccion + " | en la cadena " + (code.length - 2) / 2 + " B | compilado " + K.evm.deployedBytecode.object.length / 2 + " B | " + (igual ? "IGUAL" : "DISTINTO"));
if (!igual) { console.log("No casa: no se manda nada."); process.exit(1); }
if (!enviar) { console.log("(ensayo: repetir con --enviar)"); process.exit(0); }

/* Sourcify saca solo los argumentos del constructor de la transaccion de creacion */
const r = await fetch(SOURCIFY + "/v2/verify/" + CADENA + "/" + direccion, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ stdJsonInput: entrada, compilerVersion: VERSION_SOLC, contractIdentifier: "Token.sol:AtomicLaunch" }) });
const j = await r.json().catch(() => ({}));
if (r.status === 409) console.log("Sourcify: ya estaba verificada");
else if (j.verificationId) {
  for (let i = 0; i < 40; i++) {
    await new Promise((ok) => setTimeout(ok, 3000));
    const e = await fetch(SOURCIFY + "/v2/verify/" + j.verificationId).then((x) => x.json());
    if (!e.isJobCompleted) continue;
    console.log(e.error ? "Sourcify: ERROR " + String(e.error.message || "").slice(0, 200) : "Sourcify: match=" + (e.contract || {}).match);
    break;
  }
} else console.log("Sourcify: http " + r.status + " " + JSON.stringify(j).slice(0, 200));

/* arc.etherscan.io: los argumentos salen del input de la creacion, detras del bytecode */
const p = path.join(os.homedir(), ".etherscan-key");
const b = fs.existsSync(p) ? fs.readFileSync(p) : null;
const clave = b ? ((b[0] === 0xff && b[1] === 0xfe) ? b.toString("utf16le") : b.toString("utf8")).match(/[A-Za-z0-9]{30,45}/)?.[0] : null;
if (!clave) { console.log("arc.etherscan.io: sin clave, se salta"); process.exit(0); }
const tapar = (t) => String(t).split(clave).join("<clave>");
const API = "https://api.etherscan.io/v2/api?chainid=" + CADENA;
const cr = await fetch(API + "&module=contract&action=getcontractcreation&contractaddresses=" + direccion + "&apikey=" + clave).then((x) => x.json());
const txHash = Array.isArray(cr.result) && cr.result[0] ? cr.result[0].txHash : null;
if (!txHash) { console.log("arc.etherscan.io: no encuentra la creacion: " + tapar(JSON.stringify(cr)).slice(0, 160)); process.exit(0); }
const tx = await rpc("eth_getTransactionByHash", [txHash]);
const pref = "0x" + K.evm.bytecode.object.toLowerCase();
const input = String(tx.input || "").toLowerCase();
if (!input.startsWith(pref)) { console.log("arc.etherscan.io: la creacion no empieza por este bytecode, se salta"); process.exit(0); }
const cuerpo = new URLSearchParams({ module: "contract", action: "verifysourcecode", apikey: clave,
  codeformat: "solidity-standard-json-input", sourceCode: JSON.stringify(entrada), contractaddress: direccion,
  contractname: "Token.sol:AtomicLaunch", compilerversion: "v" + VERSION_SOLC, constructorArguements: input.slice(pref.length) });
const env = await fetch(API, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: cuerpo }).then((x) => x.json());
if (String(env.status) !== "1") { console.log("arc.etherscan.io: " + tapar(JSON.stringify(env)).slice(0, 200)); process.exit(0); }
for (let i = 0; i < 30; i++) {
  await new Promise((ok) => setTimeout(ok, 4000));
  const e = await fetch(API + "&module=contract&action=checkverifystatus&guid=" + env.result + "&apikey=" + clave).then((x) => x.json());
  const t = tapar(String(e.result || ""));
  if (/pending/i.test(t)) continue;
  console.log("arc.etherscan.io: " + t);
  break;
}
