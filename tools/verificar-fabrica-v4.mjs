/* ===========================================================================
   VERIFICA LA FABRICA V4 DEL PASO 6 Y SU LAUNCHLOCKER

     node tools/verificar-fabrica-v4.mjs 0xFABRICA            ensayo: compara con la cadena
     node tools/verificar-fabrica-v4.mjs 0xFABRICA --enviar   y manda a Sourcify y arc.etherscan.io

   Antes de mandar nada comprueba que lo desplegado ES lo compilado: el codigo de
   ejecucion de la fabrica y el del locker (que crea la fabrica en su constructor),
   byte a byte con los inmutables tapados, y que esos inmutables valen lo que tienen
   que valer (la V4 de Arc, la USDC, los dos hashes del token, y que el locker es de
   ESTA fabrica). Si algo no casa, no se manda nada.

   Se compila con tools/compilar-v4.mjs: solc 0.8.26, viaIR, cancun, optimizador 200
   y los 15 remapeos de openlaunch. explorer.arc.io va aparte, desde el navegador
   (Cloudflare delante), con la entrada estandar que da exact_match en Sourcify.
   La clave de Etherscan NUNCA se imprime.
   =========================================================================== */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { ethers } = require(path.join(raiz, "..", "blop-contracts", "node_modules", "ethers"));
const { entradaEstandar, compilar, VERSION_SOLC } = await import(pathToFileURL(path.join(raiz, "tools", "compilar-v4.mjs")).href);
const COD = await import(pathToFileURL(path.join(raiz, "fabrica-v4-codigo.js")).href);

const CADENA = 5042;
const NODO = process.env.NODO || "https://rpc.mainnet.arc.io";
const SOURCIFY = "https://sourcify.dev/server";
const V4 = { poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951", positionManager: "0x6049c9a0e26405c0985f9e3685c87d0ae917f82b",
  permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3" };
const USDC = "0x3600000000000000000000000000000000000000";
const fabrica = (process.argv[2] || "").trim();
const enviar = process.argv.includes("--enviar");
if (!/^0x[0-9a-fA-F]{40}$/.test(fabrica)) { console.error("uso: node tools/verificar-fabrica-v4.mjs 0xFABRICA [--enviar]"); process.exit(1); }

async function rpc(method, params) {
  const r = await fetch(NODO, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error).slice(0, 200));
  return j.result;
}
const leer = async (dir, abi, fn, args = []) => {
  const i = new ethers.Interface(abi);
  return i.decodeFunctionResult(fn, await rpc("eth_call", [{ to: dir, data: i.encodeFunctionData(fn, args) }, "latest"]))[0];
};

/* el codigo de ejecucion con los huecos de los inmutables a cero */
function tapar(hexCodigo, refs) {
  const b = Buffer.from(String(hexCodigo).replace(/^0x/, ""), "hex");
  for (const lista of Object.values(refs || {})) for (const { start, length } of lista) b.fill(0, start, start + length);
  return b.toString("hex");
}

const entrada = await entradaEstandar();
const { out } = compilar(entrada);
const F = out.contracts["src/BaseyLaunchFactoryV4.sol"].BaseyLaunchFactoryV4;
const L = out.contracts["src/LaunchLocker.sol"].LaunchLocker;
if ("0x" + F.evm.bytecode.object !== COD.CREACION_FABRICA) {
  console.log("fabrica-v4-codigo.js no es lo que compila hoy: node tools/compilar-v4.mjs. No se manda nada."); process.exit(1);
}

let bien = true;
const mira = (que, ok, detalle = "") => { console.log((ok ? "  ok   " : "  MAL  ") + que + (detalle ? "  " + detalle : "")); if (!ok) bien = false; };

const codF = await rpc("eth_getCode", [fabrica, "latest"]);
mira("fabrica: codigo igual al compilado (inmutables tapados)",
  tapar(codF, F.evm.deployedBytecode.immutableReferences) === tapar("0x" + F.evm.deployedBytecode.object, F.evm.deployedBytecode.immutableReferences),
  (codF.length - 2) / 2 + " B");
