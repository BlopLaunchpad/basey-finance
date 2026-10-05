/* Huella en BASEY.md: la pestaña 10 deja pegar la contraseña (5-oct-2026). node tools/apuntar-wallet-pegar.mjs */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = path.join(RAIZ, "BASEY.md");
let s = fs.readFileSync(F, "utf8");
const a = "## Huella (lo último primero: fecha, hora UTC y qué se hizo)\n";
assert.strictEqual(s.split(a).length, 2, "ancla huella");
assert.ok(!s.includes("PESTAÑA 10: PEGAR LA CONTRASEÑA"), "ya estaba");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(RAIZ, f))).digest("hex");
const huellas = ["wallet.html", "wallet.js", "wallet.css", "style.css", "ethers-6.17.0.umd.min.js"].map((f) => `  ${sha(f)}  ${f}`).join("\n");
const hora = new Date().toISOString().slice(11, 16);
s = s.replace(a, () => a + `
- **2026-10-05 ${hora} UTC — PESTAÑA 10: PEGAR LA CONTRASEÑA** (\`wallet.js?v=3\`, \`wallet.css?v=3\`). El dueño, desde el
  hospital y con el movil: *"ponme para poder pegar la clave anda, que poner 8 palabras con sus barras y solo viendo asteriscos
  es dificil"*. La frase va con UN espacio entre palabras (no guiones), tiene boton Copy, el paso 4 acepta pegar y cada campo de
  contraseña tiene Show/Hide. Si la contraseña no abre, avisa de los espacios. El teclado ya no suma muestras desde ningun
  campo. \`tools/probar-wallet.mjs\` **33 bien, 0 mal** (dos veces). Con la copia local no podia: esta en el hospital; desde el
  movil la web es razonable (Chrome del movil no tiene extensiones), pero importar el fichero cifrado necesita MetaMask de
  escritorio. Huellas sha256 nuevas de la copia local:
\`\`\`
${huellas}
\`\`\`
`);
fs.writeFileSync(F, s);
console.log("ok");
