/* ===========================================================================
   VERIFICA EN SOURCIFY UN TOKEN LANZADO DESDE AQUI  (18-sep-2026)

     node tools/verificar-token.mjs 0xTOKEN            ensayo: compila y compara
     node tools/verificar-token.mjs 0xTOKEN --enviar    y lo manda a Sourcify

   POR QUE EXISTE: el dueño quiere que el distintivo "Verificado" de los
   rastreadores salga en verde. Eso no lo da el contrato: lo da tener la FUENTE
   publicada. Y publicarla a mano es reconstruir a ojo la configuracion exacta
   con la que se compilo, que es donde se falla.

   COMO LO HACE, sin que haya que teclear nada mas que la direccion: lee del
   propio token su identidad (name, symbol, decimals, totalSupply y el JSON de
   `metadataURI()`), PRUEBA las cuatro combinaciones posibles de identidad
   editable y renuncia, compila cada una con el MISMO solc y los MISMOS ajustes
   que el navegador (0.8.24+commit.e11b9ed9, optimizador 200 pasadas, evm paris,
   un solo fichero Token.sol) y se queda con la que da un bytecode IGUAL al que
   hay en la cadena. Si ninguna cuadra, NO manda nada y lo dice: mandar una
   fuente que no cuadra deja el contrato marcado como "no verificado" igual, y
   encima con ruido.

   No firma ni manda transacciones. Lo unico que sale de aqui es la fuente, que
   es publica por definicion en cuanto se verifica.
   =========================================================================== */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
function cargarEthers() {
  const sitios = [process.env.ETHERS_PATH, "ethers",
    path.join(raiz, "..", "blop-contracts", "node_modules", "ethers"),
    path.join(raiz, "..", "cusp-web", "node_modules", "ethers"),
    path.join(raiz, "..", "blop-indexer", "node_modules", "ethers")].filter(Boolean);
  for (const s of sitios) { try { return require(s); } catch { /* el siguiente */ } }
  throw new Error("ethers not found — set ETHERS_PATH");
}
const { ethers } = cargarEthers();
const { generateSource } = await import(pathToFileURL(path.join(raiz, "solidity.js")).href);
const { BASEY_TOKEN_SOURCE } = await import(pathToFileURL(path.join(raiz, "basey-token.js")).href);

const CADENA = 5042;
const NODO = process.env.NODO || "https://rpc.mainnet.arc.io";
const SOURCIFY = process.env.SOURCIFY || "https://sourcify.dev/server";
/* El compilador es el MISMO que carga la pagina (app.js, const SOLC). Si ahi se
   cambia de version, aqui tambien: una version distinta da otro bytecode. */
const VERSION_SOLC = "0.8.24+commit.e11b9ed9";
const SOLC = process.env.SOLC || [".exe", ""].map((ext) => path.join(process.env.APPDATA || "", "svm", "0.8.24", "solc-0.8.24" + ext))
  .find((f) => fs.existsSync(f));
if (!SOLC) throw new Error("solc 0.8.24 not found — set SOLC");

const direccion = (process.argv[2] || "").trim();
const enviar = process.argv.includes("--enviar");
if (!/^0x[0-9a-fA-F]{40}$/.test(direccion)) {
  console.error("uso: node tools/verificar-token.mjs 0xTOKEN [--enviar]");
  process.exit(1);
}

async function rpc(method, params) {
  const r = await fetch(NODO, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error).slice(0, 200));
  return j.result;
}
async function leer(sig, tipo) {
  /* un getter que no existe REVIERTE, no devuelve vacio: es una respuesta, no un
     fallo, y aqui se traduce a null (paso por esto al probarlo con dos tokens
     ajenos). */
  let r;
  try { r = await rpc("eth_call", [{ to: direccion, data: ethers.id(sig).slice(0, 10) }, "latest"]); }
  catch (e) { if (/execution reverted|invalid opcode|out of gas/i.test(e.message)) return null; throw e; }
  if (!r || r === "0x") return null;
  try { return ethers.AbiCoder.defaultAbiCoder().decode([tipo], r)[0]; } catch { return null; }
}
function compilar(fuente) {
  const entrada = {
    language: "Solidity",
    sources: { "Token.sol": { content: fuente } },
    settings: {
      optimizer: { enabled: true, runs: 200 }, evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } },
    },
  };
  const tmp = path.join(os.tmpdir(), "verificar-token-" + process.pid + ".json");
  fs.writeFileSync(tmp, JSON.stringify(entrada));
  const out = JSON.parse(execFileSync(SOLC, ["--standard-json", tmp], { maxBuffer: 64e6 }).toString());
  fs.unlinkSync(tmp);
  const errores = (out.errors || []).filter((e) => e.severity === "error");
  if (errores.length) throw new Error(errores.map((e) => e.formattedMessage).join("\n"));
  const file = out.contracts["Token.sol"];
  const nombre = Object.keys(file)[0];
  return { entrada, nombre, desplegado: "0x" + file[nombre].evm.deployedBytecode.object };
}

