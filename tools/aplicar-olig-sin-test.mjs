/* PESTAÑA 9 SIN EL TEST (5-oct-2026). El dueño, con el TEST ya comprobado en GMGN: *"puedes sacar todo lo test de la
   pestaña 9 y prepararlo para lanzar Oligarc $OLIG con su metadata"*. Fuera el bloque "Test first" y el del pool V4 de
   prueba; queda solo el bueno. olig.js?v=7. Assert en cada ancla. node tools/aplicar-olig-sin-test.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = path.join(RAIZ, "index.html");
let s = fs.readFileSync(F, "utf8");
function quitarEntre(ini, fin, q) {
  const i = s.indexOf(ini);
  assert.ok(i >= 0 && s.indexOf(ini, i + 1) < 0, "inicio unico: " + q);
  const j = s.indexOf(fin, i);
  assert.ok(j > i, "fin: " + q);
  s = s.slice(0, i) + s.slice(j + fin.length);
}
function cambiar(a, b, q) { assert.strictEqual(s.split(a).length, 2, "ancla: " + q); s = s.replace(a, () => b); }
quitarEntre("      <div class=\"olig-test\">\n        <h3>Test first</h3>", "        <div id=\"oligTestOut\"></div>\n      </div>\n      <h3>The real one</h3>\n", "bloque test");
quitarEntre("  <div class=\"olig-test olig-pool\">\n", "    <div id=\"oligPoolOut\"></div>\n  </div>\n", "bloque pool");
cambiar("<script type=\"module\" src=\"olig.js?v=6\"></script>", "<script type=\"module\" src=\"olig.js?v=7\"></script>", "version olig.js");
assert.ok(!/oligTest|oligPool|Test first/.test(s), "queda algo del test");
fs.writeFileSync(F, s);
console.log("pestaña 9: sin el test");
