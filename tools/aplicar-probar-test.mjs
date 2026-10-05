/* tools/probar-olig-arc.mjs tambien para la copia de prueba: node tools/probar-olig-arc.mjs test (5-oct-2026).
   Assert en cada ancla. node tools/aplicar-probar-test.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), "probar-olig-arc.mjs");
let s = fs.readFileSync(F, "utf8");
function cambiar(a, b, q) { assert.strictEqual(s.split(a).length, 2, "ancla: " + q); s = s.replace(a, () => b); }
cambiar("import { OLIG_BYTECODE, OLIG_BYTECODE_MD5 } from \"../olig-codigo.js\";\n",
  "import { OLIG_BYTECODE as BC_OLIG, OLIG_BYTECODE_MD5 as MD5_OLIG } from \"../olig-codigo.js\";\n" +
  "import { OLIGTEST_BYTECODE, OLIGTEST_BYTECODE_MD5 } from \"../olig-test-codigo.js\";\n" +
  "// 5-oct: con el argumento \"test\" se prueba la copia de prueba (OligTest.sol) con sus valores\n" +
  "const TEST = process.argv[2] === \"test\";\n" +
  "const OLIG_BYTECODE = TEST ? OLIGTEST_BYTECODE : BC_OLIG, OLIG_BYTECODE_MD5 = TEST ? OLIGTEST_BYTECODE_MD5 : MD5_OLIG;\n" +
  "const ESP = TEST ? { name: \"TEST\", symbol: \"TEST\", webp: \"test-200.webp\", website: \"https://example.com/\", twitter: \"https://x.com/x\", telegram: \"https://t.me/telegram\" }\n" +
  "  : { name: \"Oligarc\", symbol: \"OLIG\", webp: \"olig-200.webp\", website: \"https://oligarc.xyz\", twitter: \"https://x.com/oligarcxyz\" };\n", "import");
cambiar("const webp = fs.readFileSync(path.join(RAIZ, \"contratos-olig\", \"logo\", \"olig-200.webp\"));\n",
  "const webp = fs.readFileSync(path.join(RAIZ, \"contratos-olig\", \"logo\", ESP.webp));\n", "webp");
cambiar("assert.strictEqual(json.name, \"Oligarc\"); assert.strictEqual(json.symbol, \"OLIG\");\n",
  "assert.strictEqual(json.name, ESP.name); assert.strictEqual(json.symbol, ESP.symbol); assert.strictEqual(json.telegram, ESP.telegram);\n", "nombre");
cambiar("assert.strictEqual(json.website, \"https://oligarc.xyz\"); assert.strictEqual(json.twitter, \"https://x.com/oligarcxyz\");\n",
  "assert.strictEqual(json.website, ESP.website); assert.strictEqual(json.twitter, ESP.twitter);\n", "enlaces");
cambiar("assert.ok(Buffer.from(logo.slice(23), \"base64\").equals(webp), \"la imagen NO es olig-200.webp\");\n",
  "assert.ok(Buffer.from(logo.slice(23), \"base64\").equals(webp), \"la imagen NO es \" + ESP.webp);\n", "imagen");
cambiar("bytes, identica a olig-200.webp)\" })));\n", "bytes, identica a \" + ESP.webp + \")\" })));\n", "texto");
fs.writeFileSync(F, s);
console.log("probar-olig-arc.mjs: tambien 'test'");
