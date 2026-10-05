/* Huella en BASEY.md: la pestaña 10, el generador de wallets (5-oct-2026). node tools/apuntar-wallet.mjs */
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
assert.ok(!s.includes("PESTAÑA 10: EL GENERADOR DE WALLETS"), "ya estaba");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(RAIZ, f))).digest("hex");
const huellas = ["wallet.html", "wallet.js", "wallet.css", "style.css", "ethers-6.17.0.umd.min.js"].map((f) => `  ${sha(f)}  ${f}`).join("\n");
s = s.replace(a, () => a + `
- **2026-10-05 07:40 UTC — PESTAÑA 10: EL GENERADOR DE WALLETS** (\`wallet.html\`, \`wallet.js?v=2\`, \`wallet.css?v=2\`, \`style.css?v=27\`).
  El dueño: *"un apartado 10 con un generador de wallet EVM con la maxima aleatoriedad y entropia que podamos"*, para la wallet
  nueva que sera a la vez el builder de OligArc, el fondo publico de liquidez y la que crea $OLIG, sin enseñar nunca la clave
  hasta tener las fisicas y la Safe 2 de 3.
  - **Pagina aparte**, \`wallet.html\`: CSP en meta \`default-src 'none'; script-src 'self'; connect-src 'none'\`, ethers 6.17.0
    copiado en la raiz (\`tools/copiar-ethers.mjs\`: igual byte a byte en npm y cdnjs, si no, no copia). Clave =
    SHA-256(32 bytes del sistema + raton/teclado/toques + 32 bytes), rango comprobado; cifrada al momento (keystore V3, scrypt
    2^17); el fichero se llama \`keystore-<fecha>-<id>.json\` y la direccion NO se ve hasta que el paso 4 abre el fichero guardado
    con la contraseña TECLEADA (pegada o autorrellenada, no). Contraseña: 8 palabras BIP39 que hace la pagina, o propia de 16+
    solo ASCII (ethers normaliza NFKC y MetaMask no: con º, ª o tildes sueltas el paso 4 daria OK y MetaMask no abriria).
  - **Revision adversaria** (un agente, ~150k tokens): la alta era real y la probo en Chrome headless: wallet.html comparte
    origen con el launcher, asi que una pagina del mismo sitio que la abra con window.open (o en un iframe) se lleva clave y
    contraseña con "Network: blocked" en verde; el camino era el ethers de cdnjs SIN integrity en index.html o un XSS. Arreglado:
    la pagina se para con \`window.opener\` o dentro de un marco, el ethers del launcher lleva **SRI** (sha384, cdnjs = npm), la
    red solo cuenta como bloqueada si salta la violacion de CSP \`connect-src\`, y **la wallet de verdad se crea desde la copia
    LOCAL** (\`file:///…/arc-launcher/wallet.html\`) en una ventana de invitado de Chrome y con el Wi-Fi apagado: la web se baja
    de nuevo cada vez y comparte sitio con el launcher; las extensiones no las para ninguna CSP.
  - Probado: \`node tools/probar-wallet.mjs\` **32 bien, 0 mal** (la direccion no aparece antes del paso 4, pegar se rechaza, la
    clave no esta en el fichero, ni en el DOM ni en localStorage, ethers en Node abre el fichero con la frase, dos wallets
    distintas, window.open e iframe paran, file:// bloqueado, el launcher carga ethers con SRI).
  - **Huellas sha256 de la copia local** (las que se usan; comprobar antes con \`git diff --quiet HEAD -- wallet.html wallet.js
    wallet.css style.css ethers-6.17.0.umd.min.js\` y \`sha256sum\`):
\`\`\`
${huellas}
\`\`\`
`);
fs.writeFileSync(F, s);
console.log("ok");
