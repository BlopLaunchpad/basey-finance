/* HUELLA EN BASEY.md: EL $OLIG DESDE UNA WALLET NUEVA (5-oct-2026). node tools/apuntar-olig-wallet-nueva.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "BASEY.md");
let s = fs.readFileSync(F, "utf8");
const a = "## Huella (lo último primero: fecha, hora UTC y qué se hizo)\n";
assert.strictEqual(s.split(a).length, 2, "ancla huella");
assert.ok(!s.includes("DESDE UNA WALLET NUEVA, SOLO PARA EL TOKEN"), "ya estaba");
s = s.replace(a, () => a + `
- **2026-10-05 04:40 UTC — PESTAÑA 9: EL $OLIG SE CREA DESDE UNA WALLET NUEVA, SOLO PARA EL TOKEN** (\`tools/aplicar-olig-wallet-nueva.mjs\`,
  \`olig.js?v=4\`). El dueño: *"puedo crear otra wallet especificamente para esto, lanzar el token y guardarlo hasta el airdrop"*.
  Mejor que la de comisiones (0xF8eB…d0d5, de uso diario: nonce 1.377 el 4-oct). Ahora la pestaña lo pide al reves: si se
  conecta la de comisiones se para (salvo casilla "Use the OligArc fee wallet anyway"); antes de firmar dice a que direccion van
  los 1.000.000.000 OLIG; ya creado, enseña el saldo de la wallet que lo desplego. Esa wallet necesita ~0,1 USDC en Arc para el gas
  (el despliegue simulado gasto 3,86 M). Comisiones del 1 % compra / 1 % venta: van en el hook del pool V4 el dia del airdrop,
  no en el token.
`);
fs.writeFileSync(F, s);
console.log("ok");
