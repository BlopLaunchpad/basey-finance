/* Pestaña 10 (5-oct-2026), el dueño: "necesito generar la clave privada desde el json, añadelo donde subo el json y pongo la
   contraseña, que muestre y deje copiar la privada; seria meterla en Rabby y no guardarla en ningun sitio". En el paso 4,
   tras abrir el fichero: un boton (con confirmacion) que enseña la clave, la copia y la vuelve a esconder; se esconde sola a
   los 2 min. wallet.js?v=4, wallet.css?v=4. Y los textos que decian "never shown".
   node tools/aplicar-wallet-clave.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function editar(fichero, cambios) {
  const F = path.join(RAIZ, fichero);
  let s = fs.readFileSync(F, "utf8");
  for (const [viejo, nuevo] of cambios) { assert.strictEqual(s.split(viejo).length, 2, fichero + ": ancla " + viejo.slice(0, 70)); s = s.replace(viejo, () => nuevo); }
  fs.writeFileSync(F, s);
}
editar("wallet.html", [
  [`What you take away is an encrypted file; the address appears once you've checked your backup.`,
   `What you take away is an encrypted file; the address appears once you've checked your backup, and the private key only if you ask for it there.`],
  [`      <div class="wl-dir"><code id="wlDir"></code><button class="btn btn-sm" id="wlCopiar" type="button">Copy</button></div>
    </div>`,
   `      <div class="wl-dir"><code id="wlDir"></code><button class="btn btn-sm" id="wlCopiar" type="button">Copy</button></div>
    </div>
    <div class="wl-clave" id="wlClaveZona" hidden>
      <span class="wl-etq">Private key</span>
      <p class="wl-fine">For a wallet app that imports a private key, like Rabby. Whoever sees it controls the wallet: paste it only into that app, don't take a screenshot and don't save it anywhere. Your encrypted file and your paper are the backup.</p>
      <button class="btn btn-danger" id="wlVerClave" type="button">Show the private key</button>
      <div id="wlClaveCaja" hidden>
        <code id="wlClaveTxt"></code>
        <div class="wl-fila"><button class="btn btn-sm" id="wlClaveCopiar" type="button">Copy</button><button class="btn btn-sm" id="wlClaveOcultar" type="button">Hide</button></div>
        <small class="wl-msg" id="wlClaveMsg" aria-live="polite"></small>
      </div>
    </div>`],
  [`      <li>Use the wallet from a browser profile of its own. In MetaMask:`,
   `      <li>In Rabby: import it with the private key from step 4, then copy something else so the key doesn't stay in the clipboard (and clear your keyboard's clipboard history if it keeps one).</li>
      <li>Or use the wallet from a browser profile of its own. In MetaMask:`],
  ["wallet.js?v=3", "wallet.js?v=4"],
  ["wallet.css?v=3", "wallet.css?v=4"],
]);
editar("index.html", [
  [`A new EVM wallet whose private key is never shown: it is created and encrypted in your browser, and you take away an encrypted file that MetaMask imports.`,
   `A new EVM wallet created and encrypted in your browser: you take away an encrypted file that MetaMask imports, and the private key only shows if you ask for it (to import it into Rabby).`],
]);
const C = path.join(RAIZ, "wallet.css");
let css = fs.readFileSync(C, "utf8");
assert.ok(!css.includes(".wl-clave"), "css ya estaba");
css += `
/* la clave privada, solo si se pide en el paso 4 */
.wl-clave { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
#wlClaveCaja { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
#wlClaveTxt { font: 13.5px/1.5 var(--mono); color: var(--text); background: var(--bg); border: 1px solid var(--fatal); border-radius: 8px; padding: 10px 12px; word-break: break-all; }
`;
fs.writeFileSync(C, css);
console.log("ok");