/* ── los dos envios, reutilizables ── */
async function aSourcify(stdJsonInput, identificador) {
  const r = await fetch(SOURCIFY + "/v2/verify/" + CADENA + "/" + direccion, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ stdJsonInput, compilerVersion: VERSION_SOLC, contractIdentifier: identificador }),
  });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { j = { crudo: txt.slice(0, 200) }; }
  if (r.status === 409) { console.log("Sourcify: ya estaba verificado"); return true; }
  if (!j.verificationId) { console.log("Sourcify: http " + r.status + " " + JSON.stringify(j).slice(0, 200)); return false; }
  for (let i = 0; i < 40; i++) {
    await new Promise((ok) => setTimeout(ok, 3000));
    const e = await fetch(SOURCIFY + "/v2/verify/" + j.verificationId).then((x) => x.json());
    if (!e.isJobCompleted) continue;
    if (e.error) { console.log("Sourcify: ERROR " + (e.error.customCode || "") + " " + String(e.error.message || "").slice(0, 200)); return false; }
    console.log("Sourcify: match=" + (e.contract || {}).match + " | https://repo.sourcify.dev/" + CADENA + "/" + ethers.getAddress(direccion));
    return true;
  }
  console.log("Sourcify: sigue en cola (" + j.verificationId + ")");
  return false;
}

/* La clave de Etherscan del dueño: UTF-16 porque se escribio con PowerShell, y la
   clave son los 34 alfanumericos. NUNCA se imprime; en los mensajes se tapa. */
function claveEtherscan() {
  const p = process.env.ETHERSCAN_KEY_FILE || path.join(os.homedir(), ".etherscan-key");
  if (!fs.existsSync(p)) return null;
  const b = fs.readFileSync(p);
  const txt = (b[0] === 0xff && b[1] === 0xfe) ? b.toString("utf16le") : b.toString("utf8");
  const m = txt.match(/[A-Za-z0-9]{30,45}/);
  return m ? m[0] : null;
}
async function aEtherscan(stdJsonInput, identificador, bytecodeCreacion) {
  const clave = claveEtherscan();
  if (!clave) { console.log("arc.etherscan.io: no hay clave en ~/.etherscan-key, se salta"); return false; }
  const tapar = (t) => String(t).split(clave).join("<clave>");
  const API = "https://api.etherscan.io/v2/api?chainid=" + CADENA;
  /* los argumentos del constructor salen de la transaccion de creacion: lo que
     sobra de su input despues del bytecode de creacion. Leerlos de los getters
     fallaria en cuanto un token editable hubiera cambiado su imagen. */
  const cr = await fetch(API + "&module=contract&action=getcontractcreation&contractaddresses=" + direccion + "&apikey=" + clave).then((x) => x.json());
  const txCreacion = Array.isArray(cr.result) && cr.result[0] ? cr.result[0].txHash : null;
  if (!txCreacion) { console.log("arc.etherscan.io: no encuentra la creacion: " + tapar(JSON.stringify(cr)).slice(0, 160)); return false; }
  const tx = await rpc("eth_getTransactionByHash", [txCreacion]);
  const input = String(tx && tx.input || "").toLowerCase();
  const pref = "0x" + bytecodeCreacion.toLowerCase();
  if (!input.startsWith(pref)) { console.log("arc.etherscan.io: la creacion no empieza por nuestro bytecode (la hizo otro contrato?), se salta"); return false; }
  const args = input.slice(pref.length);
  const cuerpo = new URLSearchParams({
    module: "contract", action: "verifysourcecode", apikey: clave,
    codeformat: "solidity-standard-json-input", sourceCode: JSON.stringify(stdJsonInput),
    contractaddress: direccion, contractname: identificador,
    compilerversion: "v" + VERSION_SOLC, constructorArguements: args,
  });
  const env = await fetch(API, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: cuerpo }).then((x) => x.json());
  if (String(env.status) !== "1") {
    const m = tapar(JSON.stringify(env));
    console.log("arc.etherscan.io: " + (/already verified/i.test(m) ? "ya estaba verificado" : "rechazado: " + m.slice(0, 200)));
    return /already verified/i.test(m);
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((ok) => setTimeout(ok, 4000));
    const e = await fetch(API + "&module=contract&action=checkverifystatus&guid=" + env.result + "&apikey=" + clave).then((x) => x.json());
    const r = tapar(String(e.result || ""));
    if (/pending/i.test(r)) continue;
    console.log("arc.etherscan.io: " + r + " | https://arc.etherscan.io/address/" + direccion + "#code");
    return /pass|verified/i.test(r);
  }
  console.log("arc.etherscan.io: sigue pendiente (guid " + env.result + ")");
  return false;
}

