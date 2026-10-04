/* LA PESTAÑA 9 · OLIGARC ($OLIG) EN index.html Y style.css (4-oct-2026). Ver olig.js. Assert en cada ancla.
     node tools/aplicar-pestana-olig.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = path.join(RAIZ, "index.html"), C = path.join(RAIZ, "style.css"), G = path.join(RAIZ, ".gitignore");
let s = fs.readFileSync(F, "utf8");
const cambiar = (a, b, q) => { assert.strictEqual(s.split(a).length, 2, "ancla: " + q); s = s.replace(a, () => b); };
cambiar(`  <button class="step step-wide" data-step="8"><b>8</b> Our launchpad</button>\n`,
  `  <button class="step step-wide" data-step="8"><b>8</b> Our launchpad</button>\n  <button class="step step-wide" data-step="9"><b>9</b> Oligarc $OLIG</button>\n`, "pestaña");
cambiar(`</main>\n`, `<!-- ───────────────────────── 9 · OLIGARC ($OLIG) ───────────────────────── -->
<section class="panel" data-panel="9" hidden>
  <h2>Oligarc · $OLIG</h2>
  <p class="lede">The OligArc token. One button, signed by the OligArc fee wallet. It can't be traded until we open its pool on the day the airdrop is distributed.</p>
  <div class="cols">
    <div class="col-form">
      <dl class="olig-facts">
        <div><dt>Name</dt><dd>Oligarc</dd></div>
        <div><dt>Ticker</dt><dd>OLIG</dd></div>
        <div><dt>Supply</dt><dd>1,000,000,000, fixed (18 decimals)</dd></div>
        <div><dt>Minted to</dt><dd>the wallet that deploys it: the fee wallet <code>0xF8eB…d0d5</code></dd></div>
        <div><dt>Owner / admin</dt><dd>none — no mint, no pause, no blacklist, no tax</dd></div>
        <div><dt>Extras</dt><dd>holders can burn their own · permit (EIP-2612)</dd></div>
        <div><dt>Compiler</dt><dd id="oligSolc"></dd></div>
      </dl>
      <label class="olig-check"><input type="checkbox" id="oligOtra"> Deploy from another wallet (not recommended)</label>
      <label class="olig-check" id="oligDeNuevoL" hidden><input type="checkbox" id="oligDeNuevo"> It's already deployed: create a second one anyway</label>
      <button id="oligBtn" class="btn btn-primary" type="button">Create Oligarc ($OLIG)</button>
      <p id="oligMsg" class="olig-msg" aria-live="polite"></p>
    </div>
    <div class="col-side">
      <h3>Deployed</h3>
      <div id="oligOut"><p>Not deployed yet.</p></div>
      <h3>Next</h3>
      <p>Verify it on Sourcify and the Arc explorers, then put its address in the pinned tweet as the only official contract. Burns and fees on buys and sells will live in the pool's hook, not in the token.</p>
    </div>
  </div>
</section>

</main>
`, "panel");
cambiar(`<script type="module" src="app.js?v=62"></script>\n`, `<script type="module" src="app.js?v=62"></script>\n<script type="module" src="olig.js?v=1"></script>\n`, "script");
fs.writeFileSync(F, s);
let c = fs.readFileSync(C, "utf8");
const m = "/* 9 · Oligarc ($OLIG), 4-oct-2026 */";
if (!c.includes(m)) { c += `\n${m}\n.olig-facts { display: grid; gap: 8px; margin: 0 0 18px; }\n.olig-facts > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; }\n.olig-facts dt { opacity: 0.65; }\n.olig-facts dd { margin: 0; }\n.olig-check { display: flex; gap: 8px; align-items: center; margin: 0 0 10px; font-size: 14px; }\n.olig-msg { min-height: 22px; margin: 12px 0 0; }\n.olig-msg[data-kind="err"] { color: #ff7a59; }\n.olig-msg[data-kind="ok"] { color: #35d08a; }\n.olig-addr code { word-break: break-all; }\n`; fs.writeFileSync(C, c); }
let g = fs.readFileSync(G, "utf8");
if (!g.includes("contratos-olig/lib/")) { g += "# el token Oligarc: las copias de OpenZeppelin/forge-std y lo compilado no se sirven (4-oct)\ncontratos-olig/lib/\ncontratos-olig/out/\ncontratos-olig/cache/\n"; fs.writeFileSync(G, g); }
console.log("pestaña 9 lista");
