/* HUELLA EN BASEY.md: EL $OLIG CON IMAGEN Y ENLACES DENTRO (4-oct-2026, tarde). node tools/apuntar-olig-metadata.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "BASEY.md");
let s = fs.readFileSync(F, "utf8");
const a = "## Huella (lo último primero: fecha, hora UTC y qué se hizo)\n";
assert.strictEqual(s.split(a).length, 2, "ancla huella");
assert.ok(!s.includes("$OLIG CON IMAGEN Y ENLACES"), "ya estaba");
s = s.replace(a, () => a + `
- **2026-10-04 19:15 UTC — PESTAÑA 9: EL $OLIG CON IMAGEN Y ENLACES DENTRO, Y QUIEN FIRMA, DICHO.** Antes de que el dueño lo cree:
  *"en Arc Launcher conseguimos que tanto icon como redes y demas apareciesen de una en gmgn ... a ver si voy a lanzar el token y
  va a salir sin redes ni nada"*. Tenia razon: el Oligarc.sol de las 17:10 no tenia ningun getter de los que leen los rastreadores,
  y sin dueño no se le podria añadir nunca.
  - \`tools/generar-olig-sol.mjs\` genera \`contratos-olig/src/Oligarc.sol\` con la forma EXACTA del TEST de basey que GMGN pinto
    (leido en cadena con el nuevo \`tools/mirar-metadata-token.mjs\`): \`tokenURI()\` = data URI base64 del JSON {name, symbol,
    description, image, website https://oligarc.xyz, twitter https://x.com/oligarcxyz}, \`logo()\` = la imagen DENTRO del
    contrato (\`contratos-olig/logo/olig-200.webp\`, la moneda del oligarca 200x200, 4.092 bytes; no depende de ningun dominio),
    \`description()\` y \`owner()\` constante a cero (sin ese getter salia interrogacion en "Renunciado"). Sin \`metadataURI()\`
    (solo lo leia el indexer de blop, apagado; duplicaba la imagen). 17.082 bytes de codigo (limite 24.576).
  - \`forge test\` 10/10 (nuevas: owner() cero y los getters). \`tools/probar-olig-arc.mjs\`: despliegue SIMULADO en Arc
    (eth_simulateV1 en arc.drpc.org, nada enviado) desde la wallet de comisiones: OK, **3.858.959 de gas** (~0,08 USDC), el JSON se
    decodifica con nombre, simbolo, web y X, y la imagen es byte a byte la webp. Nacería en la dirección que toque al nonce del
    momento (con el nonce 1377 de hoy, 0x50BD…0370).
  - \`olig-codigo.js?v=2\` (md5 del bytecode **68cf254a…2a37**; el de las 17:10, fafa2519…, ya no se sirve), \`olig.js?v=3\`: ya creado,
    la tarjeta enseña el icono leido del contrato, los enlaces y owner(). Probado en local con el TEST de basey como sustituto.
  - **Quien firma**: el dueño temia que lo creara la wallet rapida. No: \`olig.js\` pide la cuenta a \`window.ethereum\` y envia con
    \`BrowserProvider\`; la rapida vive solo en \`app.js\` (\`signer\`). Ahora el panel y el aviso de firma lo dicen
    (\`tools/aplicar-olig-firma.mjs\`), y no hace falta conectar el launcher antes.
`);
fs.writeFileSync(F, s);
console.log("ok");
