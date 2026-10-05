/* Huella en BASEY.md (5-oct-2026): la clave en el paso 4 de la pestaña 10, el $OLIG creado y verificado, y el pool solo con
   USDC de la pestaña 9 que hizo salir su imagen en GMGN. node tools/apuntar-olig-lanzado.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "BASEY.md");
let s = fs.readFileSync(F, "utf8");
const a = "## Huella (lo último primero: fecha, hora UTC y qué se hizo)\n";
assert.strictEqual(s.split(a).length, 2, "ancla huella");
assert.ok(!s.includes("$OLIG CREADO Y VERIFICADO"), "ya estaba");
s = s.replace(a, () => a + `
- **2026-10-05 ~09:15 UTC — PESTAÑA 9: POOL SOLO CON USDC Y EL BOTON PARA SACARLO; GMGN YA ENSEÑA EL $OLIG**
  (\`olig.js?v=8\`, \`olig-pool-usdc.js?v=1\`). Idea del dueño: el ARC oficial (\`0xA12C…788d\`) sale con icono en GMGN y nadie
  puede comprarlo; medido el 16-sep: tiene 5 pools V4 de terceros y ninguno lleva ARC. Bloque abajo del todo: pool V4
  OLIG/USDC al 1 % (espaciado 200) SIN hook, con unos USDC por debajo del precio y CERO OLIG (OLIG va por debajo de USDC:
  currency0 = OLIG; precio del pool = $/OLIG * 1e-12); lo firma CUALQUIER wallet con USDC en Arc; si el pool existe, añade
  por debajo de su precio. Boton "Take the USDC back": DECREASE_LIQUIDITY + TAKE_PAIR de la posicion (NFT; se apunta en
  \`basey.oligPool\`, si no se busca en los ultimos ~200.000 bloques o se escribe el numero).
  - Simulado entero en Arc (\`tools/probar-pool-usdc.mjs\`, eth_simulateV1 desde 0x6631): pool abierto, 1,998 USDC dentro,
    0 OLIG en el PoolManager, y al sacarlo vuelve todo. \`tools/probar-pestana-9.mjs\`: 10/10 (PC y movil, sin errores).
  - El dueño puso 1,998 USDC y los saco (GMGN: "Agregar +1.998" y "Eliminar -1.997"): **GMGN enseña icono, X y web con
    precio $0 y MC $0**. Igual que el ARC (Precio $0.0000, MC $0.0): sin operaciones no hay precio. El texto de ayuda decia
    que el MC de salida era el precio que veria GMGN; corregido (el dueño lo vio antes que yo).
  - El pool del lanzamiento llevara el hook de OligArc: es otro pool (otra clave). Este, vacio, no estorba.

- **2026-10-05 08:53:35 UTC — $OLIG CREADO Y VERIFICADO** desde la pestaña 9 por la wallet nueva
  \`0x663116a35b81d8496356856defb44ec8be183f71\` (hecha con la pestaña 10; a la vez sera builder de OligArc y fondo publico de
  liquidez). **Contrato \`0x14385d2f530Ba1763eDe4fB3E5471275305b739f\`**, bloque 24364937, tx \`0x6355d3c1…24cf\`. Oligarc / OLIG
  / 18 / 1.000.000.000 en la wallet que lo creo; owner() = 0x0; logo, tokenURI y description dentro.
  - **Sourcify: exact_match** (creacion y ejecucion; \`forge verify-contract … src/Oligarc.sol:Oligarc --verifier sourcify
    --chain-id 5042\`). **arc.etherscan.io: verificado** (Sourcify se lo paso solo; \`tools/verificar-olig-etherscan.mjs\` lo
    comprueba con la clave del dueño y solo manda si falta). **explorer.arc.io: "Contract" con check verde** (captura del
    dueño, 09:20 UTC), aunque el verificador compartido de Blockscout solo lista hasta 0.8.36
    (\`tools/verificar-olig-blockscout-db.mjs\` dio 400 por eso): lo importo por otro lado. Arcscan: su API da 530/1033
    (tunel caido) y su web pide la casilla de Cloudflare: no se pudo ni mirar.
  - La ficha del token en explorer.arc.io (icono y tick): firma del creador + formulario, **cuesta 99 €**; el dueño: no de
    momento. Datos preparados: icono https://oligarc.xyz/pwa/icon-512.png (publico), web, X, oligarchelp@gmail.com.
  - La pestaña 9 sigue con su boton (marca "Create another $OLIG (not needed)"); no se toca.

- **2026-10-05 ~08:10 UTC — PESTAÑA 10: LA CLAVE PRIVADA EN EL PASO 4, SI SE PIDE** (\`wallet.js?v=4\`, \`wallet.css?v=4\`). El dueño:
  la mete en Rabby (importa por clave) y guarda el fichero cifrado como copia. Tras abrir el fichero guardado: boton "Show
  the private key" con confirmacion, Copy y Hide, se esconde sola a los 2 min y sobrescribe el portapapeles al minuto si
  la pagina sigue delante. \`tools/probar-wallet.mjs\` 38/38.
`);
fs.writeFileSync(F, s);
console.log("ok");
