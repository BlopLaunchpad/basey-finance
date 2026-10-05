/* Pestaña 10 (5-oct-2026): copia ethers 6.17.0 (UMD) de node_modules a la raiz del sitio, para que wallet.html no cargue
   NADA de fuera (su CSP solo admite 'self'), y comprueba que es byte a byte el que publican npm (via jsdelivr) y cdnjs: dos
   fuentes independientes que tienen que coincidir con la copia local.
   node tools/copiar-ethers.mjs */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VER = "6.17.0";
const ORIGEN = path.join(RAIZ, "node_modules", "ethers", "dist", "ethers.umd.min.js");
const DESTINO = path.join(RAIZ, `ethers-${VER}.umd.min.js`);
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "node_modules", "ethers", "package.json"), "utf8"));
if (pkg.version !== VER) throw new Error("node_modules/ethers es " + pkg.version + ", no " + VER);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const local = fs.readFileSync(ORIGEN);
const fuentes = {
  jsdelivr: `https://cdn.jsdelivr.net/npm/ethers@${VER}/dist/ethers.umd.min.js`,
  cdnjs: `https://cdnjs.cloudflare.com/ajax/libs/ethers/${VER}/ethers.umd.min.js`,
};
console.log("local    ", sha(local), local.length, "bytes");
// Las DOS tienen que contestar y coincidir: una que no responde o que da otra cosa para la copia (revision 5-oct).
for (const [n, u] of Object.entries(fuentes)) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(n + " contesto HTTP " + r.status + ": no se copia");
  const b = Buffer.from(await r.arrayBuffer());
  const ok = sha(b) === sha(local);
  console.log(n.padEnd(9), sha(b), b.length, "bytes", ok ? "IGUAL" : "DISTINTO");
  if (!ok) throw new Error(n + " sirve OTRO fichero: no se copia");
}
fs.writeFileSync(DESTINO, local);
console.log("copiado a", path.basename(DESTINO), "(las 2 fuentes coinciden)");
