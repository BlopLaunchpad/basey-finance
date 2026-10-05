/* HUELLA EN BASEY.md: "TEST FIRST" EN LA PESTAÑA 9 (5-oct-2026). node tools/apuntar-olig-test.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "BASEY.md");
let s = fs.readFileSync(F, "utf8");
const a = "## Huella (lo último primero: fecha, hora UTC y qué se hizo)\n";
assert.strictEqual(s.split(a).length, 2, "ancla huella");
assert.ok(!s.includes("TEST FIRST EN LA PESTAÑA 9"), "ya estaba");
s = s.replace(a, () => a + `
- **2026-10-05 07:05 UTC — TEST FIRST EN LA PESTAÑA 9** (\`olig.js?v=5\`, \`style.css?v=25\`). El dueño: *"primero quiero hacer un token
  test con redes test e icon test ... para asegurarme que las redes y el icon y demas salen, y ya despues lanzo Oligarc $OLIG"*.
  GMGN enseña los tokens de Arc SIN pool (me lo tuvo que recordar: yo le habia dicho que hacia falta pool, y no).
  - \`tools/generar-olig-test.mjs\` -> \`contratos-olig/src/OligTest.sol\`: el MISMO contrato que Oligarc.sol con nombre y simbolo
    TEST, el icono viejo del arco (\`contratos-olig/logo/test-200.webp\`) y enlaces de prueba: https://example.com/, https://x.com/x
    y https://t.me/telegram. \`compilar-olig.mjs\` escribe ademas \`olig-test-codigo.js\` (md5 b45398f6). El bytecode del bueno no
    cambia (68cf254a). \`probar-olig-arc.mjs test\`: despliegue simulado en Arc OK, 3.005.950 de gas, JSON e icono byte a byte.
  - En el panel, "Test first" encima del bueno: lo firma la wallet que este conectada, se guarda aparte (\`basey.olig.test\`), no
    bloquea el bueno y enseña el icono, los tres enlaces y owner(). Probado en local con el TEST viejo de basey como sustituto.
`);
fs.writeFileSync(F, s);
console.log("ok");
