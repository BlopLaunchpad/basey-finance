/* PESTAÑA 9: EL POOL UNISWAP V4 DE UN TOKEN QUE YA EXISTE, ABAJO DEL TODO (5-oct-2026). Ver olig-pool.js.
   index.html: el bloque (token, MC de salida, boton), olig.js?v=6, style.css?v=26. Assert en cada ancla.
   node tools/aplicar-olig-pool.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const F = path.join(RAIZ, "index.html");
let s = fs.readFileSync(F, "utf8");
function cambiar(a, b, q) { assert.strictEqual(s.split(a).length, 2, "ancla: " + q); s = s.replace(a, () => b); }
cambiar("      <p>Verify it on Sourcify and the Arc explorers, then put its address in the pinned tweet as the only official contract. Burns and fees on buys and sells will live in the pool's hook, not in the token.</p>\n    </div>\n  </div>\n</section>\n",
  "      <p>Verify it on Sourcify and the Arc explorers, then put its address in the pinned tweet as the only official contract. Burns and fees on buys and sells will live in the pool's hook, not in the token.</p>\n    </div>\n  </div>\n" +
  "  <div class=\"olig-test olig-pool\">\n" +
  "    <h3>Uniswap V4 pool for a token you hold (for the TEST)</h3>\n" +
  "    <p>Opens a USDC/token pool on Uniswap V4 at 1% (no hook, like the basey pools) at the market cap you choose, and puts all of the token this wallet holds in a sell wall from that price up to 1,000&times;. Nothing in the floor. Three signatures: approve Permit2, let the position manager use it, and one transaction that opens the pool and places the wall. The first buy goes after, from anywhere (GMGN works). Not for $OLIG: its pool opens on the day of the airdrop.</p>\n" +
  "    <div class=\"olig-pool-row\"><label>Token <input id=\"oligPoolToken\" type=\"text\" placeholder=\"0x…\" spellcheck=\"false\" autocomplete=\"off\"></label><label>Opening market cap (USD) <input id=\"oligPoolMc\" type=\"number\" min=\"100\" step=\"100\" value=\"5000\"></label></div>\n" +
  "    <button id=\"oligPoolBtn\" class=\"btn\" type=\"button\">Open the V4 pool and its wall</button>\n" +
  "    <p id=\"oligPoolMsg\" class=\"olig-msg\" aria-live=\"polite\"></p>\n" +
  "    <div id=\"oligPoolOut\"></div>\n" +
  "  </div>\n</section>\n", "bloque pool");
cambiar("<script type=\"module\" src=\"olig.js?v=5\"></script>", "<script type=\"module\" src=\"olig.js?v=6\"></script>", "version olig.js");
cambiar("<link rel=\"stylesheet\" href=\"style.css?v=25\">", "<link rel=\"stylesheet\" href=\"style.css?v=26\">", "version css");
fs.writeFileSync(F, s);
const C = path.join(RAIZ, "style.css");
let c = fs.readFileSync(C, "utf8");
const m = "/* 9 · el pool V4 del TEST, 5-oct-2026 */";
if (!c.includes(m)) { c += `\n${m}\n.olig-pool { margin-top: 18px; }\n.olig-pool-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin: 0 0 12px; }\n.olig-pool-row label { display: grid; gap: 4px; font-size: 14px; }\n.olig-pool-row input { width: 100%; box-sizing: border-box; }\n`; fs.writeFileSync(C, c); }
console.log("pestaña 9: pool V4");
