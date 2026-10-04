/* PESTAÑA 9 CON EL TOKEN NUEVO: IMAGEN Y ENLACES DENTRO DEL CONTRATO (4-oct-2026, tarde). Ver tools/generar-olig-sol.mjs.
   - olig.js importa el bytecode nuevo (olig-codigo.js?v=2) y, ya creado, enseña el icono leido del propio contrato
     (logo()), los enlaces del JSON de tokenURI() y owner().
   - La ficha del panel dice que la imagen y los enlaces van dentro, y que owner() contesta cero.
   - index.html: olig.js?v=3.
   Assert en cada ancla. node tools/aplicar-olig-metadata.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {};
const leer = (n) => (files[n] = files[n] != null ? files[n] : fs.readFileSync(path.join(RAIZ, n), "utf8"));
function cambiar(n, a, b, q) { const s = leer(n); assert.strictEqual(s.split(a).length, 2, n + " ancla: " + q); files[n] = s.replace(a, () => b); }

cambiar("olig.js", "import { OLIG_BYTECODE, OLIG_BYTECODE_MD5, OLIG_SOLC, OLIG_ABI } from \"./olig-codigo.js?v=1\";",
  "import { OLIG_BYTECODE, OLIG_BYTECODE_MD5, OLIG_SOLC, OLIG_ABI } from \"./olig-codigo.js?v=2\";", "import");
cambiar("olig.js", "    const [n, s, d, t, b] = await Promise.all([c.name(), c.symbol(), c.decimals(), c.totalSupply(), c.balanceOf(FEE_WALLET)]);\n",
  "    const [n, s, d, t, b] = await Promise.all([c.name(), c.symbol(), c.decimals(), c.totalSupply(), c.balanceOf(FEE_WALLET)]);\n" +
  "    // lo que leen GMGN y compañia (4-oct): el icono y los enlaces van dentro del contrato; owner() contesta cero\n" +
  "    let extra = \"\";\n" +
  "    try {\n" +
  "      const [logo, uri, own] = await Promise.all([c.logo(), c.tokenURI(), c.owner()]);\n" +
  "      const j = JSON.parse(atob(String(uri).replace(/^data:application\\/json;base64,/, \"\")));\n" +
  "      const img = /^data:image\\/(webp|png);base64,[A-Za-z0-9+/=]+$/.test(logo) ? '<img src=\"' + logo + '\" alt=\"\" width=\"40\" height=\"40\" style=\"border-radius:50%;vertical-align:middle;margin-right:8px\">' : \"\";\n" +
  "      extra = \"<li>\" + img + \"Picture and links inside the contract: \" + esc(j.website || \"\") + \" · \" + esc(j.twitter || \"\") + \"</li><li>owner() = \" + esc(own) + \"</li>\";\n" +
  "    } catch (e) { extra = \"<li>This contract has no picture or links inside (an older build).</li>\"; }\n", "leer metadata");
cambiar("olig.js", "    datos = \"<li><b>\" + esc(n) + \"</b> · \" + esc(s) + \" · \" + d + \" decimals</li><li>Supply \" + f(t) + \"</li><li>Fee wallet holds \" + f(b) + \"</li>\";\n",
  "    datos = \"<li><b>\" + esc(n) + \"</b> · \" + esc(s) + \" · \" + d + \" decimals</li><li>Supply \" + f(t) + \"</li><li>Fee wallet holds \" + f(b) + \"</li>\" + extra;\n", "mostrar metadata");
cambiar("index.html", "        <div><dt>Owner / admin</dt><dd>none — no mint, no pause, no blacklist, no tax</dd></div>\n",
  "        <div><dt>Owner / admin</dt><dd>none — no mint, no pause, no blacklist, no tax; owner() answers 0x0 so trackers show it renounced</dd></div>\n" +
  "        <div><dt>Picture &amp; links</dt><dd>inside the contract, like the basey tokens GMGN showed from minute one: the oligarch coin, oligarc.xyz and x.com/oligarcxyz (tokenURI, logo, description)</dd></div>\n", "ficha");
cambiar("index.html", "<script type=\"module\" src=\"olig.js?v=2\"></script>", "<script type=\"module\" src=\"olig.js?v=3\"></script>", "version olig.js");
for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(RAIZ, n), s);
console.log("pestaña 9: token con imagen y enlaces");
