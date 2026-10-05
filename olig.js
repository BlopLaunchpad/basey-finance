/* PESTAÑA 9 · OLIGARC ($OLIG) — 4-oct-2026.
   El dueño: *"me haces una pestaña especial para darle no mas a un boton y creo el token; lo suyo es crear el token con la
   misma wallet que recibe las fees de oligarc"*. Un boton despliega contratos-olig/src/Oligarc.sol (1.000.000.000 OLIG
   fijos, todos a quien lo despliega; sin dueño, sin acuñar, sin pausa, sin lista negra, sin comisiones; quemable y con
   permit; imagen y enlaces DENTRO del contrato). Firma SIEMPRE la wallet del navegador (window.ethereum), nunca la rapida
   del launcher; esta pagina no guarda claves.
   - El bytecode es EXACTAMENTE el que compilo y probo forge (olig-codigo.js, generado por tools/compilar-olig.mjs).
   - Antes de pedir la firma: red Arc (5042), la cuenta NO es la de las comisiones (5-oct: el dueño lo crea desde una wallet
     nueva solo para el token y la guarda hasta el airdrop; la de comisiones solo con casilla explicita), y una estimacion de
     gas en la cadena (si el despliegue fuese a fallar, falla aqui y no se firma nada).
   - Contra el doble despliegue: el hash se guarda en cuanto se envia (basey.olig); si ya hay uno, el boton exige marcar
     "desplegar otro"; si la respuesta se perdio, al abrir la pestaña se busca el recibo y se recupera la direccion.
   - 5-oct: "Test first". El dueño: *"primero quiero hacer un token test con redes test e icon test ... para asegurarme que
     las redes y el icon y demas salen"*. El MISMO contrato con nombre TEST, icono y enlaces de prueba (OligTest.sol,
     olig-test-codigo.js), firmado por la wallet que este conectada; se guarda aparte (basey.olig.test) y no bloquea el bueno.
   - No toca nada del resto del launcher: su propio proveedor de lectura (rpc.mainnet.arc.io). */
import { OLIG_BYTECODE, OLIG_BYTECODE_MD5, OLIG_SOLC, OLIG_ABI } from "./olig-codigo.js?v=2";
import { OLIGTEST_BYTECODE } from "./olig-test-codigo.js?v=1";
// 5-oct: el pool Uniswap V4 de un token que ya existe (el TEST), abajo del todo de la pestaña. Ver olig-pool.js
import { planPoolV4, sqrtDePool, V4 } from "./olig-pool.js?v=1";
import { permit2Steps } from "./v4.js?v=1";

const FEE_WALLET = "0xf8ebf867ae58179c85b1e158321efb18c3dad0d5";
const ARC = { id: 5042, hex: "0x13b2", rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io" };
// los dos botones: el TEST (cualquier wallet, sin guardas) y el bueno (wallet nueva, una sola vez)
const MODOS = {
  real: { clave: "basey.olig", bytecode: OLIG_BYTECODE, btn: "oligBtn", msg: "oligMsg", out: "oligOut", nombre: "Oligarc ($OLIG)", simbolo: "OLIG" },
  test: { clave: "basey.olig.test", bytecode: OLIGTEST_BYTECODE, btn: "oligTestBtn", msg: "oligTestMsg", out: "oligTestOut", nombre: "TEST", simbolo: "TEST" },
};
const $ = (id) => document.getElementById(id);
const corto = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const leer = (m) => { try { return JSON.parse(localStorage.getItem(m.clave) || "null"); } catch (e) { return null; } };
const guardar = (m, o) => { try { localStorage.setItem(m.clave, JSON.stringify(o)); } catch (e) { /* modo privado */ } };
let lectura = null;
const lector = () => (lectura = lectura || new window.ethers.JsonRpcProvider(ARC.rpc, ARC.id, { staticNetwork: true }));

function aviso(m, texto, tipo) { const el = $(m.msg); if (!el) return; el.textContent = texto || ""; el.dataset.kind = tipo || ""; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function asegurarArc(eth) {
  const actual = await eth.request({ method: "eth_chainId" });
  if (parseInt(actual, 16) === ARC.id) return;
  try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC.hex }] }); }
  catch (e) {
    if (e && (e.code === 4902 || /unrecognized|not been added|unknown chain/i.test(String(e.message)))) {
      await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC.hex, chainName: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: [ARC.rpc], blockExplorerUrls: [ARC.explorer] }] });
    } else throw e;
  }
  if (parseInt(await eth.request({ method: "eth_chainId" }), 16) !== ARC.id) throw new Error("Your wallet is still on another network. Switch it to Arc and try again.");
}

