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
