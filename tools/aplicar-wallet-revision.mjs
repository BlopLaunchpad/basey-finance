/* Pestaña 10, tras la revision adversaria (5-oct-2026):
   - index.html: el ethers 6.13.2 de cdnjs con integrity= (SRI), comprobado contra npm via jsdelivr: si cdnjs sirviera otra
     cosa, el navegador no lo ejecuta. Es lo que hacia posible el ataque del mismo origen.
   - index.html: style.css?v=26 -> 27 (a.btn sin subrayado) y el texto de la pestaña 10, sin prometer aislamiento que no hay.
   - style.css: a.btn como boton.
   node tools/aplicar-wallet-revision.mjs */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FI = path.join(RAIZ, "index.html"), FS = path.join(RAIZ, "style.css");
let s = fs.readFileSync(FI, "utf8"), css = fs.readFileSync(FS, "utf8");

// 1) SRI del ethers del launcher
const CDN = "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.2/ethers.umd.min.js";
const NPM = "https://cdn.jsdelivr.net/npm/ethers@6.13.2/dist/ethers.umd.min.js";
const bajar = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + " HTTP " + r.status); return Buffer.from(await r.arrayBuffer()); };
const [a, b] = [await bajar(CDN), await bajar(NPM)];
assert.ok(a.equals(b), "cdnjs y npm sirven ficheros distintos de ethers 6.13.2: no se fija nada");
const sri = "sha384-" + crypto.createHash("sha384").update(a).digest("base64");
console.log("ethers 6.13.2:", a.length, "bytes, igual en cdnjs y npm;", sri);
const viejo = `<script src="${CDN}"></script>`;
assert.strictEqual(s.split(viejo).length, 2, "ancla script ethers");
s = s.replace(viejo, () => `<script src="${CDN}" integrity="${sri}" crossorigin="anonymous"></script>`);

// 2) style.css?v=26 -> 27
assert.strictEqual(s.split("style.css?v=26").length, 2, "ancla style.css?v=26");
s = s.replace("style.css?v=26", "style.css?v=27");
assert.ok(!css.includes("a.btn {"), "a.btn ya estaba");
css += `
/* Pestaña 10 (5-oct-2026): un enlace con pinta de boton no lleva subrayado. */
a.btn { display: inline-block; text-decoration: none; }
`;

// 3) el texto de la pestaña 10
const t0 = s.indexOf('<section class="panel" data-panel="10" hidden>');
const t1 = s.indexOf("</section>", t0);
assert.ok(t0 > 0 && t1 > t0, "panel 10");
s = s.slice(0, t0) + `<section class="panel" data-panel="10" hidden>
  <h2>New wallet</h2>
  <p class="lede">A new EVM wallet whose private key is never shown: it is created and encrypted in your browser, and you take away an encrypted file that MetaMask imports. The generator is a page of its own that can't make network requests and loads nothing from outside.</p>
  <h2>For a wallet that will hold real money</h2>
  <ul class="lede">
    <li><b>Don't open it from here.</b> Open the copy on this computer: the file <code>wallet.html</code> in the launcher's folder (<code>arc-launcher</code>), whose fingerprint is in BASEY.md. The website copy shares its site with this launcher and is downloaded fresh each time; the local file is the one that was reviewed.</li>
    <li>In a Chrome Guest window (no extensions, no saved passwords), with Wi-Fi off once it has loaded.</li>
    <li>Let it make the password (8 words), write it on paper, and check the backup in its step 4 before funding. The address only appears after that check.</li>
    <li>Fund it from your exchange account, not from your other wallets. Then step 9 creates $OLIG from it.</li>
  </ul>
  <p><a class="btn" href="wallet.html" target="_blank" rel="noopener noreferrer">Open the website copy (for tests)</a></p>
` + s.slice(t1);

fs.writeFileSync(FI, s);
fs.writeFileSync(FS, css);
console.log("ok");
