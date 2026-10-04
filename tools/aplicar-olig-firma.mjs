/* PESTAÑA 9: DEJAR ESCRITO QUIEN FIRMA (4-oct-2026, tarde). El dueño temia que el token lo creara la wallet rapida del
   launcher: *"tiene que ser en el apartado 9 que mande la wallet conectada, la que firma"*. Ya era asi (olig.js pide la
   cuenta a window.ethereum y envia con BrowserProvider; la rapida vive solo en app.js, en `signer`), pero el panel no lo
   decia. Ahora lo dice, y el aviso de firma tambien. Assert en cada ancla. node tools/aplicar-olig-firma.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {};
const leer = (n) => (files[n] = files[n] != null ? files[n] : fs.readFileSync(path.join(RAIZ, n), "utf8"));
function cambiar(n, a, b, q) { const s = leer(n); assert.strictEqual(s.split(a).length, 2, n + " ancla: " + q); files[n] = s.replace(a, () => b); }

cambiar("index.html", "<p class=\"lede\">The OligArc token. One button, signed by the OligArc fee wallet. It can't be traded until we open its pool on the day the airdrop is distributed.</p>",
  "<p class=\"lede\">The OligArc token. One button, signed in your own wallet's window by the wallet you have connected in this browser (the OligArc fee wallet). The fast wallet never touches it, and you don't need to connect the launcher first. It can't be traded until we open its pool on the day the airdrop is distributed.</p>", "lede");
cambiar("olig.js", "    aviso(\"Confirm the deployment in your wallet (≈ \" + gas.toString() + \" gas).\");\n",
  "    aviso(\"Confirm the deployment in your wallet's own window, signed by \" + corto(a) + \" (≈ \" + gas.toString() + \" gas).\");\n", "aviso firma");
cambiar("index.html", "<script type=\"module\" src=\"olig.js?v=1\"></script>", "<script type=\"module\" src=\"olig.js?v=2\"></script>", "version olig.js");
for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(RAIZ, n), s);
console.log("pestaña 9: quien firma, escrito");