/* ── lo que dice el token de si mismo ── */
const code = await rpc("eth_getCode", [direccion, "latest"]);
if (!code || code === "0x") { console.error("en " + direccion + " no hay contrato"); process.exit(1); }
const name = await leer("name()", "string");
const symbol = await leer("symbol()", "string");
const decimals = Number(await leer("decimals()", "uint8") ?? 18);
const totalSupply = await leer("totalSupply()", "uint256");
const metadataURI = await leer("metadataURI()", "string");
const tokenURI = await leer("tokenURI()", "string");
const dueño = await leer("owner()", "address");
console.log("token:      " + direccion + " (cadena " + CADENA + ")");
console.log("identidad:  " + name + " (" + symbol + "), " + decimals + " decimales, bytecode " + (code.length - 2) / 2 + " B");
console.log("owner():    " + (dueño === null ? "no existe el getter" : dueño));
console.log("getters:    metadataURI " + (metadataURI ? "si" : "no") + " | tokenURI " + (tokenURI ? "si" : "no"));

/* ── EL CONTRATO FIJO (18-sep): si el codigo de la cadena es el de BaseyToken o
   BaseyTokenEditable, la fuente es basey-token.js tal cual y no hay nada que
   reconstruir. Se verifica en Sourcify y en arc.etherscan.io, que son los dos que
   se pueden alimentar desde aqui; explorer.arc.io (Blockscout) tiene a Cloudflare
   delante y se hace desde el navegador, UNA vez: despues empareja solo. ── */
/* compilar() se queda con el PRIMER contrato del fichero, que aqui es el abstracto;
   por eso esta entrada se compila aparte y se miran los dos contratos por nombre. */
const entradaFija = {
  language: "Solidity", sources: { "Token.sol": { content: BASEY_TOKEN_SOURCE } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } } },
};
const salidaFija = JSON.parse(execFileSync(SOLC, ["--standard-json"], { input: JSON.stringify(entradaFija), maxBuffer: 64e6 }).toString()).contracts["Token.sol"];
const esFijo = ["BaseyToken", "BaseyTokenEditable"].find((n) =>
  ("0x" + salidaFija[n].evm.deployedBytecode.object).toLowerCase() === code.toLowerCase());
if (esFijo) {
  const identificadorFijo = "Token.sol:" + esFijo;
  console.log("\nES EL CONTRATO FIJO: " + identificadorFijo + " (bytecode identico al de basey-token.js)");
  if (!enviar) { console.log("(ensayo: no se ha enviado nada; repetir con --enviar)"); process.exit(0); }
  await aSourcify(entradaFija, identificadorFijo);
  await aEtherscan(entradaFija, identificadorFijo, salidaFija[esFijo].evm.bytecode.object);
  console.log("\nexplorer.arc.io: https://explorer.arc.io/address/" + direccion + "?tab=contract");
  console.log("  (Blockscout: la primera vez se verifica desde el navegador; despues empareja solo por bytecode)");
  process.exit(0);
}

/* El selector en el bytecode dice si el setter esta, sin tener que llamarlo. */
const tiene = (sig) => code.toLowerCase().includes(ethers.id(sig).slice(2, 10).toLowerCase());
const editable = tiene("setMetadataURI(string)") || tiene("setTokenURI(string)");
const inesperados = ["mint(address,uint256)", "pause()", "enableTrading()", "setTax(uint16,address)", "setBlocked(address,bool)", "upgradeTo(address)"]
  .filter((s) => tiene(s));