async function pintar(m) {
  const g = leer(m);
  const out = $(m.out);
  if (!out) return;
  if (m === MODOS.real) {
    $("oligDeNuevoL").hidden = !(g && (g.address || g.tx));
    $("oligBtn").textContent = g && g.address ? "Create another $OLIG (not needed)" : "Create Oligarc ($OLIG)";
  }
  if (!g || (!g.address && !g.tx)) { out.innerHTML = m === MODOS.real ? "<p>Not deployed yet.</p>" : ""; return; }
  // una respuesta perdida: el hash esta, la direccion no -> se busca el recibo
  if (g.tx && !g.address) {
    try {
      const rc = await lector().getTransactionReceipt(g.tx);
      if (rc && rc.status === 1 && rc.contractAddress) { g.address = rc.contractAddress; g.block = rc.blockNumber; guardar(m, g); }
      else if (rc && rc.status === 0) { out.innerHTML = '<p>The deployment transaction <code>' + esc(corto(g.tx)) + "</code> failed on-chain. Nothing was created.</p>"; return; }
      else { out.innerHTML = '<p>Sent <code>' + esc(corto(g.tx)) + "</code>, waiting for the chain…</p>"; return; }
    } catch (e) { out.innerHTML = "<p>Sent <code>" + esc(corto(g.tx)) + "</code>. Couldn't read its receipt right now.</p>"; return; }
  }
  let datos = "";
  try {
    const c = new window.ethers.Contract(g.address, OLIG_ABI, lector());
    const quien = /^0x[0-9a-f]{40}$/.test(String(g.from || "")) ? g.from : FEE_WALLET; // la que lo desplego (5-oct: una wallet nueva solo para el token)
    const [n, s, d, t, b] = await Promise.all([c.name(), c.symbol(), c.decimals(), c.totalSupply(), c.balanceOf(quien)]);
    // lo que leen GMGN y compañia (4-oct): el icono y los enlaces van dentro del contrato; owner() contesta cero
    let extra = "";
    try {
      const [logo, uri, own] = await Promise.all([c.logo(), c.tokenURI(), c.owner()]);
      const j = JSON.parse(atob(String(uri).replace(/^data:application\/json;base64,/, "")));
      const img = /^data:image\/(webp|png);base64,[A-Za-z0-9+/=]+$/.test(logo) ? '<img src="' + logo + '" alt="" width="40" height="40" style="border-radius:50%;vertical-align:middle;margin-right:8px">' : "";
      extra = "<li>" + img + "Picture and links inside the contract: " + [j.website, j.twitter, j.telegram].filter(Boolean).map(esc).join(" · ") + "</li><li>owner() = " + esc(own) + "</li>";
    } catch (e) { extra = "<li>This contract has no picture or links inside (an older build).</li>"; }
    const f = (x) => Number(window.ethers.formatUnits(x, d)).toLocaleString("en-US");
    datos = "<li><b>" + esc(n) + "</b> · " + esc(s) + " · " + d + " decimals</li><li>Supply " + f(t) + "</li><li>" + esc(corto(quien)) + " (the wallet that created it) holds " + f(b) + "</li>" + extra;
  } catch (e) { datos = "<li>Couldn't read the contract right now.</li>"; }
  out.innerHTML = '<p class="olig-addr">' + (m === MODOS.test ? "TEST contract " : "Contract ") + "<code>" + esc(g.address) + "</code></p><ul>" + datos + "</ul>" +
    (m === MODOS.test ? "<p>Search this address on GMGN to check the picture and links.</p>" : "") +
    '<p><a href="' + ARC.explorer + "/address/" + esc(g.address) + '" target="_blank" rel="noopener">explorer.arc.io</a> · <a href="https://arc.etherscan.io/address/' + esc(g.address) + '" target="_blank" rel="noopener">arc.etherscan.io</a> · tx <a href="' + ARC.explorer + "/tx/" + esc(g.tx) + '" target="_blank" rel="noopener">' + esc(corto(g.tx)) + "</a></p>";
}

