/* PESTAÑA 9: "TEST FIRST" EN EL PANEL (5-oct-2026). El boton del token de prueba (OligTest.sol: el mismo contrato con nombre
   TEST, icono y enlaces de prueba) va ENCIMA del bueno, con su aviso y su resultado; olig.js?v=5. Assert en cada ancla.
   node tools/aplicar-olig-test.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = path.join(RAIZ, "index.html");
let s = fs.readFileSync(F, "utf8");
function cambiar(a, b, q) { assert.strictEqual(s.split(a).length, 2, "ancla: " + q); s = s.replace(a, () => b); }
cambiar("      <label class=\"olig-check\"><input type=\"checkbox\" id=\"oligOtra\">",
  "      <div class=\"olig-test\">\n" +
  "        <h3>Test first</h3>\n" +
  "        <p>The same contract with the name TEST, a test picture and test links (example.com, x.com/x, t.me/telegram), to check on GMGN that the picture and links show before creating the real one. Any wallet can sign it.</p>\n" +
  "        <button id=\"oligTestBtn\" class=\"btn\" type=\"button\">Create a TEST token</button>\n" +
  "        <p id=\"oligTestMsg\" class=\"olig-msg\" aria-live=\"polite\"></p>\n" +
  "        <div id=\"oligTestOut\"></div>\n" +
  "      </div>\n" +
  "      <h3>The real one</h3>\n" +
  "      <label class=\"olig-check\"><input type=\"checkbox\" id=\"oligOtra\">", "bloque test");
cambiar("<script type=\"module\" src=\"olig.js?v=4\"></script>", "<script type=\"module\" src=\"olig.js?v=5\"></script>", "version olig.js");
fs.writeFileSync(F, s);
const C = path.join(RAIZ, "style.css");
let c = fs.readFileSync(C, "utf8");
const m = "/* 9 · Oligarc: el bloque del TEST, 5-oct-2026 */";
if (!c.includes(m)) { c += `\n${m}\n.olig-test { border: 1px dashed rgba(127,127,127,.45); border-radius: 10px; padding: 12px 14px; margin: 0 0 18px; }\n.olig-test h3 { margin: 0 0 6px; }\n.olig-test p { margin: 0 0 10px; }\n`; fs.writeFileSync(C, c); }
console.log("pestaña 9: Test first");
