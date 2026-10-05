/* PESTAÑA 9 · OLIGARC ($OLIG) — 4-oct-2026.
   El dueño: *"me haces una pestaña especial para darle no mas a un boton y creo el token"*. Un boton despliega
   contratos-olig/src/Oligarc.sol (1.000.000.000 OLIG fijos, todos a quien lo despliega; sin dueño, sin acuñar, sin pausa,
   sin lista negra, sin comisiones; quemable y con permit; imagen y enlaces DENTRO del contrato: tokenURI, logo,
   description, y owner() a cero). Firma SIEMPRE la wallet del navegador (window.ethereum), nunca la rapida del launcher;
   esta pagina no guarda claves.
   - El bytecode es EXACTAMENTE el que compilo y probo forge (olig-codigo.js, generado por tools/compilar-olig.mjs).
   - Antes de pedir la firma: red Arc (5042), la cuenta NO es la de las comisiones (5-oct: el dueño lo crea desde una wallet
     nueva solo para el token y la guarda hasta el airdrop; la de comisiones solo con casilla explicita), y una estimacion de
     gas en la cadena (si el despliegue fuese a fallar, falla aqui y no se firma nada).
   - Contra el doble despliegue: el hash se guarda en cuanto se envia (basey.olig); si ya hay uno, el boton exige marcar
     "desplegar otro"; si la respuesta se perdio, al abrir la pestaña se busca el recibo y se recupera la direccion.
   - 5-oct: el TEST (OligTest.sol) y su pool V4 ya hicieron su trabajo (GMGN lee la imagen y las redes del contrato en cuanto
     hay pool) y se quitan de la pestaña, como pidio el dueño. Sus herramientas siguen en tools/ y olig-pool.js.
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
      extra = "<li>" + img + "Picture and links inside the contract: " + [j.website, j.twitter, j.telegram].filter(Boolean).map(esc).join(" · ") + "</li><li>owner() = " + esc(own) + "</li>";
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
    aviso("Created: Oligarc ($OLIG) at " + rc.contractAddress + ". Next: send the address to verify it.", "ok");
  } catch (e) {
    const m = e && (e.code === 4001 || e.code === "ACTION_REJECTED") ? "You rejected it in the wallet. Nothing was sent." : (e && (e.shortMessage || e.message)) || String(e);
    aviso(m, "err");
  } finally { btn.disabled = false; await pintar(); }
}

/* ── 5-oct: EL POOL SOLO CON USDC (olig-pool-usdc.js) Y EL BOTON PARA SACARLO ──────────────────────────────────────────
   El $OLIG ya existe: 0x1438…739f (verificado en Sourcify). Lo firma CUALQUIER wallet con USDC en Arc: no hace falta OLIG.
   La posicion (NFT del PositionManager) se apunta en basey.oligPool; si se pierde, se busca en los ultimos bloques o se
   escribe su numero a mano. */
const OLIG = "0x14385d2f530ba1763ede4fb3e5471275305b739f";
const USDC = "0x3600000000000000000000000000000000000000";
const CLAVE_POOL = "basey.oligPool";
const avisoPool = (t, k) => { const el = $("oligPoolMsg"); if (el) { el.textContent = t || ""; el.dataset.kind = k || ""; } };
const leerPool = () => { try { return JSON.parse(localStorage.getItem(CLAVE_POOL) || "null"); } catch (e) { return null; } };
const guardarPool = (o) => { try { localStorage.setItem(CLAVE_POOL, JSON.stringify(o)); } catch (e) { /* */ } };
const numero = (v) => Number(String(v || "").replace(/[\s,_$]/g, ""));
let P = null; // el modulo, cargado al usarlo
async function modulo() { return (P = P || await import("./olig-pool-usdc.js?v=1")); }
async function cuentaEnArc() {
  const eth = window.ethereum;
  if (!eth) throw new Error("No browser wallet found. Open this page in the browser of the wallet you want to use.");
  const [cuenta] = await eth.request({ method: "eth_requestAccounts" });
  await asegurarArc(eth);
  const firmante = await new window.ethers.BrowserProvider(eth).getSigner();
  return { cuenta: String(cuenta).toLowerCase(), firmante };
}
async function enviar(firmante, de, a, data, que) {
  const gas = await lector().estimateGas({ from: de, to: a, data });
  avisoPool("Confirm in your wallet: " + que + ".");
  const tx = await firmante.sendTransaction({ to: a, data, gasLimit: (gas * 13n) / 10n });
  avisoPool("Sent " + corto(tx.hash) + ". Waiting for Arc…");
  const rc = await lector().waitForTransaction(tx.hash, 1, 180000);
  if (!rc || rc.status !== 1) throw new Error(que + " didn't go through.");
  return rc;
}