if (inesperados.length) {
  console.log("\nESTE TOKEN NO SALIO DEL PASO 6: lleva " + inesperados.join(", "));
  console.log("Se para: habria que reconstruir su configuracion a mano.");
  process.exit(1);
}
let meta = null;
if (metadataURI && metadataURI.trim().startsWith("{")) { try { meta = JSON.parse(metadataURI); } catch { /* no era JSON */ } }
if (!meta) {
  console.log("\nSu metadataURI() no es el JSON que escribe esta pagina, asi que no se puede");
  console.log("reconstruir la fuente exacta. Se para.");
  process.exit(1);
}
const supply = ethers.formatUnits(totalSupply, decimals);
if (!/^\d+(\.0)?$/.test(supply)) { console.error("el supply no es entero: " + supply); process.exit(1); }

const base = {
  name, symbol, supply: supply.replace(/\.0$/, ""), decimals,
  metaMode: "inline", metaImage: meta.image || "", metaDescription: meta.description || "",
  metaWebsite: meta.website || "", metaTwitter: meta.twitter || "", metaTelegram: meta.telegram || "",
  metaUri: "", taxBps: 0, taxCeilingBps: 1000, maxSupply: "0", maxTxAmount: "0", maxWalletAmount: "0",
  mintable: false, burnable: false, pausable: false, blacklist: false, tradingToggle: false,
  maxTx: false, transferTax: false, permit: false, capped: false, upgradeable: false,
};

/* ── las cuatro combinaciones, y gana la que cuadre con la cadena ── */
console.log("\nprobando combinaciones (identidad editable x renuncia) contra el bytecode de la cadena:");
let ganadora = null;
for (const metaMutable of [editable, !editable]) {
  for (const ownership of ["renounce", "keep"]) {
    const cfg = { ...base, metaMutable, ownership };
    let c;
    try { c = compilar(generateSource(cfg)); } catch (e) { console.log("  editable=" + metaMutable + " " + ownership + ": no compila"); continue; }
    const igual = c.desplegado.toLowerCase() === code.toLowerCase();
    console.log("  editable=" + String(metaMutable).padEnd(5) + " " + ownership.padEnd(8) + ": " + (igual ? "IGUAL" : "distinto (" + (c.desplegado.length - 2) / 2 + " B)"));
    if (igual) { ganadora = { cfg, ...c }; break; }
  }
  if (ganadora) break;
}
if (!ganadora) {
  console.log("\nNINGUNA CUADRA. No se manda nada.");
  console.log("Las causas de siempre: el token se lanzo con otra version del generador, o");
  console.log("con otro solc, o no salio de esta pagina. Comparar a mano con --standard-json.");
  process.exit(1);
}
const identificador = "Token.sol:" + ganadora.nombre;
console.log("\ncuadra exacto: " + identificador + " | editable=" + ganadora.cfg.metaMutable + " | " + ganadora.cfg.ownership);
console.log("compilador: " + VERSION_SOLC);

if (!enviar) { console.log("\n(ensayo: no se ha enviado nada; repetir con --enviar)"); process.exit(0); }

/* ── a Sourcify (v2), el mismo camino con el que se verificaron los de Cusp ── */
const cuerpo = {
  stdJsonInput: ganadora.entrada,
  compilerVersion: VERSION_SOLC,
  contractIdentifier: identificador,
};
const r = await fetch(SOURCIFY + "/v2/verify/" + CADENA + "/" + direccion, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo),
});
const txt = await r.text();
let j; try { j = JSON.parse(txt); } catch { j = { crudo: txt.slice(0, 300) }; }
console.log("envio: http " + r.status + " " + JSON.stringify(j).slice(0, 300));
if (r.status === 409) { console.log("ya estaba verificado."); process.exit(0); }
if (!j.verificationId) process.exit(1);
for (let i = 0; i < 40; i++) {
  await new Promise((ok) => setTimeout(ok, 3000));
  const e = await fetch(SOURCIFY + "/v2/verify/" + j.verificationId).then((x) => x.json());
  if (!e.isJobCompleted) { process.stdout.write("."); continue; }
  console.log("");
  if (e.error) { console.log("RESULTADO: ERROR " + (e.error.customCode || "") + " -- " + String(e.error.message || "").slice(0, 300)); process.exit(1); }
  const c = e.contract || {};
  console.log("RESULTADO: match=" + c.match + " creationMatch=" + c.creationMatch + " runtimeMatch=" + c.runtimeMatch);
  console.log("ficha: https://repo.sourcify.dev/" + CADENA + "/" + ethers.getAddress(direccion));
  process.exit(0);
}
console.log("\nsigue en cola en Sourcify; volver a mirar con su verificationId " + j.verificationId);
