/* $OLIG en la base de codigos compartida de Blockscout (eth-bytecode-db), 5-oct-2026. explorer.arc.io es Blockscout y su
   API esta detras de Cloudflare (403 sin navegador); esta base NO lo esta, y Blockscout verifica solo un contrato cuyo codigo
   ya esta en ella cuando se abre su ficha (asi salian verdes los tokens de terceros). Se le manda la MISMA entrada estandar
   que guardo Sourcify (exact_match) con el codigo desplegado. No hace falta clave. node tools/verificar-olig-blockscout-db.mjs */
const DIR = process.argv[2] || "0x14385d2f530Ba1763eDe4fB3E5471275305b739f";
const s = await fetch(`https://sourcify.dev/server/v2/contract/5042/${DIR}?fields=stdJsonInput,compilation`).then((r) => r.json());
if (!s.stdJsonInput) { console.log("Sourcify no devuelve la entrada"); process.exit(1); }
const code = await fetch("https://rpc.mainnet.arc.io", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [DIR, "latest"] }) }).then((r) => r.json()).then((j) => j.result);
console.log("codigo desplegado:", (code.length - 2) / 2, "bytes |", s.compilation.compilerVersion, "|", s.compilation.fullyQualifiedName);
const cuerpo = { bytecode: code, bytecodeType: "DEPLOYED_BYTECODE", compilerVersion: "v" + String(s.compilation.compilerVersion).replace(/^v/, ""),
  input: JSON.stringify(s.stdJsonInput), metadata: { chainId: "5042", contractAddress: DIR } };
const r = await fetch("https://eth-bytecode-db.services.blockscout.com/api/v2/verifier/solidity/sources:verify-standard-json", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
const t = await r.text();
let j; try { j = JSON.parse(t); } catch (e) { j = null; }
console.log("eth-bytecode-db: HTTP", r.status, "|", j ? (j.status || "") + " " + (j.message || "") + " | fuentes: " + ((j.eth_bytecode_db_sources || j.ethBytecodeDbSources || j.sources || []).length || (j.source ? 1 : 0)) + " | match: " + JSON.stringify((j.source && (j.source.matchType || j.source.match_type)) || (j.sources && j.sources[0] && (j.sources[0].matchType || j.sources[0].match_type)) || "") : t.slice(0, 300));