async function abrirPool() {
  const btn = $("oligPoolBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const M = await modulo();
    const usdcTxt = numero($("oligPoolUsdc").value), mc = numero($("oligPoolMc").value);
    if (!(usdcTxt >= 0.1 && usdcTxt <= 1000)) throw new Error("Put between 0.1 and 1,000 USDC.");
    const usdc = window.ethers.parseUnits(usdcTxt.toFixed(6), 6);
    const { cuenta, firmante } = await cuentaEnArc();
    const E = window.ethers;
    const erc = new E.Contract(USDC, ["function balanceOf(address) view returns (uint256)"], lector());
    const saldo = await erc.balanceOf(cuenta);
    if (saldo < usdc + E.parseUnits("0.05", 6)) throw new Error("This wallet has " + E.formatUnits(saldo, 6) + " USDC on Arc: it needs what you put in plus a little for gas.");
    const supply = await new E.Contract(OLIG, ["function totalSupply() view returns (uint256)"], lector()).totalSupply();
    const id0 = M.planPoolSoloUsdc({ token: OLIG, supply, mcUsd: mc > 0 ? mc : 1e6, usdc, owner: cuenta }).id;
    const sqrt = await M.sqrtDePool(id0, lector());
    if (!(sqrt > 0n) && !(mc > 0)) throw new Error("Type the starting market cap.");
    const plan = M.planPoolSoloUsdc({ token: OLIG, supply, mcUsd: mc, usdc, owner: cuenta, sqrtActual: sqrt });
    avisoPool((plan.abrir ? "Opening the pool at " + Math.round(plan.precio * 1e9).toLocaleString("en-US") + " $ market cap" : "The pool already exists: adding below its price") + ". First, the USDC allowances…");
    const { permit2Steps } = await import("./v4.js?v=1");
    await permit2Steps(E, firmante, USDC, usdc, (t) => avisoPool(t));
    const rc = await enviar(firmante, cuenta, M.V4.positionManager, plan.multicall, plan.abrir ? "open the pool and add the USDC" : "add the USDC");
    const tokenId = M.posicionDelRecibo(rc);
    guardarPool({ tokenId: tokenId != null ? tokenId.toString() : null, owner: cuenta, pool: plan.id, tx: rc.hash, usdc: usdcTxt, at: Date.now() });
    avisoPool("Done: the pool holds " + usdcTxt + " USDC and no OLIG. GMGN usually picks it up within minutes.", "ok");
  } catch (e) {
    avisoPool(e && (e.code === 4001 || e.code === "ACTION_REJECTED") ? "You rejected it in the wallet. Nothing more was sent." : (e && (e.shortMessage || e.message)) || String(e), "err");
  } finally { btn.disabled = false; pintarPool(); }
}