async function desplegar(m) {
  const btn = $(m.btn);
  if (btn.disabled) return;
  const eth = window.ethereum;
  if (!eth) { aviso(m, "No browser wallet found. Open this page in the browser (or the wallet app's browser) of the wallet that should sign.", "err"); return; }
  const real = m === MODOS.real;
  const g = leer(m);
  if (real && g && (g.address || g.tx) && !$("oligDeNuevo").checked) { aviso(m, "There is already a deployment from this browser (see on the right). Tick the box if you really want a second token.", "err"); return; }
  btn.disabled = true;
  try {
    aviso(m, "Connecting your wallet…");
    const [cuenta] = await eth.request({ method: "eth_requestAccounts" });
    const a = String(cuenta || "").toLowerCase();
    // 5-oct: el bueno se crea desde una wallet NUEVA solo para el token; la de comisiones (de uso diario) solo marcando la casilla
    if (real && a === FEE_WALLET && !$("oligOtra").checked) throw new Error("This is the OligArc fee wallet (" + corto(FEE_WALLET) + "), which is used every day. Connect the new wallet you made just for $OLIG, or tick the box to use the fee wallet anyway.");
    await asegurarArc(eth);
    const prov = new window.ethers.BrowserProvider(eth);
    const firmante = await prov.getSigner();
    aviso(m, "Checking the deployment on Arc (nothing is signed yet)…");
    const gas = await lector().estimateGas({ from: a, data: m.bytecode });
    aviso(m, "Confirm the deployment in your wallet's own window. All 1,000,000,000 " + m.simbolo + " go to " + a + ", the wallet that signs (≈ " + gas.toString() + " gas).");
    const tx = await firmante.sendTransaction({ data: m.bytecode, gasLimit: (gas * 12n) / 10n });
    guardar(m, { tx: tx.hash, from: a, at: Date.now() });
    aviso(m, "Sent " + corto(tx.hash) + ". Waiting for Arc…");
    await pintar(m);
    const rc = await lector().waitForTransaction(tx.hash, 1, 180000);
    if (!rc || rc.status !== 1 || !rc.contractAddress) throw new Error("The deployment didn't go through (status " + (rc ? rc.status : "unknown") + ").");
    guardar(m, { tx: tx.hash, from: a, address: rc.contractAddress, block: rc.blockNumber, at: Date.now() });
    if (real) $("oligDeNuevo").checked = false;
    aviso(m, real ? "Created: Oligarc ($OLIG) at " + rc.contractAddress + ". Next: verify it." : "TEST created at " + rc.contractAddress + ". Look it up on GMGN; when the picture and links show, create the real one below.", "ok");
  } catch (e) {
    const msj = e && (e.code === 4001 || e.code === "ACTION_REJECTED") ? "You rejected it in the wallet. Nothing was sent." : (e && (e.shortMessage || e.message)) || String(e);
    aviso(m, msj, "err");
  } finally { btn.disabled = false; await pintar(m); }
}

