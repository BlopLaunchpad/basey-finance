/* Pestaña 10 (5-oct-2026, el dueño desde el movil): "ponme para poder pegar la clave, que poner 8 palabras con sus barras y
   solo viendo asteriscos es dificil". La frase pasa a ir con espacios, el paso 4 acepta pegar, y los campos de contraseña
   llevan un boton Show para verla. wallet.js?v=3, wallet.css?v=3.
   node tools/aplicar-wallet-pegar.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = path.join(RAIZ, "wallet.html");
let s = fs.readFileSync(F, "utf8");
function cambiar(viejo, nuevo) { assert.strictEqual(s.split(viejo).length, 2, "ancla: " + viejo.slice(0, 60)); s = s.replace(viejo, () => nuevo); }

cambiar(`      <code id="wlFraseTxt"></code>
      <small>Write it on paper now, exactly as shown, with the dashes. You'll type it again in step 4.</small>`,
`      <code id="wlFraseTxt"></code>
      <div class="wl-fila"><button class="btn btn-sm" id="wlFraseCopiar" type="button">Copy</button></div>
      <small>Write it on paper now: 8 words, one space between them. You'll type or paste it again in step 4.</small>`);
const campo = (id, etq, ac) => `<label class="field"><span>${etq}</span><input type="password" id="${id}" autocomplete="${ac}" spellcheck="false"></label>`;
const nuevoCampo = (id, etq) => `<div class="field"><label for="${id}">${etq}</label><div class="wl-pw"><input type="password" id="${id}" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"><button class="btn btn-sm wl-ver" type="button" data-para="${id}" aria-pressed="false">Show</button></div></div>`;
cambiar(campo("wlPass", "Password", "off"), nuevoCampo("wlPass", "Password"));
cambiar(campo("wlPass2", "Repeat it", "off"), nuevoCampo("wlPass2", "Repeat it"));
cambiar(campo("wlPass3", "Password", "off"), nuevoCampo("wlPass3", "Password"));
cambiar(`and <b>type the password from your paper</b> (pasting and autofill are refused here).`,
  `and <b>type or paste the password</b>; press Show to check it letter by letter against your paper.`);
cambiar("wallet.js?v=2", "wallet.js?v=3");
cambiar("wallet.css?v=2", "wallet.css?v=3");
fs.writeFileSync(F, s);

const C = path.join(RAIZ, "wallet.css");
let css = fs.readFileSync(C, "utf8");
assert.ok(!css.includes(".wl-pw"), "css ya estaba");
css += `
/* boton Show junto a cada contraseña, y la fila del Copy de la frase */
.wl .field > label { font-size: 13px; color: var(--text-dim); }
.wl-pw { display: flex; gap: 8px; align-items: stretch; }
.wl-pw input { flex: 1; min-width: 0; }
.wl-pw input[type="text"] { font: 14px var(--mono); color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.wl-fila { display: flex; gap: 8px; }
`;
fs.writeFileSync(C, css);
console.log("ok");
