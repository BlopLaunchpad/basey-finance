/* Pestaña 10 (5-oct-2026): el boton "10 New wallet" y su panel en index.html, que manda a wallet.html (pagina aparte, sin
   red). node tools/aplicar-pestana-wallet.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.html");
let s = fs.readFileSync(F, "utf8");
assert.ok(!s.includes('data-step="10"'), "ya estaba");

const boton = '  <button class="step step-wide" data-step="9"><b>9</b> Oligarc $OLIG</button>\n';
assert.strictEqual(s.split(boton).length, 2, "ancla boton 9");
s = s.replace(boton, () => boton + '  <button class="step" data-step="10"><b>10</b> New wallet</button>\n');

const fin = "</section>\n\n</main>";
assert.strictEqual(s.split(fin).length, 2, "ancla fin de main");
s = s.replace(fin, () => `</section>

<!-- ───────────────────────── 10 · NEW WALLET ───────────────────────── -->
<section class="panel" data-panel="10" hidden>
  <h2>New wallet</h2>
  <p class="lede">A new EVM wallet whose private key is never shown: it is created and encrypted in your browser, and you take away an encrypted file (and its address) that MetaMask imports. It opens in a page of its own that loads nothing from outside and can't connect to anything, so none of this launcher's code is in the room while the key exists.</p>
  <p><a class="btn btn-primary" href="wallet.html" target="_blank" rel="noopener noreferrer">Open the wallet generator</a></p>
  <h2>Best done</h2>
  <ul class="lede">
    <li>In a browser profile with no extensions. Once the page has loaded you can even switch Wi-Fi off: it doesn't need the network.</li>
    <li>Two copies of the file in two places, and the password on paper. Check the backup (step 4 of the page) before funding it.</li>
    <li>Fund it from your exchange account, not from your other wallets. Then step 9 creates $OLIG from it.</li>
  </ul>
</section>

</main>`);
fs.writeFileSync(F, s);
console.log("ok");
