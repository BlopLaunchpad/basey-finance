/* PESTAÑA 9 · OLIGARC ($OLIG) — 4-oct-2026.
   El dueño: *"me haces una pestaña especial para darle no mas a un boton y creo el token; lo suyo es crear el token con la
   misma wallet que recibe las fees de oligarc"*. Un boton despliega contratos-olig/src/Oligarc.sol (1.000.000.000 OLIG
   fijos, todos a quien lo despliega; sin dueño, sin acuñar, sin pausa, sin lista negra, sin comisiones; quemable y con
   permit) desde la wallet de las comisiones de OligArc. Firma SIEMPRE la wallet del dueño; esta pagina no guarda claves.
   - El bytecode es EXACTAMENTE el que compilo y probo forge (olig-codigo.js, generado por tools/compilar-olig.mjs).
   - Antes de pedir la firma: red Arc (5042), la cuenta NO es la de las comisiones (5-oct: el dueño lo crea desde una wallet
     nueva solo para el token y la guarda hasta el airdrop; la de comisiones solo con casilla explicita), y una estimacion de
     gas en la cadena (si el despliegue fuese a fallar, falla aqui y no se firma nada).
   - Contra el doble despliegue: el hash se guarda en cuanto se envia (basey.olig); si ya hay uno, el boton exige marcar
     "desplegar otro"; si la respuesta se perdio, al abrir la pestaña se busca el recibo y se recupera la direccion.
   - No toca nada del resto del launcher: su propio proveedor de lectura (rpc.mainnet.arc.io). */
import { OLIG_BYTECODE, OLIG_BYTECODE_MD5, OLIG_SOLC, OLIG_ABI } from "./olig-codigo.js?v=2";

const FEE_WALLET = "0xf8ebf867ae58179c85b1e158321efb18c3dad0d5";
const ARC = { id: 5042, hex: "0x13b2", rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io" };
const CLAVE = "basey.olig";
const $ = (id) => document.getElementById(id);
const corto = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || "null"); } catch (e) { return null; } };
const guardar = (o) => { try { localStorage.setItem(CLAVE, JSON.stringify(o)); } catch (e) { /* modo privado */ } };
let lectura = null;
const lector = () => (lectura = lectura || new window.ethers.JsonRpcProvider(ARC.rpc, ARC.id, { staticNetwork: true }));

function aviso(texto, tipo) { const el = $("oligMsg"); if (!el) return; el.textContent = texto || ""; el.dataset.kind = tipo || ""; }
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

async function pintar() {
  const g = leer();
  const out = $("oligOut");
  $("oligDeNuevoL").hidden = !(g && (g.address || g.tx));
  $("oligBtn").textContent = g && g.address ? "Create another $OLIG (not needed)" : "Create Oligarc ($OLIG)";
  if (!g || (!g.address && !g.tx)) { out.innerHTML = "<p>Not deployed yet.</p>"; return; }
  // una respuesta perdida: el hash esta, la direccion no -> se busca el recibo
  if (g.tx && !g.address) {
    try {
      const rc = await lector().getTransactionReceipt(g.tx);
      if (rc && rc.status === 1 && rc.contractAddress) { g.address = rc.contractAddress; g.block = rc.blockNumber; guardar(g); }
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
      extra = "<li>" + img + "Picture and links inside the contract: " + esc(j.website || "") + " · " + esc(j.twitter || "") + "</li><li>owner() = " + esc(own) + "</li>";
    } catch (e) { extra = "<li>This contract has no picture or links inside (an older build).</li>"; }
    const f = (x) => Number(window.ethers.formatUnits(x, d)).toLocaleString("en-US");
    datos = "<li><b>" + esc(n) + "</b> · " + esc(s) + " · " + d + " decimals</li><li>Supply " + f(t) + "</li><li>" + esc(corto(quien)) + " (the wallet that created it) holds " + f(b) + "</li>" + extra;
  } catch (e) { datos = "<li>Couldn't read the contract right now.</li>"; }
  out.innerHTML = '<p class="olig-addr">Contract <code>' + esc(g.address) + "</code></p><ul>" + datos + "</ul>" +
    '<p><a href="' + ARC.explorer + "/address/" + esc(g.address) + '" target="_blank" rel="noopener">explorer.arc.io</a> · <a href="https://arc.etherscan.io/address/' + esc(g.address) + '" target="_blank" rel="noopener">arc.etherscan.io</a> · tx <a href="' + ARC.explorer + "/tx/" + esc(g.tx) + '" target="_blank" rel="noopener">' + esc(corto(g.tx)) + "</a></p>";
}

async function desplegar() {
  const btn = $("oligBtn");
  if (btn.disabled) return;
  const eth = window.ethereum;
  if (!eth) { aviso("No browser wallet found. Open this page in the browser (or the wallet app's browser) of the new wallet you made for $OLIG.", "err"); return; }
  const g = leer();
  if (g && (g.address || g.tx) && !$("oligDeNuevo").checked) { aviso("There is already a deployment from this browser (see on the right). Tick the box if you really want a second token.", "err"); return; }
  btn.disabled = true;
  try {
    aviso("Connecting your wallet…");
    const [cuenta] = await eth.request({ method: "eth_requestAccounts" });
    const a = String(cuenta || "").toLowerCase();
    // 5-oct: se crea desde una wallet NUEVA solo para el token; la de comisiones (de uso diario) solo marcando la casilla
    if (a === FEE_WALLET && !$("oligOtra").checked) throw new Error("This is the OligArc fee wallet (" + corto(FEE_WALLET) + "), which is used every day. Connect the new wallet you made just for $OLIG, or tick the box to use the fee wallet anyway.");
    await asegurarArc(eth);
    const prov = new window.ethers.BrowserProvider(eth);
    const firmante = await prov.getSigner();
    aviso("Checking the deployment on Arc (nothing is signed yet)…");
    const gas = await lector().estimateGas({ from: a, data: OLIG_BYTECODE });
    aviso("Confirm the deployment in your wallet's own window. All 1,000,000,000 OLIG go to " + a + ", the wallet that signs (≈ " + gas.toString() + " gas).");
    const tx = await firmante.sendTransaction({ data: OLIG_BYTECODE, gasLimit: (gas * 12n) / 10n });
    guardar({ tx: tx.hash, from: a, at: Date.now() });
    aviso("Sent " + corto(tx.hash) + ". Waiting for Arc…");
    await pintar();
    const rc = await lector().waitForTransaction(tx.hash, 1, 180000);
    if (!rc || rc.status !== 1 || !rc.contractAddress) throw new Error("The deployment didn't go through (status " + (rc ? rc.status : "unknown") + ").");
    guardar({ tx: tx.hash, from: a, address: rc.contractAddress, block: rc.blockNumber, at: Date.now() });
    $("oligDeNuevo").checked = false;
    aviso("Created: Oligarc ($OLIG) at " + rc.contractAddress + ". Next: verify it and put it in the pinned tweet.", "ok");
  } catch (e) {
    const m = e && (e.code === 4001 || e.code === "ACTION_REJECTED") ? "You rejected it in the wallet. Nothing was sent." : (e && (e.shortMessage || e.message)) || String(e);
    aviso(m, "err");
  } finally { btn.disabled = false; await pintar(); }
}

function iniciar() {
  if (!$("oligBtn")) return;
  $("oligSolc").textContent = OLIG_SOLC + " · cancun · md5 " + OLIG_BYTECODE_MD5.slice(0, 10);
  $("oligBtn").addEventListener("click", desplegar);
  pintar();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
