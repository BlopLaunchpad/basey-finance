/* Solo lectura (4-oct-2026): los getters que leen los rastreadores (GMGN y compañia) de un token de Arc:
   name, symbol, owner(), tokenURI() (y su JSON si es data URI), logo(), description(), metadataURI().
   Sirve para copiar el formato de un token que SI sale con imagen y redes, y para comprobar el $OLIG desplegado.
   node tools/mirar-metadata-token.mjs <direccion> */
import { ethers } from "ethers";
const RPC = ["https://rpc.mainnet.arc.io", "https://arc.drpc.org"];
const dir = process.argv[2];
if (!/^0x[0-9a-fA-F]{40}$/.test(dir || "")) { console.error("uso: node tools/mirar-metadata-token.mjs <direccion>"); process.exit(1); }
const iface = new ethers.Interface(["function name() view returns (string)", "function symbol() view returns (string)", "function owner() view returns (address)",
  "function tokenURI() view returns (string)", "function logo() view returns (string)", "function description() view returns (string)", "function metadataURI() view returns (string)"]);
async function llamar(f) {
  for (const url of RPC) {
    try {
      const p = new ethers.JsonRpcProvider(url, 5042, { staticNetwork: true });
      const r = await p.call({ to: dir, data: iface.encodeFunctionData(f) });
      if (r === "0x") return "(no existe)";
      return iface.decodeFunctionResult(f, r)[0];
    } catch (e) { if (/revert|CALL_EXCEPTION/i.test(String(e.message))) return "(no existe)"; }
  }
  return "(sin respuesta)";
}
for (const f of ["name", "symbol", "owner", "tokenURI", "logo", "description", "metadataURI"]) {
  const v = await llamar(f);
  const s = String(v);
  console.log(f.padEnd(12), s.length > 300 ? s.slice(0, 160) + " … (" + s.length + " caracteres) … " + s.slice(-40) : s);
  if (f === "tokenURI" && s.startsWith("data:application/json;base64,")) console.log("  JSON:", Buffer.from(s.slice(29), "base64").toString("utf8").replace(/"image":"data:[^"]{40}[^"]*"/, '"image":"data:…"'));
}