const locker = String(await leer(fabrica, F.abi, "locker")).toLowerCase();
mira("fabrica.poolManager", String(await leer(fabrica, F.abi, "poolManager")).toLowerCase() === V4.poolManager);
mira("fabrica.positionManager", String(await leer(fabrica, F.abi, "positionManager")).toLowerCase() === V4.positionManager);
mira("fabrica.permit2", String(await leer(fabrica, F.abi, "permit2")).toLowerCase() === V4.permit2);
mira("fabrica.usdc", String(await leer(fabrica, F.abi, "usdc")).toLowerCase() === USDC);
mira("fabrica.tokenCodeHash = el del BaseyToken", await leer(fabrica, F.abi, "tokenCodeHash") === COD.HASH_TOKEN);
mira("fabrica.editableCodeHash = el del BaseyTokenEditable", await leer(fabrica, F.abi, "editableCodeHash") === COD.HASH_EDITABLE);
const codL = await rpc("eth_getCode", [locker, "latest"]);
mira("locker " + locker + ": codigo igual al compilado (inmutables tapados)",
  tapar(codL, L.evm.deployedBytecode.immutableReferences) === tapar("0x" + L.evm.deployedBytecode.object, L.evm.deployedBytecode.immutableReferences),
  (codL.length - 2) / 2 + " B");
mira("locker.factory = esta fabrica", String(await leer(locker, L.abi, "factory")).toLowerCase() === fabrica.toLowerCase());
mira("locker.positionManager", String(await leer(locker, L.abi, "positionManager")).toLowerCase() === V4.positionManager);
if (!bien) { console.log("\nAlgo no casa: no se manda nada."); process.exit(1); }
if (!enviar) { console.log("\n(ensayo: todo casa; repetir con --enviar)"); process.exit(0); }

/* ── Sourcify: la misma entrada estandar para los dos ── */
async function sourcify(dir, id) {
  const r = await fetch(SOURCIFY + "/v2/verify/" + CADENA + "/" + dir, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ stdJsonInput: entrada, compilerVersion: VERSION_SOLC, contractIdentifier: id }) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 409) return "ya estaba verificado";
  if (!j.verificationId) return "http " + r.status + " " + JSON.stringify(j).slice(0, 200);
  for (let i = 0; i < 60; i++) {
    await new Promise((ok) => setTimeout(ok, 3000));
    const e = await fetch(SOURCIFY + "/v2/verify/" + j.verificationId).then((x) => x.json());
    if (!e.isJobCompleted) continue;
    return e.error ? "ERROR " + String(e.error.message || "").slice(0, 200) : "match=" + (e.contract || {}).match;
  }
  return "sin respuesta en 3 min";
}
console.log("\nSourcify fabrica: " + await sourcify(fabrica, "src/BaseyLaunchFactoryV4.sol:BaseyLaunchFactoryV4"));
console.log("Sourcify locker : " + await sourcify(locker, "src/LaunchLocker.sol:LaunchLocker"));

/* ── arc.etherscan.io ── */
const p = path.join(os.homedir(), ".etherscan-key");
const b = fs.existsSync(p) ? fs.readFileSync(p) : null;
const clave = b ? ((b[0] === 0xff && b[1] === 0xfe) ? b.toString("utf16le") : b.toString("utf8")).match(/[A-Za-z0-9]{30,45}/)?.[0] : null;
if (!clave) { console.log("arc.etherscan.io: sin clave, se salta"); process.exit(0); }
const taparClave = (t) => String(t).split(clave).join("<clave>");
const API = "https://api.etherscan.io/v2/api?chainid=" + CADENA;
async function etherscan(dir, nombre, argsCtor) {
  const cuerpo = new URLSearchParams({ module: "contract", action: "verifysourcecode", apikey: clave,
    codeformat: "solidity-standard-json-input", sourceCode: JSON.stringify(entrada), contractaddress: dir,
    contractname: nombre, compilerversion: "v" + VERSION_SOLC, constructorArguements: argsCtor.replace(/^0x/, "") });
  const env = await fetch(API, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: cuerpo }).then((x) => x.json());
  if (String(env.status) !== "1") return taparClave(JSON.stringify(env)).slice(0, 200);
  for (let i = 0; i < 40; i++) {
    await new Promise((ok) => setTimeout(ok, 4000));
    const e = await fetch(API + "&module=contract&action=checkverifystatus&guid=" + env.result + "&apikey=" + clave).then((x) => x.json());
    const t = taparClave(String(e.result || ""));
    if (/pending/i.test(t)) continue;
    return t;
  }
  return "sin respuesta en 160 s";
}
/* los argumentos de la fabrica, codificados como los codifica la pagina (fabrica-v4.js) */
const argsF = ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address", "address", "bytes32", "bytes32"],
  [V4.poolManager, V4.positionManager, V4.permit2, USDC, COD.HASH_TOKEN, COD.HASH_EDITABLE]);
/* el locker lo crea la fabrica con new LaunchLocker(positionManager): su unico argumento */
const argsL = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [V4.positionManager]);
console.log("arc.etherscan.io fabrica: " + await etherscan(fabrica, "src/BaseyLaunchFactoryV4.sol:BaseyLaunchFactoryV4", argsF));
console.log("arc.etherscan.io locker : " + await etherscan(locker, "src/LaunchLocker.sol:LaunchLocker", argsL));
