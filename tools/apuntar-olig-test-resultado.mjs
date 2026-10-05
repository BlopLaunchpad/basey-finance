/* HUELLA EN BASEY.md: LO QUE DEMOSTRO EL TEST Y LA PESTAÑA 9 LIMPIA (5-oct-2026). node tools/apuntar-olig-test-resultado.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "BASEY.md");
let s = fs.readFileSync(F, "utf8");
const a = "## Huella (lo último primero: fecha, hora UTC y qué se hizo)\n";
assert.strictEqual(s.split(a).length, 2, "ancla huella");
assert.ok(!s.includes("GMGN LEE LA METADATA CUANDO HAY POOL"), "ya estaba");
s = s.replace(a, () => a + `
- **2026-10-05 05:45 UTC — GMGN LEE LA METADATA CUANDO HAY POOL; LA PESTAÑA 9 QUEDA SOLO PARA EL $OLIG** (\`olig.js?v=7\`).
  - El dueño creo el TEST (\`0xF62F87E94B4b413a952a804037FAc6E577Eb3A3a\`, desde 0x7d41…1593; tx 0x3db06850…fe11). En la cadena,
    todo bien (\`tools/mirar-metadata-token.mjs\`), pero GMGN lo listaba con \`logo: ""\` y sin redes (su API
    \`mutil_window_token_info\`, leida en el navegador integrado). El TEST de basey, con pool V4 desde el primer bloque, si tenia
    su logo copiado en \`gmgn.ai/external-res/…webp\` y sus enlaces.
  - Con el bloque "Uniswap V4 pool" de la pestaña 9 (\`olig-pool.js\`: Permit2 x2 + PositionManager.multicall(initializePool,
    MINT+SETTLE_PAIR), pool USDC/TEST 1 % / 200 / sin hook a 5.000 $ de MC, muro de 999 M solo de token, suelo 0; simulado antes
    con \`tools/probar-pool-v4.mjs\` desde la wallet del dueño) el dueño abrio la pool y compro: **GMGN saco el icono y las tres
    redes en minutos** (captura del dueño, 07:31 hora de España). **Conclusion medida: GMGN lee tokenURI/logo cuando el token
    tiene pool, no al crearse.** El $OLIG saldra con su icono el dia que se abra su pool (el del airdrop).
  - El TEST verificado en Sourcify: \`forge verify-contract … src/OligTest.sol:OligTest --verifier sourcify --chain-id 5042\`
    -> exact_match (creacion y ejecucion). Sourcify reenvio a arc.etherscan.io; a Blockscout no (403 de Cloudflare).
  - El dueño: *"puedes sacar todo lo test de la pestaña 9 y prepararlo para lanzar Oligarc $OLIG"*: fuera el bloque del TEST y
    el del pool (\`tools/aplicar-olig-sin-test.mjs\`); \`olig.js\` reescrito solo con el bueno. Quedan en el repo, sin cargar:
    \`OligTest.sol\`, \`olig-test-codigo.js\`, \`olig-pool.js\` y sus herramientas (base para el boton del dia del lanzamiento).
`);
fs.writeFileSync(F, s);
console.log("ok");
