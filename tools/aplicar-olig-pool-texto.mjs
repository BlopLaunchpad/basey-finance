/* Pestaña 9 (5-oct-2026): el texto del market cap de salida decia que fija el precio que enseña GMGN, y no es asi. Medido
   en la ficha de GMGN del ARC oficial: con pools que solo llevan USDC (p. ej. "+300 y 0 ARC") y sin operaciones, GMGN
   enseña Precio $0.0000 y MC $0.0. El dueño lo vio antes que yo. node tools/aplicar-olig-pool-texto.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.html");
let s = fs.readFileSync(F, "utf8");
const a = `<small>It sets the price GMGN will show. Nobody can buy at it: there is no OLIG in the pool.</small>`;
assert.strictEqual(s.split(a).length, 2, "ancla");
s = s.replace(a, () => `<small>The pool's internal starting price; the USDC sits from a tenth of it up to it. GMGN shows no price for a pool with no trades (the official ARC token reads $0 there), and nobody can buy: there is no OLIG in the pool.</small>`);
fs.writeFileSync(F, s);
console.log("ok");
