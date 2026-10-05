/* Pestaña 9 (5-oct-2026): abajo del todo, el bloque "pool solo con USDC" para que GMGN enseñe la imagen y las redes del
   $OLIG sin que nadie pueda comprarlo. El dueño: "eso lo pones en la pagina 9 abajo del todo para que con cualquier wallet yo
   añada 2-5 usdc a ver si sale la metadata con eso". olig.js?v=8. node tools/aplicar-olig-pool-usdc.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.html");
let s = fs.readFileSync(F, "utf8");
assert.ok(!s.includes('id="oligPoolBtn"'), "ya estaba");
const fin = `      <p>Verify it on Sourcify and the Arc explorers, then put its address in the pinned tweet as the only official contract. Burns and fees on buys and sells will live in the pool's hook, not in the token.</p>
    </div>
  </div>
</section>`;
assert.strictEqual(s.split(fin).length, 2, "ancla final de la pestaña 9");
s = s.replace(fin, () => `      <p>Verify it on Sourcify and the Arc explorers, then put its address in the pinned tweet as the only official contract. Burns and fees on buys and sells will live in the pool's hook, not in the token.</p>
    </div>
  </div>

  <h2>Show it on GMGN now: a pool with USDC only</h2>
  <p class="lede">The official ARC token shows its picture on GMGN without anyone being able to buy it: it has pools that hold no ARC. This does the same for $OLIG: a Uniswap V4 OLIG/USDC pool (1 %, no hook) with a few USDC just below the price and <b>no OLIG at all</b>, so nobody can buy. Any wallet with USDC on Arc can sign it; it doesn't need to hold OLIG. The launch pool will be a different one (with the OligArc hook), and these USDC can be taken back any time with the position, which stays in the wallet that signs.</p>
  <div class="cols">
    <div class="col-form">
      <label class="field"><span>USDC to put in</span><input type="text" inputmode="decimal" id="oligPoolUsdc" value="2"><small>2 to 5 is plenty. Keep a little more in the wallet for gas.</small></label>
      <label class="field"><span>Starting market cap, in $ (only if the pool doesn't exist yet)</span><input type="text" inputmode="decimal" id="oligPoolMc" value="1000000"><small>It sets the price GMGN will show. Nobody can buy at it: there is no OLIG in the pool.</small></label>
      <button id="oligPoolBtn" class="btn btn-primary" type="button">Open the pool with USDC only</button>
      <p id="oligPoolMsg" class="olig-msg" aria-live="polite"></p>
    </div>
    <div class="col-side">
      <h3>What you sign</h3>
      <p>Up to three things in your wallet's window: let Permit2 move this USDC, let the position manager draw on it for 30 days, then open the pool and add the USDC. Each is checked on Arc before it's asked for.</p>
      <div id="oligPoolOut"></div>
    </div>
  </div>
</section>`);
assert.strictEqual(s.split('src="olig.js?v=7"').length, 2, "ancla olig.js?v=7");
s = s.replace('src="olig.js?v=7"', 'src="olig.js?v=8"');
fs.writeFileSync(F, s);
console.log("ok");
