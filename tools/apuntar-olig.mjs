/* HUELLA EN BASEY.md: LA PESTAÑA 9, OLIGARC ($OLIG) (4-oct-2026). node tools/apuntar-olig.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "BASEY.md");
let s = fs.readFileSync(F, "utf8");
const a = "## Huella (lo último primero: fecha, hora UTC y qué se hizo)\n";
assert.strictEqual(s.split(a).length, 2, "ancla huella");
s = s.replace(a, () => a + `
- **2026-10-04 17:10 UTC — PESTAÑA 9: CREAR EL TOKEN OLIGARC ($OLIG) CON UN BOTON.** El dueño (lo pidio el, para OligArc):
  *"me haces una pestaña especial para darle no mas a un boton y creo el token; lo suyo es crear el token con la misma wallet que
  recibe las fees de oligarc"*. Nombre **Oligarc** (sin A mayuscula, lo pidio), ticker **OLIG**.
  - Contrato \`contratos-olig/src/Oligarc.sol\`: OpenZeppelin 5.7.0 ERC20 + Burnable + Permit, **1.000.000.000 fijos a quien lo
    despliega**, sin dueño, sin acuñar, sin pausa, sin lista negra, sin comisiones (la quema y las comisiones de compras y ventas
    iran en el hook del pool V4, nunca en el token: un impuesto en el token rompe las ventas en Arc, ver token-features.js).
    solc 0.8.37 exacto, evm cancun, optimizador 200 (el porque en \`contratos-olig/foundry.toml\`). \`forge test\` **8/8**.
  - \`tools/compilar-olig.mjs\` -> \`olig-codigo.js\` (el bytecode EXACTO que compilo y probo forge; md5 fafa2519...). La pagina no
    compila: despliega ese bytecode. \`olig.js?v=1\`: red Arc, cuenta = wallet de comisiones 0xF8eB…d0d5 (o casilla explicita),
    estimacion de gas en la cadena antes de firmar, hash guardado al enviar (\`basey.olig\`), recibo recuperado si se pierde la
    respuesta, y casilla para un segundo despliegue. Lectura propia por rpc.mainnet.arc.io.
  - Simulado en Arc desde la wallet de comisiones (solo estimacion, nada firmado): 990.836 de gas a 20 gwei (~0,02 USDC); la
    wallet tiene 347 USDC en Arc. Probado en local (4322): la pestaña, el aviso sin wallet y la lectura de un contrato (con el USDC
    de Arc haciendo de token).
  - **Falta**: que el dueño lo cree (desde su PC con la wallet de comisiones), verificarlo en Sourcify y los exploradores, y
    poner su direccion en el tweet fijado de OligArc. Desliz mio: un \`sed -i\` para añadir una linea al foundry.toml (salio bien).
`);
fs.writeFileSync(F, s);
console.log("ok");
