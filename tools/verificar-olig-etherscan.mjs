/* $OLIG en arc.etherscan.io (5-oct-2026). Sourcify ya lo tiene (exact_match, forge verify-contract); Etherscan NO importa
   de Sourcify, asi que se le manda la MISMA entrada estandar que guardo Sourcify (la que compilo forge), con la clave del
   dueño (~/.etherscan-key, en UTF-16; nunca se imprime). Sin argumentos de constructor. Mira antes si ya esta verificado.
   explorer.arc.io (Blockscout) va aparte, desde el navegador (Cloudflare delante).
   node tools/verificar-olig-etherscan.mjs [direccion] */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const DIR = (process.argv[2] || "0x14385d2f530Ba1763eDe4fB3E5471275305b739f");
const CADENA = 5042;
const s = await fetch(`https://sourcify.dev/server/v2/contract/${CADENA}/${DIR}?fields=stdJsonInput,compilation`).then((r) => r.json());
if (!s.stdJsonInput || !s.compilation) { console.log("Sourcify no devuelve la entrada: " + JSON.stringify(s).slice(0, 200)); process.exit(1); }
const nombre = s.compilation.fullyQualifiedName, version = s.compilation.compilerVersion;
console.log("Sourcify:", s.match || s.runtimeMatch || "?", "|", nombre, "|", version);
const p = path.join(os.homedir(), ".etherscan-key");
const b = fs.existsSync(p) ? fs.readFileSync(p) : null;
const clave = b ? ((b[0] === 0xff && b[1] === 0xfe) ? b.toString("utf16le") : b.toString("utf8")).match(/[A-Za-z0-9]{30,45}/)?.[0] : null;
if (!clave) { console.log("arc.etherscan.io: sin clave"); process.exit(1); }
const tapar = (t) => String(t).split(clave).join("<clave>");
const API = "https://api.etherscan.io/v2/api?chainid=" + CADENA;
const ya = await fetch(API + "&module=contract&action=getsourcecode&address=" + DIR + "&apikey=" + clave).then((r) => r.json());
const fuente = Array.isArray(ya.result) && ya.result[0] ? ya.result[0] : null;
if (fuente && fuente.SourceCode) { console.log("arc.etherscan.io: YA verificado (" + fuente.ContractName + ", " + fuente.CompilerVersion + ")"); process.exit(0); }
const cuerpo = new URLSearchParams({ module: "contract", action: "verifysourcecode", apikey: clave, codeformat: "solidity-standard-json-input",
  sourceCode: JSON.stringify(s.stdJsonInput), contractaddress: DIR, contractname: nombre, compilerversion: "v" + version.replace(/^v/, ""), constructorArguements: "" });
const env = await fetch(API, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: cuerpo }).then((r) => r.json());
if (String(env.status) !== "1") { console.log("arc.etherscan.io: " + tapar(JSON.stringify(env)).slice(0, 300)); process.exit(1); }
for (let i = 0; i < 30; i++) {
  await new Promise((ok) => setTimeout(ok, 4000));
  const e = await fetch(API + "&module=contract&action=checkverifystatus&guid=" + env.result + "&apikey=" + clave).then((r) => r.json());
  const t = tapar(String(e.result || ""));
  if (/pending|queue/i.test(t)) continue;
  console.log("arc.etherscan.io: " + t);
  process.exit(/pass|verified/i.test(t) ? 0 : 1);
}
console.log("arc.etherscan.io: sin respuesta final a los 2 minutos");