/* El pool V4 (5-oct): tres firmas de la wallet del navegador, que es la que tiene el token. Nunca el del $OLIG de verdad. */
async function abrirPool() {
  const btn = $("oligPoolBtn");
  if (!btn || btn.disabled) return;
  const msg = (t, k) => { const el = $("oligPoolMsg"); if (el) { el.textContent = t || ""; el.dataset.kind = k || ""; } };
  const eth = window.ethereum;
  if (!eth) { msg("No browser wallet found. Open this page in the browser of the wallet that holds the token.", "err"); return; }
  const token = String($("oligPoolToken").value || "").trim();
  const mc = Number($("oligPoolMc").value);
  btn.disabled = true;
  try {
    if (!window.ethers.isAddress(token)) throw new Error("Paste the token address.");
    const real = leer(MODOS.real);
    if (real && real.address && real.address.toLowerCase() === token.toLowerCase()) throw new Error("That is $OLIG. Its pool opens on the day of the airdrop, not from here.");
    msg("Connecting your wallet…");
    const [cuenta] = await eth.request({ method: "eth_requestAccounts" });
    const a = String(cuenta || "").toLowerCase();
    await asegurarArc(eth);
    const erc = new window.ethers.Contract(token, ["function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"], lector());
    const [dec, sup, bal, sym] = await Promise.all([erc.decimals(), erc.totalSupply(), erc.balanceOf(a), erc.symbol()]);
    const plan = planPoolV4({ token, decimals: dec, supply: sup, mcUsd: mc, wallTokens: bal, owner: a });
    if ((await sqrtDePool(plan.id, lector())) !== 0n) throw new Error("This pool already exists on Uniswap V4. Nothing was signed.");
    const cuanto = Number(window.ethers.formatUnits(bal, dec)).toLocaleString("en-US");
    const firmante = await new window.ethers.BrowserProvider(eth).getSigner();
    msg("Signatures 1 and 2 of 3: Permit2 for " + sym + "…");
    await permit2Steps(window.ethers, firmante, token, bal, (t) => msg(t));
    msg("Signature 3 of 3: open the pool at $" + mc.toLocaleString("en-US") + " market cap and place the wall with " + cuanto + " " + sym + "…");
    const tx = await firmante.sendTransaction({ to: V4.positionManager, data: plan.multicall });
    msg("Sent " + corto(tx.hash) + ". Waiting for Arc…");
    const rc = await lector().waitForTransaction(tx.hash, 1, 180000);
    if (!rc || rc.status !== 1) throw new Error("The pool transaction didn't go through (status " + (rc ? rc.status : "unknown") + ").");
    try { localStorage.setItem("basey.olig.pool", JSON.stringify({ token, id: plan.id, tx: tx.hash, mc, at: Date.now() })); } catch (e) { /* modo privado */ }
    $("oligPoolOut").innerHTML = "<p>V4 pool <code>" + esc(plan.id.slice(0, 18)) + "…</code> open at $" + esc(mc.toLocaleString("en-US")) + " market cap, wall of " + esc(cuanto) + " " + esc(sym) +
      ' · tx <a href="' + ARC.explorer + "/tx/" + esc(tx.hash) + '" target="_blank" rel="noopener">' + esc(corto(tx.hash)) + '</a> · <a href="https://gmgn.ai/arc/token/' + esc(token) + '" target="_blank" rel="noopener">GMGN</a></p>';
    msg("Pool open with its wall. Buy a little on GMGN to start it, then check the picture and links.", "ok");
  } catch (e) {
    msg(e && (e.code === 4001 || e.code === "ACTION_REJECTED") ? "You rejected it in the wallet. Nothing more was sent." : (e && (e.shortMessage || e.message)) || String(e), "err");
  } finally { btn.disabled = false; }
}

function iniciar() {
  if (!$("oligBtn")) return;
  if ($("oligPoolBtn")) {
    $("oligPoolBtn").addEventListener("click", abrirPool);
    const t = leer(MODOS.test);
    if (t && t.address && !$("oligPoolToken").value) $("oligPoolToken").value = t.address;
  }
  $("oligSolc").textContent = OLIG_SOLC + " · cancun · md5 " + OLIG_BYTECODE_MD5.slice(0, 10);
  $("oligBtn").addEventListener("click", () => desplegar(MODOS.real));
  if ($("oligTestBtn")) $("oligTestBtn").addEventListener("click", () => desplegar(MODOS.test));
  pintar(MODOS.real);
  pintar(MODOS.test);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