/* Las posiciones de esta wallet en el pool OLIG/USDC: la apuntada, o las que salgan en los ultimos ~200.000 bloques. */
async function buscarPosiciones(cuenta) {
  const g = leerPool(), ids = new Set();
  if (g && g.tokenId && g.owner === cuenta) ids.add(g.tokenId);
  const T = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const cab = await lector().getBlockNumber();
  for (let b = cab; b > cab - 200000 && ids.size < 20; b -= 9000) {
    try {
      const logs = await lector().getLogs({ address: "0x6049c9a0e26405c0985f9e3685c87d0ae917f82b", fromBlock: Math.max(0, b - 8999), toBlock: b,
        topics: [T, "0x" + "0".repeat(64), "0x" + cuenta.slice(2).padStart(64, "0")] });
      for (const l of logs) ids.add(BigInt(l.topics[3]).toString());
    } catch (e) { break; }
  }
  return [...ids];
}
async function pintarPool() {
  const out = $("oligPoolOut"); if (!out) return;
  const g = leerPool();
  out.innerHTML = '<h3>Take the USDC back</h3><p>Empties your position in this pool and sends its USDC (and any OLIG someone sold into it) to the wallet that signs.' +
    (g && g.tokenId ? " Last one from this browser: position #" + esc(g.tokenId) + " (" + esc(corto(g.owner)) + ")." : "") + "</p>" +
    '<label class="field"><span>Position number (optional: empty = find it)</span><input type="text" inputmode="numeric" id="oligPoolId" value="' + esc(g && g.tokenId || "") + '"></label>' +
    '<button id="oligPoolSacar" class="btn" type="button">Take the USDC back</button>';
  $("oligPoolSacar").addEventListener("click", sacarPool);
}
async function sacarPool() {
  const btn = $("oligPoolSacar");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const M = await modulo();
    const E = window.ethers;
    const { cuenta, firmante } = await cuentaEnArc();
    const pm = new E.Contract(M.V4.positionManager, ["function ownerOf(uint256) view returns (address)", "function getPoolAndPositionInfo(uint256) view returns ((address,address,uint24,int24,address) key, uint256 info)", "function getPositionLiquidity(uint256) view returns (uint128)"], lector());
    let ids = String($("oligPoolId").value || "").trim() ? [String($("oligPoolId").value).trim()] : null;
    if (!ids) { avisoPool("Looking for your positions in this pool…"); ids = await buscarPosiciones(cuenta); }
    let hecho = 0;
    for (const id of ids) {
      if (!/^\d+$/.test(id)) throw new Error("The position number is a whole number.");
      const tokenId = BigInt(id);
      const dueño = String(await pm.ownerOf(tokenId)).toLowerCase();
      if (dueño !== cuenta) { if (ids.length === 1) throw new Error("Position #" + id + " belongs to " + corto(dueño) + ", not to the wallet you have connected."); continue; }
      const [key] = await pm.getPoolAndPositionInfo(tokenId);
      if (String(key[0]).toLowerCase() !== OLIG || String(key[1]).toLowerCase() !== USDC) { if (ids.length === 1) throw new Error("Position #" + id + " is not in the OLIG/USDC pool."); continue; }
      const liquidez = await pm.getPositionLiquidity(tokenId);
      if (liquidez === 0n) { if (ids.length === 1) throw new Error("Position #" + id + " is already empty."); continue; }
      const data = M.planRetirar({ tokenId, liquidez, key: { currency0: OLIG, currency1: USDC }, para: cuenta });
      await enviar(firmante, cuenta, M.V4.positionManager, data, "empty position #" + id);
      hecho++;
    }
    if (!hecho) throw new Error("No position of this wallet with USDC in the OLIG/USDC pool was found. Type its number if you know it.");
    avisoPool("Done: the USDC is back in " + corto(cuenta) + ".", "ok");
  } catch (e) {
    avisoPool(e && (e.code === 4001 || e.code === "ACTION_REJECTED") ? "You rejected it in the wallet. Nothing more was sent." : (e && (e.shortMessage || e.message)) || String(e), "err");
  } finally { btn.disabled = false; }
}

function iniciar() {
  if (!$("oligBtn")) return;
  $("oligSolc").textContent = OLIG_SOLC + " · cancun · md5 " + OLIG_BYTECODE_MD5.slice(0, 10);
  $("oligBtn").addEventListener("click", desplegar);
  if ($("oligPoolBtn")) { $("oligPoolBtn").addEventListener("click", abrirPool); pintarPool(); }
  pintar();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
