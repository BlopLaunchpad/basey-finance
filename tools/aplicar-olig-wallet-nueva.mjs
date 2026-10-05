/* PESTAÑA 9: EL $OLIG SE CREA DESDE UNA WALLET NUEVA, SOLO PARA EL TOKEN (5-oct-2026). El dueño: *"puedo crear otra wallet
   especificamente para esto, lanzar el token y guardarlo hasta el airdrop"*. Mejor que la de comisiones, que se usa a diario.
   - Ya no se exige la wallet de comisiones: al reves, si se conecta ESA, se para y pide la nueva (o marcar la casilla).
   - Antes de firmar dice a que direccion van los 1.000.000.000 OLIG.
   - Ya creado, el saldo que se ensena es el de la wallet que lo desplego (no el de la de comisiones).
   - index.html: textos del panel y olig.js?v=4.
   Assert en cada ancla. node tools/aplicar-olig-wallet-nueva.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {};
const leer = (n) => (files[n] = files[n] != null ? files[n] : fs.readFileSync(path.join(RAIZ, n), "utf8"));
function cambiar(n, a, b, q) { const s = leer(n); assert.strictEqual(s.split(a).length, 2, n + " ancla: " + q); files[n] = s.replace(a, () => b); }

cambiar("olig.js", "    const [n, s, d, t, b] = await Promise.all([c.name(), c.symbol(), c.decimals(), c.totalSupply(), c.balanceOf(FEE_WALLET)]);\n",
  "    const quien = /^0x[0-9a-f]{40}$/.test(String(g.from || \"\")) ? g.from : FEE_WALLET; // la que lo desplego (5-oct: una wallet nueva solo para el token)\n" +
  "    const [n, s, d, t, b] = await Promise.all([c.name(), c.symbol(), c.decimals(), c.totalSupply(), c.balanceOf(quien)]);\n", "saldo de quien despliega");
cambiar("olig.js", "\"</li><li>Fee wallet holds \" + f(b) + \"</li>\" + extra;\n",
  "\"</li><li>\" + esc(corto(quien)) + \" (the wallet that created it) holds \" + f(b) + \"</li>\" + extra;\n", "texto saldo");
cambiar("olig.js", "    if (a !== FEE_WALLET && !$(\"oligOtra\").checked) throw new Error(\"This is \" + corto(a) + \". Connect the fee wallet \" + corto(FEE_WALLET) + \" (it receives the 1,000,000,000 OLIG and the fees), or tick 'another wallet'.\");\n",
  "    // 5-oct: se crea desde una wallet NUEVA solo para el token; la de comisiones (de uso diario) solo marcando la casilla\n" +
  "    if (a === FEE_WALLET && !$(\"oligOtra\").checked) throw new Error(\"This is the OligArc fee wallet (\" + corto(FEE_WALLET) + \"), which is used every day. Connect the new wallet you made just for $OLIG, or tick the box to use the fee wallet anyway.\");\n", "comprobacion de wallet");
cambiar("olig.js", "    aviso(\"Confirm the deployment in your wallet's own window, signed by \" + corto(a) + \" (≈ \" + gas.toString() + \" gas).\");\n",
  "    aviso(\"Confirm the deployment in your wallet's own window. All 1,000,000,000 OLIG go to \" + a + \", the wallet that signs (≈ \" + gas.toString() + \" gas).\");\n", "aviso");
cambiar("index.html", "by the wallet you have connected in this browser (the OligArc fee wallet).",
  "by the wallet you have connected in this browser: a new wallet just for $OLIG, kept apart until the airdrop.", "lede");
cambiar("index.html", "        <div><dt>Minted to</dt><dd>the wallet that deploys it: the fee wallet <code>0xF8eB…d0d5</code></dd></div>\n",
  "        <div><dt>Minted to</dt><dd>the wallet that deploys it: a new wallet just for $OLIG (not the fee wallet <code>0xF8eB…d0d5</code>, which is used every day). It needs about 0.1 USDC on Arc for gas.</dd></div>\n", "minted to");
cambiar("index.html", "<input type=\"checkbox\" id=\"oligOtra\"> Deploy from another wallet (not recommended)</label>",
  "<input type=\"checkbox\" id=\"oligOtra\"> Use the OligArc fee wallet anyway (not recommended)</label>", "casilla");
cambiar("index.html", "<script type=\"module\" src=\"olig.js?v=3\"></script>", "<script type=\"module\" src=\"olig.js?v=4\"></script>", "version olig.js");
for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(RAIZ, n), s);
console.log("pestaña 9: wallet nueva solo para el token");
