/* Arc Launcher.
 *
 * Free, and it stops you from nothing. Every transaction is signed by the
 * visitor's own wallet; this page holds no keys and puts no contract of its own
 * in the path of anyone's money — even the liquidity locker is compiled in the
 * browser and deployed by whoever locks. Anything this page does can be done
 * without it, and the source it generates is there to be copied out.
 *
 * Two scars from this project are wired in as hard rules:
 *   - Reads go through the wallet's own provider first, with public RPCs as a
 *     fallback. Reading on one network while signing on another produced a
 *     token that could be bought and not sold, and it took days to find.
 *   - No entry animation uses requestAnimationFrame. Background tabs freeze it
 *     and the element ends up built and invisible. Caught twice in one day.
 */

import { FEATURES, OWNERSHIP, FEE_TIERS, RANGE_PRESETS, ARC, QUOTE, conflictsFor, verdict } from "./token-features.js?v=4";
import { generateSource, powerList, metadataPreview } from "./solidity.js?v=4";
import * as PAD from "./launchpad.js?v=2";
import { derivarMadre, derivarClúster, máximoASacar, reservaDeGas,
         repartir, DISPERSE_SOURCE } from "./wallets.js?v=2";
import { planPorDefecto, resumen as planResumen, avisosDe, precioDe,
         posicionesDe, compraDe, pctDelMuro, MCAP_POR_DEFECTO } from "./plan.js?v=8";
import { COMPRA_ATOMICA_SOURCE } from "./compra-atomica.js?v=1";
import { V4, V4_TIERS, POSM_ABI, STATEVIEW_ABI, poolKey, poolId, liquidityFor,
         encodeMint, permit2Steps, HOOK_NOTE } from "./v4.js?v=1";
import { crearProveedorRotativo, NODOS_ARC } from "./rpc.js?v=2";
import * as MOTOR from "./motor-rutas.js?v=1";

const SOLC = "https://binaries.soliditylang.org/bin/soljson-v0.8.24+commit.e11b9ed9.js";

/* Arc's public nodes are unreliable by the hour — measured at 48% of a day with
 * nothing answering — so no read is tied to one node, and a dead node is
 * skipped, never cached as "the answer". */
/* The list lives in rpc.js since 2026-09-14 (NODOS_ARC), in priority order,
 * beside the measurements that chose it. rawCall below no longer walks a copy
 * of its own: it goes through the provider's order, clocks and penalty box, so
 * a node the provider has just seen hang is not waited on again. Review of
 * 14-sep: with thecusp blocked, every rawCall that met arc-scan's 503 sat out
 * a 12 s timeout on thecusp before reaching the next node. */
/* Measured from a browser on 2026-09-02, which is not the same test as from a
 * server: brc.exchange sends no CORS headers, so a page can never reach it, and
 * ac-rpc.theleak.cx answers 409 "client packet length exceeds 255 buffer" to
 * everything. Both work fine from Node. Leaving them in the list would only buy
 * two guaranteed failures before the real attempt.
 *
 * What is left is thin on purpose, and on a bad hour it is nothing at all --
 * arc-scan serves eth_getCode and refuses eth_call with a 503 for stretches of
 * the day. That is why a connected wallet is always tried first: the wallet has
 * a route to the chain that a public list does not. */

const STORE_KEY = "arcLauncher.tokens.v1";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ── state ──────────────────────────────────────────────────────────── */

const state = {
  name: "My Token", symbol: "MTK", supply: "1000000000", decimals: 18,
  ownership: "keep",
  taxBps: 0, taxCeilingBps: 1000,
  maxSupply: "2000000000", maxTxAmount: "10000000", maxWalletAmount: "20000000",
  sourceEdited: false,
  metaMode: "inline",
  metaImage: "", metaDescription: "", metaWebsite: "", metaTwitter: "", metaTelegram: "",
  metaUri: "", metaMutable: false,
  poolFee: 10000,
  version: "v3",
  hooks: "0x0000000000000000000000000000000000000000",
  range: "full",
};
for (const f of FEATURES) state[f.id] = false;

let provider = null, signer = null, account = null;

/* LA PRINCIPAL Y LA RAPIDA.
 * -----------------------------------------------------------------------
 * `signer` y `account` son la RAPIDA en cuanto se deriva, a proposito: todo
 * el fichero firma con ellos, asi que con una sola sustitucion el sitio entero
 * deja de abrir ventanas. La principal se guarda aparte y solo se usa para lo
 * unico que le toca -- meter dinero.
 *
 * La clave vive aqui, en memoria, y NO se guarda en ningun sitio: ni en
 * localStorage, ni cifrada. Cerrar la pestana la borra y se recupera firmando
 * otra vez. Eso protege del disco; no protege de codigo malicioso en esta
 * misma pagina, y por eso aqui va dinero de trabajo. */
let firmantePrincipal = null, cuentaPrincipal = null;
let rápida = null, claveMadre = null, clúster = [];
let provRPC = null;

/* ── LA RÁPIDA PRINCIPAL TAMBIÉN OPERA, Y VA LA PRIMERA DE LA LISTA ──────
 *
 * Hasta el 8-sep-2026 la rápida sólo repartía y recogía: las que compraban y
 * vendían eran las hijas #0, #1, #2… Pero la rápida es una cartera igual que
 * las demás, con su saldo y su dirección, y no poder comprar con ella obligaba
 * a mandarse el dinero a una hija para hacer lo que ya podías hacer allí.
 *
 * Se le da el índice -1 EN VEZ de meterla dentro de `clúster`, y la diferencia
 * importa: `clúster` es la lista de hijas derivadas por índice, y su longitud
 * es lo que se guarda, lo que se añade y quita, y lo que decide qué dirección
 * es la #3. Meterla dentro habría corrido todos los índices en uno y las
 * carteras de todo el mundo habrían cambiado de nombre — con el dinero en la
 * de antes.
 *
 * Con -1 el clúster no se entera de nada: es sólo una fila más en la pantalla.
 *
 * DÓNDE **NO** ENTRA, y son tres sitios donde mandarse dinero a uno mismo:
 *   - el reparto (`Disperse`), que sale de ella;
 *   - "financiar", que es ella quien paga;
 *   - "devolver a la rápida", que es ella quien recibe.
 * Los tres la filtran a propósito. */
const IDX_MADRE = -1;
const esMadre = (i) => Number(i) === IDX_MADRE;
/* La cartera de una fila de la pantalla. `clúster[-1]` es `undefined`, así que
 * sin esto cualquier acción sobre la principal reventaría con un mensaje que
 * no dice nada. */
function carteraDe(i) { return esMadre(i) ? rápida : clúster[Number(i)]; }
/* Como se llama una fila en los mensajes. "#-1" no le dice nada a nadie. */
const etiquetaFila = (i) => (esMadre(i) ? "main" : "#" + i);

function proveedorRPC() {
  if (!provRPC) {
    /* YA NO SE CASA CON UN NODO.  (14-sep-2026)
     * Esto era `new ethers.JsonRpcProvider(FALLBACK_RPCS[0], ...)`: la rapida,
     * el cluster, el Quoter y los recibos iban SOLO a rpc.arc-scan.org. Ese
     * dia, en pleno pico de volumen, arc-scan contesto HTTP 503 a 28 de 96 de
     * las llamadas que hacen una retirada y una compra, y ethers lo pinta como
     * "server response 503": el "error 500" que no dejaba sacar los 80 de la
     * rapida ni comprar. rawCall ya rotaba y los saldos se veian, por eso
     * parecia puntual. Que se reintenta y que no --sobre todo al enviar-- esta
     * en rpc.js, y probado contra este mismo codigo en tools/test-rpc.mjs. */
    provRPC = crearProveedorRotativo(ethers, NODOS_ARC, { chainId: ARC.chainId });
    /* Arc hace un bloque cada 0,5 s -- medido. El defecto de ethers es 4.000 ms,
     * asi que esperar una confirmacion costaba ocho bloques de no enterarse. */
    provRPC.pollingInterval = 500;
  }
  return provRPC;
}
let metaA = null, metaB = null;

/* ── chain plumbing ─────────────────────────────────────────────────── */

/* Kept for anything that genuinely needs a Provider object. Reads should use
 * callRead instead: it asks the connected wallet first. Without a wallet this
 * used to build a provider pinned to FALLBACK_RPCS[0]; it now hands out the
 * rotating one from rpc.js, so no provider in this file is tied to one node. */
function readProvider() {
  return provider || proveedorRPC();
}

async function rawCall(method, params) {
  if (provider) { try { return await provider.send(method, params); } catch { /* the public nodes next */ } }
  /* Same promise as ever: any error or missing result moves on to the next
   * node, and when none answers the error carries noNode (readToken reads it).
   * What changed is who walks the list -- see leerCrudo in rpc.js. */
  return proveedorRPC().leerCrudo(method, params);
}

/* Every read goes through here, so every read gets the wallet-then-rotate
 * treatment. Using ethers' own provider for reads looks tidier and quietly
 * pins you to ONE node, which on this chain means being down whenever that one
 * node is. */
async function callRead(to, abi, fn, args = []) {
  const iface = new ethers.Interface(abi);
  const res = await rawCall("eth_call", [{ to, data: iface.encodeFunctionData(fn, args) }, "latest"]);
  if (!res || res === "0x") {
    const e = new Error(fn + "() returned nothing");
    e.empty = true;
    throw e;
  }
  return iface.decodeFunctionResult(fn, res);
}

async function connect() {
  if (!window.ethereum) { alert("No wallet found. Install a browser wallet that supports Arc (chain 5042)."); return; }
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  account = await signer.getAddress();

  const net = await provider.getNetwork();
  const chip = $("#chainChip");
  if (Number(net.chainId) !== ARC.chainId) {
    chip.textContent = "Wrong network · " + net.chainId;
    chip.dataset.ok = "no";
    try { await provider.send("wallet_switchEthereumChain", [{ chainId: "0x" + ARC.chainId.toString(16) }]); location.reload(); return; }
    catch { /* declined; the chip stays red */ }
  } else { chip.textContent = "Arc · 5042"; delete chip.dataset.ok; }

  firmantePrincipal = signer;
  cuentaPrincipal = account;
  $("#connectBtn").textContent = account.slice(0, 6) + "…" + account.slice(-4);

  /* Y AQUI LA RAPIDA TOMA EL RELEVO. Una firma, y a partir de ese momento
   * `signer`/`account` son suyos: el resto del fichero no se entera y deja de
   * abrir ventanas. Si la rechazas, se sigue operando con la principal -- que
   * es peor pero funciona, y dejarte fuera del sitio por no firmar seria
   * cambiar una molestia por una puerta cerrada. */
  try {
    await usarRápida();
  } catch (e) {
    $("#fwFundNote").textContent = readableError(e) + " — signing with your main wallet instead.";
  }

  loadPositions(); refreshBalances(); renderTokenList(); pintarCarteras();
}

function readableError(e) {
  // A bare revert reads as "the network is down" and sends you chasing a ghost.
  const raw = (e && (e.shortMessage || e.reason || e.message)) || String(e);
  if (/user rejected|denied/i.test(raw)) return "you cancelled it in the wallet";
  if (/insufficient funds/i.test(raw)) return "not enough USDC for gas — on Arc the gas token is USDC";
  return raw;
}

/* ── ABIs ───────────────────────────────────────────────────────────── */

const NFPM_ABI = [
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function increaseLiquidity((uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256 amount0, uint256 amount1)",
  "function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  /* Comprobado en el bytecode del position manager de Arc (24.384 bytes):
   * el selector ac9650d8 esta ahi. No es heredado de la documentacion de
   * Uniswap, es este contrato el que lo tiene. */
  "function multicall(bytes[] data) payable returns (bytes[] results)",
];
const ERC20_ABI = [
  "function name() view returns (string)", "function symbol() view returns (string)",
  "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  /* `transfer` faltaba, y hasta el 8-sep no hacia falta: esta pagina COMPRABA
   * y VENDIA (que es `approve` + el Router) pero nunca movia un token de una
   * cartera a otra. El boton de llevarlo a la rapida principal es lo primero
   * que lo necesita, y sin esta linea `c.transfer(...)` no existe -- el fallo
   * no dice "falta en el ABI", dice "is not a function". */
  "function transfer(address,uint256) returns (bool)",
];
const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = ["function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)"];

/* ── token features UI ──────────────────────────────────────────────── */

/* A hover-or-focus "?" that carries the long explanation, so the page can stay
 * short without hiding anything. Keyboard and touch reach it too: it is a real
 * button, and tapping toggles the bubble rather than needing a hover a phone
 * cannot give. */
function qmark(text, label) {
  const wrap = document.createElement("span");
  wrap.className = "qwrap";
  const b = document.createElement("button");
  b.type = "button";
  b.className = "q";
  b.textContent = "?";
  b.setAttribute("aria-label", label ? "More about " + label : "More");
  const bub = document.createElement("span");
  bub.className = "qbub";
  bub.textContent = text;
  bub.hidden = true;

  /* Positioned when it opens, not by CSS. Anchored to the right of the "?" it
   * runs off the left edge for a "?" on the left, and anchoring left just moves
   * the same problem to the other side. Measuring is the only thing that fits
   * on both edges and on a phone. */
  const colocar = () => {
    bub.style.position = "fixed";
    bub.style.top = "auto";
    bub.style.left = "0px";
    const r = b.getBoundingClientRect();
    const ancho = Math.min(300, window.innerWidth - 24);
    bub.style.maxWidth = ancho + "px";
    const w = bub.getBoundingClientRect().width;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(12, Math.min(x, window.innerWidth - w - 12));
    let y = r.bottom + 8;
    const alto = bub.getBoundingClientRect().height;
    // No room below (a "?" near the bottom of a phone screen): flip it above.
    if (y + alto > window.innerHeight - 8) y = Math.max(8, r.top - alto - 8);
    bub.style.left = Math.round(x) + "px";
    bub.style.top = Math.round(y) + "px";
  };
  const abrir = () => { bub.hidden = false; colocar(); };
  const cerrar = () => { bub.hidden = true; };

  b.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    if (bub.hidden) abrir(); else cerrar();
  });
  b.addEventListener("mouseenter", abrir);
  wrap.addEventListener("mouseleave", cerrar);
  b.addEventListener("focus", abrir);
  b.addEventListener("blur", cerrar);
  wrap.append(b, bub);
  return wrap;
}

function extraFieldsFor(id) {
  if (id === "capped") return [{ key: "maxSupply", label: "Hard cap (tokens)" }];
  if (id === "maxTx") return [{ key: "maxTxAmount", label: "Max per transfer" }, { key: "maxWalletAmount", label: "Max per wallet" }];
  if (id === "transferTax") return [{ key: "taxBps", label: "Fee, basis points (100 = 1%)" }, { key: "taxCeilingBps", label: "Ceiling it can never pass" }];
  return [];
}

function renderFeatures() {
  const wrap = $("#featureList");
  wrap.textContent = "";
  for (const f of FEATURES) {
    const el = document.createElement("div");
    el.className = "feat";
    el.dataset.level = f.level;
    el.dataset.on = state[f.id] ? "1" : "0";

    const head = document.createElement("div");
    head.className = "feat-head";
    const dot = document.createElement("span"); dot.className = "feat-dot";
    const nm = document.createElement("span"); nm.className = "feat-name"; nm.textContent = f.name;
    const why = document.createElement("button");
    why.className = "feat-why"; why.type = "button"; why.textContent = "what this means";
    const q = qmark(f.what, f.name);

    const sw = document.createElement("label"); sw.className = "sw";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = !!state[f.id]; cb.setAttribute("aria-label", f.name);
    const knob = document.createElement("span");
    sw.append(cb, knob);
    head.append(dot, nm, q, why, sw);
    el.append(head);

    const body = document.createElement("dl");
    body.className = "feat-body";
    body.hidden = !state[f.id];
    const add = (label, text, cls) => {
      const dt = document.createElement("dt"); dt.textContent = label; if (cls) dt.className = cls;
      const dd = document.createElement("dd"); dd.textContent = text; if (cls) dd.className = "risk";
      body.append(dt, dd);
    };
    add("What it does", f.what);
    add("Why you might want it", f.why);
    add("The risk", f.risk, "riskLabel");
    if (f.buyerSees) add("What a buyer sees", f.buyerSees);
    if (f.extraNote) add("How it is built here", f.extraNote);

    const extras = extraFieldsFor(f.id);
    if (extras.length) {
      const box = document.createElement("div"); box.className = "feat-extra";
      for (const x of extras) {
        const lab = document.createElement("label"); lab.className = "field";
        const sp = document.createElement("span"); sp.textContent = x.label;
        const inp = document.createElement("input");
        inp.type = "text"; inp.inputMode = "numeric"; inp.value = state[x.key];
        inp.addEventListener("input", () => { state[x.key] = inp.value.replace(/[^0-9]/g, "") || "0"; refreshSource(); });
        lab.append(sp, inp); box.append(lab);
      }
      body.append(box);
    }
    el.append(body);

    why.addEventListener("click", () => { body.hidden = !body.hidden; });
    cb.addEventListener("change", () => {
      state[f.id] = cb.checked;
      if (f.id === "mintable" && !cb.checked) state.capped = false;
      renderFeatures(); refreshSource();
    });
    wrap.append(el);
  }
}

function renderOwnership() {
  const box = $("#ownershipBox");
  box.textContent = "";
  for (const o of OWNERSHIP.options) {
    const lab = document.createElement("label"); lab.className = "radio";
    const inp = document.createElement("input");
    inp.type = "radio"; inp.name = "ownership"; inp.value = o.id; inp.checked = state.ownership === o.id;
    const sp = document.createElement("span");
    const b = document.createElement("b"); b.textContent = o.name;
    sp.append(b, document.createTextNode(" — " + o.what), qmark(o.risk, o.name));
    lab.append(inp, sp);
    inp.addEventListener("change", () => { state.ownership = o.id; refreshSource(); });
    box.append(lab);
  }
}

function refreshSource() {
  state.name = $("#fName").value || "My Token";
  state.symbol = $("#fSymbol").value || "MTK";
  state.supply = ($("#fSupply").value || "0").replace(/[^0-9]/g, "") || "0";
  state.decimals = Math.max(0, Math.min(18, Number($("#fDecimals").value) || 0));
  state.metaImage = $("#mImage").value.trim();
  state.metaDescription = $("#mDescription").value.trim();
  state.metaWebsite = $("#mWebsite").value.trim();
  state.metaTwitter = $("#mTwitter").value.trim();
  state.metaTelegram = $("#mTelegram").value.trim();
  state.metaUri = $("#mUri").value.trim();
  state.metaMutable = $("#mMutable").checked;
  renderMetaPreview();

  const v = verdict(state);
  $("#verdict").dataset.level = v.level;
  $("#verdictHead").textContent = v.headline;
  $("#verdictDetail").textContent = v.detail;

  const powers = powerList(state);
  const ul = $("#verdictPowers");
  ul.textContent = ""; ul.hidden = !powers.length;
  for (const p of powers) { const li = document.createElement("li"); li.textContent = "You can " + p + "."; ul.append(li); }

  const cs = conflictsFor(state);
  const cb = $("#conflicts");
  cb.textContent = ""; cb.hidden = !cs.length;
  if (cs.length) {
    const t = document.createElement("div"); t.className = "conflicts-title";
    t.textContent = "What this will actually do";
    cb.append(t);
    for (const c of cs) { const p = document.createElement("p"); p.textContent = c.text; cb.append(p); }
  }

  if (!state.sourceEdited) $("#sourceView").value = generateSource(state);
  $("#sourceTitle").textContent = state.upgradeable ? "Contract source (2 contracts)" : "Contract source";
  // Nothing is ever disabled. The warnings inform; they do not gate.
  $("#deployBtn").disabled = false;
  $("#deployBtn").textContent = state.upgradeable ? "Compile & deploy (token + proxy)" : "Compile & deploy";
}

/* ── compiling ──────────────────────────────────────────────────────── */

let workerUrl = null;
function compilerWorker() {
  if (!workerUrl) {
    const src =
      "self.importScripts(" + JSON.stringify(SOLC) + ");\n" +
      "self.onmessage = function (e) {\n" +
      "  try {\n" +
      "    var compile = self.Module.cwrap('solidity_compile', 'string', ['string', 'number']);\n" +
      "    self.postMessage({ ok: compile(e.data, 0) });\n" +
      "  } catch (err) { self.postMessage({ err: String(err && err.message || err) }); }\n" +
      "};\n" +
      "self.postMessage({ ready: true });\n";
    workerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  }
  return new Worker(workerUrl);
}

function compileAll(source, log) {
  return new Promise((resolve, reject) => {
    log("loading the Solidity compiler (8.9 MB, once per visit)…");
    const w = compilerWorker();
    const timer = setTimeout(() => { w.terminate(); reject(new Error("the compiler did not load")); }, 180000);
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error("compiler failed to load: " + e.message)); };
    w.onmessage = (e) => {
      if (e.data.ready) {
        log("compiler ready, compiling…");
        w.postMessage(JSON.stringify({
          language: "Solidity",
          sources: { "Token.sol": { content: source } },
          settings: {
            optimizer: { enabled: true, runs: 200 }, evmVersion: "paris",
            outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
          },
        }));
        return;
      }
      clearTimeout(timer); w.terminate();
      if (e.data.err) return reject(new Error(e.data.err));
      let out;
      try { out = JSON.parse(e.data.ok); } catch { return reject(new Error("the compiler returned something unreadable")); }
      const errors = (out.errors || []).filter((x) => x.severity === "error");
      if (errors.length) return reject(new Error(errors.map((x) => x.formattedMessage || x.message).join("\n")));
      for (const warn of (out.errors || []).filter((x) => x.severity === "warning")) {
        log("warning: " + (warn.message || "").split("\n")[0]);
      }
      const file = out.contracts && out.contracts["Token.sol"];
      if (!file) return reject(new Error("nothing was compiled"));
      resolve(file);
    };
  });
}

function logger(id) {
  const box = $("#" + id);
  return (msg, cls) => {
    box.hidden = false;
    const row = document.createElement("div");
    const t = document.createElement("span"); t.className = "t";
    const d = new Date();
    t.textContent = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
    const m = document.createElement("span"); if (cls) m.className = cls; m.textContent = msg;
    row.append(t, m); box.append(row); box.scrollTop = box.scrollHeight;
  };
}

/* ── remembering what you made (this browser only) ──────────────────── */

function saved() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return []; }
}
function remember(entry) {
  try {
    const all = saved().filter((x) => x.address.toLowerCase() !== entry.address.toLowerCase());
    all.unshift(entry);
    localStorage.setItem(STORE_KEY, JSON.stringify(all.slice(0, 60)));
  } catch { /* private mode; the token is on chain either way */ }
}

/* ── deploy ─────────────────────────────────────────────────────────── */

async function deployToken() {
  const log = logger("deployLog");
  const btn = $("#deployBtn");
  btn.disabled = true;
  try {
    const source = $("#sourceView").value;
    // Compile first: a syntax error should cost seconds, not a wallet prompt.
    const file = await compileAll(source, log);

    const names = Object.keys(file);
    const proxyName = names.find((n) => /proxy/i.test(n));
    const implName = names.find((n) => n !== proxyName) || names[0];
    const impl = file[implName];
    log("compiled " + implName + ": " + (impl.evm.bytecode.object.length / 2) + " bytes", "ok");

    if (!signer) { log("connect a wallet to deploy it"); await connect(); }
    if (!signer) { log("no wallet connected — it compiled, nothing was deployed"); return; }

    log("waiting for you to confirm…");
    const implC = await new ethers.ContractFactory(impl.abi, "0x" + impl.evm.bytecode.object, signer).deploy();
    await implC.waitForDeployment();
    const implAddr = await implC.getAddress();
    log((proxyName ? "implementation" : "token") + " deployed at " + implAddr, "ok");

    let address = implAddr;
    if (proxyName) {
      const px = file[proxyName];
      const initData = new ethers.Interface(impl.abi).encodeFunctionData("initialize", []);
      log("deploying the proxy and initialising through it…");
      const pxC = await new ethers.ContractFactory(px.abi, "0x" + px.evm.bytecode.object, signer)
        .deploy(implAddr, account, initData);
      await pxC.waitForDeployment();
      address = await pxC.getAddress();
      log("proxy at " + address + " — this is your token's address", "ok");
      log("the admin is you; changeAdmin(0x0) later makes it permanent");
    }

    remember({
      address, symbol: state.symbol, name: state.name,
      decimals: state.decimals, proxy: proxyName ? implAddr : null,
      image: state.metaMode === "inline" ? state.metaImage : "",
      // The ABI is why the card can drive a function nobody wrote a control
      // for -- including one you added yourself by editing the source.
      abi: impl.abi,
      at: new Date().toISOString(),
    });
    $("#poolTokenA").value = address;
    $$(".step").find((s) => s.dataset.step === "1").classList.add("is-done");
    onPairChange();
    renderTokenList();
    goStep(2);
  } catch (e) {
    log(readableError(e), "err");
  } finally { btn.disabled = false; }
}

/* ── maths ──────────────────────────────────────────────────────────── */

const Q96 = 2n ** 96n;
const MIN_TICK = -887272, MAX_TICK = 887272;

function bigSqrt(n) {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
function sortPair(a, b) {
  return a.toLowerCase() < b.toLowerCase() ? { token0: a, token1: b, aIsZero: true } : { token0: b, token1: a, aIsZero: false };
}
/* price is B per A, in whole units. Converted to the pool's raw token1/token0
 * ratio, which flips with the address sort — computed, never assumed. */
function ratioRaw(price, decA, decB, aIsZero) {
  const P = Number(price);
  if (!isFinite(P) || P <= 0) throw new Error("the price has to be a positive number");
  return aIsZero ? P * 10 ** (decB - decA) : (1 / P) * 10 ** (decA - decB);
}
/* LA RAIZ SE SACA EN COMA FLOTANTE Y SOLO DESPUES SE ESCALA.
 *
 * Antes esto hacia BigInt(Math.floor(r * 1e18)), que cuantiza la razon a pasos
 * de 1e-18 ANTES de la raiz. Con un token de 18 decimales contra un USDC de 6,
 * la razon es el precio por 1e-12, asi que ese paso vale una MILLONESIMA DE
 * DOLAR: cualquier precio por debajo caia a cero y la pool revertia.
 *
 * Medido, no supuesto: 420,69 T de supply a 5.000 $ dan 1,19e-11 y salia 0n.
 * Un cuatrillon, igual. Y donde no llegaba a cero, mentia en silencio: mil
 * millones a 5.500 $ abrian un 9,09% por debajo de lo que la tabla habia
 * impreso una linea encima del boton.
 *
 * En coma flotante el exponente es gratis y el error se queda en el ulp del
 * double -- 2^-52 relativo, no doce ordenes de magnitud. La comparacion
 * completa esta en el commit; los cinco supuestos salen a 0,0000%. */
const MIN_SQRT_RATIO = 4295128739n;
const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;
function sqrtPriceX96From(price, decA, decB, aIsZero) {
  const r = ratioRaw(price, decA, decB, aIsZero);
  const raiz = Math.sqrt(r);
  if (!isFinite(raiz) || raiz <= 0) {
    throw new Error("that opening price cannot be represented in a pool \u2014 " +
                    "raise the market cap or lower the supply");
  }
  const sq = BigInt(Math.floor(raiz * 2 ** 96));
  /* Y se comprueba antes de firmar. Un sqrtPriceX96 fuera de rango revierte
   * dentro de TickMath con una 'R' pelada, despues de haber pagado el gas. */
  if (sq < MIN_SQRT_RATIO || sq >= MAX_SQRT_RATIO) {
    throw new Error("that opening price is outside what a Uniswap pool can hold (" +
                    price.toExponential(4) + " \u2192 sqrtPriceX96 " + sq.toString() +
                    ") \u2014 raise the market cap or lower the supply");
  }
  return sq;
}

/* UN MURO NO PUEDE QUEDAR A CABALLO DEL PRECIO.
 *
 * Una posicion solo tiene token0 si el tick actual esta por DEBAJO de su borde
 * inferior, y solo token1 si esta en su borde superior o por encima. Si el
 * rango pisa el precio, la pool exige las dos monedas -- y un muro de venta
 * existe justamente para no poner USDC.
 *
 * SEPARACION_MINIMA = 1.02 se puso para eso, pero 1,02 son 198,036 ticks y una
 * separacion son 200: no llega a un escalon, asi que cuando el precio cae cerca
 * de un multiplo de 200 el redondeo devuelve el borde al mismo tick del precio.
 * Un 1% de los casos, y en ese 1% el muro pide dolares. Esto no lo estima: lo
 * calcula desde el tick real y lo aparta. */
function apartarDelPrecio(lower, upper, tickActual, spacing, soloToken0) {
  if (soloToken0) {
    const min = Math.ceil((tickActual + 1) / spacing) * spacing;
    if (lower < min) lower = min;
    if (upper <= lower) upper = lower + spacing;
  } else {
    const max = Math.floor(tickActual / spacing) * spacing;
    if (upper > max) upper = max;
    if (lower >= upper) lower = upper - spacing;
  }
  return { lower, upper };
}
function tickFromPrice(price, decA, decB, aIsZero) {
  return Math.log(ratioRaw(price, decA, decB, aIsZero)) / Math.log(1.0001);
}
function priceFromTick(tick, decA, decB, aIsZero) {
  const r = Math.pow(1.0001, tick);
  return aIsZero ? r / 10 ** (decB - decA) : 1 / (r / 10 ** (decA - decB));
}
function usable(t, spacing, dir) {
  const r = Math[dir === "up" ? "ceil" : "floor"](t / spacing) * spacing;
  return Math.max(MIN_TICK + (MIN_TICK % spacing ? spacing : 0), Math.min(MAX_TICK - (MAX_TICK % spacing ? spacing : 0), r));
}
function spacingOf(fee) {
  const tabla = state.version === "v4" ? V4_TIERS : FEE_TIERS;
  return (tabla.find((t) => t.fee === fee) || tabla[3]).tickSpacing;
}

/* ── pool step ──────────────────────────────────────────────────────── */

async function readToken(addr) {
  if (!ethers.isAddress(addr)) return null;
  try {
    const [sym] = await callRead(addr, ERC20_ABI, "symbol");
    const [dec] = await callRead(addr, ERC20_ABI, "decimals");
    return { address: ethers.getAddress(addr), symbol: sym, decimals: Number(dec) };
  } catch (e) {
    // Blaming the token for a dead node sends people hunting a bug that is not
    // theirs. Say which of the two it was.
    if (e && e.noNode) return { address: ethers.getAddress(addr), unreachable: true };
    return null;
  }
}

async function onPairChange() {
  const a = $("#poolTokenA").value.trim(), b = $("#poolTokenB").value.trim();
  [metaA, metaB] = await Promise.all([readToken(a), readToken(b)]);
  const describe = (meta, typed) =>
    !typed ? ""
      : !meta ? "does not answer symbol() and decimals() — is it an ERC-20?"
      : meta.unreachable ? "cannot read it: no Arc node is answering right now. Connect a wallet and it will use yours."
      : meta.symbol + " · " + meta.decimals + " decimals";
  $("#poolTokenAInfo").textContent = describe(metaA, a);
  $("#poolTokenBInfo").textContent = describe(metaB, b);
  if (metaA) metaA = metaA.unreachable ? null : metaA;
  if (metaB) metaB = metaB.unreachable ? null : metaB;
  if (metaA && metaB) {
    const s = sortPair(metaA.address, metaB.address);
    $("#priceUnit").textContent = metaB.symbol + " per " + metaA.symbol;
    $("#poolPriceInfo").textContent =
      metaA.symbol + " sorted as token" + (s.aIsZero ? "0" : "1") + ", " +
      metaB.symbol + " as token" + (s.aIsZero ? "1" : "0") + ". The pool stores the price that way round.";
    $("#liqALabel").textContent = metaA.symbol + " amount";
    $("#liqBLabel").textContent = metaB.symbol + " amount";
  }
  refreshBalances(); updateRangeOut();
}

const VERSIONS = [
  {
    id: "v3",
    name: "Uniswap V3",
    what: "A pool is its own contract, and your position is an NFT.",
    like: "The one everything on Arc already understands: 403 of the last 404 pools were built here, and this site's own indexer reads it. If you want your token to show up everywhere without anyone doing anything, this is it.",
  },
  {
    id: "v4",
    name: "Uniswap V4",
    what: "Every pool lives inside one singleton, and a pool can carry a HOOK.",
    like: "A hook is a contract of yours that runs on every swap and every liquidity change — fees that change, trades that get refused, curves that are not constant product. Nothing on V3 can do it. The cost: far fewer things index V4 today, including us, so a V4 pool is close to invisible outside this page for now.",
  },
];

/* Numbers people already have a feel for. The point is not the maths -- any
 * supply works -- it is that "one billion" means nothing until you are told it
 * is what almost every launch picks, and that a quadrillion is the reason some
 * tokens quote at nine zeros after the decimal point. */
const SUPPLIES = [
  { n: "1000000", label: "1M", note: "One million. Every holder's balance stays legible, and the price per token is a real number." },
  { n: "21000000", label: "21M", note: "Bitcoin's number. Scarcity said out loud -- it reads as a statement before anyone looks at the chart." },
  { n: "1000000000", label: "1B", note: "One billion. What almost every launch picks, and what most people's mental arithmetic expects." },
  { n: "420690000000000", label: "420.69T", note: "Pepe's supply, to the digit. A joke that is also a scale: prices land around six zeros after the point." },
  { n: "1000000000000000", label: "1 quadrillion", note: "Shiba's scale. Prices come out with eight or nine leading zeros, which some people love and some charts round to nothing." },
];

function renderSupplyChips() {
  const box = $("#supplyChips");
  box.textContent = "";
  for (const s of SUPPLIES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chipBtn";
    b.textContent = s.label;
    b.title = s.note;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      $("#fSupply").value = s.n;
      refreshSource();
      renderSupplyChips();
    });
    if (String(state.supply) === s.n) b.setAttribute("aria-pressed", "true");
    box.append(b, qmark(s.note, s.label));
  }
}

function renderVersions() {
  const box = $("#versionPick");
  box.textContent = "";
  for (const v of VERSIONS) {
    const lab = document.createElement("label");
    lab.className = "radio";
    const inp = document.createElement("input");
    inp.type = "radio"; inp.name = "uniVersion"; inp.value = v.id; inp.checked = state.version === v.id;
    const sp = document.createElement("span");
    const b = document.createElement("b"); b.textContent = v.name;
    sp.append(b, document.createTextNode(" — " + v.what), qmark(v.like, v.name));
    lab.append(inp, sp);
    inp.addEventListener("change", () => {
      state.version = v.id;
      $("#hooksField").hidden = v.id !== "v4";
      $("#hooksNote").textContent = HOOK_NOTE;
      renderFeeTiers();
      updateRangeOut();
    });
    box.append(lab);
  }
}

function renderFeeTiers() {
  const box = $("#feeTiers");
  box.textContent = "";
  for (const t of (state.version === "v4" ? V4_TIERS : FEE_TIERS)) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "tier"; b.setAttribute("aria-pressed", String(state.poolFee === t.fee));
    const strong = document.createElement("b"); strong.textContent = t.label;
    const small = document.createElement("small"); small.textContent = t.hint;
    b.title = "Tick spacing " + t.tickSpacing + ".";
    b.append(strong, small);
    b.addEventListener("click", () => { state.poolFee = t.fee; renderFeeTiers(); updateRangeOut(); });
    box.append(b);
  }
}

async function createPool() {
  const log = logger("poolLog");
  const btn = $("#createPoolBtn");
  btn.disabled = true;
  try {
    if (!metaA || !metaB) throw new Error("both token addresses have to answer symbol() and decimals()");
    if (metaA.address.toLowerCase() === metaB.address.toLowerCase()) throw new Error("a token cannot be paired with itself");
    if (!signer) { await connect(); if (!signer) return; }
    const s = sortPair(metaA.address, metaB.address);
    const sq = sqrtPriceX96From($("#poolPrice").value, metaA.decimals, metaB.decimals, s.aIsZero);
    log("token0 " + s.token0);
    log("token1 " + s.token1);
    log("sqrtPriceX96 " + sq.toString());
    let tx;
    if (state.version === "v4") {
      const k = v4Key();
      log("hook: " + k.hooks + (k.hooks === ethers.ZeroAddress ? "  (none — a plain pool)" : "  <- your contract runs on every swap"));
      log("poolId " + poolId(k));
      const posm = new ethers.Contract(V4.positionManager, POSM_ABI, signer);
      log("waiting for you to confirm…");
      tx = await posm.initializePool([k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks], sq);
    } else {
      const nfpm = new ethers.Contract(ARC.positionManager, NFPM_ABI, signer);
      log("waiting for you to confirm…");
      tx = await nfpm.createAndInitializePoolIfNecessary(s.token0, s.token1, state.poolFee, sq);
    }
    log("sent: " + tx.hash);
    await tx.wait();
    log("pool ready", "ok");
    $$(".step").find((x) => x.dataset.step === "2").classList.add("is-done");
    updateRangeOut();
    goStep(3);
  } catch (e) { log(readableError(e), "err"); } finally { btn.disabled = false; }
}

function v4Key() {
  return poolKey(metaA.address, metaB.address, state.poolFee, spacingOf(state.poolFee), state.hooks);
}

async function currentTick() {
  if (state.version === "v4") {
    if (!metaA || !metaB) return null;
    try {
      const s0 = await callRead(V4.stateView, STATEVIEW_ABI, "getSlot0", [poolId(v4Key())]);
      if (!s0 || Number(s0[0]) === 0) return null;
      return { tick: Number(s0[1]), sqrt: Number(s0[0]), pool: poolId(v4Key()) };
    } catch { return null; }
  }
  return currentTickV3();
}

async function currentTickV3() {
  if (!metaA || !metaB) return null;
  try {
    const s = sortPair(metaA.address, metaB.address);
    const [pool] = await callRead(ARC.v3Factory, FACTORY_ABI, "getPool", [s.token0, s.token1, state.poolFee]);
    if (!pool || pool === ethers.ZeroAddress) return null;
    const s0 = await callRead(pool, POOL_ABI, "slot0");
    return { tick: Number(s0[1]), pool };
  } catch { return null; }
}

/* ── liquidity step ─────────────────────────────────────────────────── */

const META_MODES = [
  {
    id: "inline",
    name: "Inside the contract",
    what: "The JSON is written into the token itself as a constant.",
    like: "Nothing to keep alive: no gateway, no pin, no domain. It cannot rot and it cannot be taken down. Costs more gas once, at deploy, and then never again.",
  },
  {
    id: "uri",
    name: "A link (IPFS or https)",
    what: "The contract stores only a URI and the JSON lives elsewhere.",
    like: "Cheaper, and how most launchpads do it. Whoever hosts it decides whether it keeps working \u2014 an IPFS pin that lapses or a domain that expires takes the picture with it.",
  },
  {
    id: "none",
    name: "No metadata",
    what: "Just name, symbol and decimals.",
    like: "The token works perfectly and shows as a blank circle everywhere. You can never add it later unless you left the setter in.",
  },
];

function renderMetaModes() {
  const box = $("#metaModes");
  box.textContent = "";
  for (const m of META_MODES) {
    const lab = document.createElement("label");
    lab.className = "radio";
    const inp = document.createElement("input");
    inp.type = "radio"; inp.name = "metaMode"; inp.value = m.id; inp.checked = state.metaMode === m.id;
    const sp = document.createElement("span");
    const b = document.createElement("b"); b.textContent = m.name;
    sp.append(b, document.createTextNode(" \u2014 " + m.what), qmark(m.like, m.name));
    lab.append(inp, sp);
    inp.addEventListener("change", () => { state.metaMode = m.id; syncMeta(); refreshSource(); });
    box.append(lab);
  }
}

function syncMeta() {
  $("#metaInlineFields").hidden = state.metaMode !== "inline";
  $("#metaUriField").hidden = state.metaMode !== "uri";
  $("#metaMutableRow").hidden = state.metaMode === "none";
  $("#metaPreview").hidden = state.metaMode === "none";
}

function renderMetaPreview() {
  const box = $("#metaPreview");
  box.textContent = "";
  if (state.metaMode === "none") return;
  const val = metadataPreview(state) || "";

  const row = document.createElement("div");
  row.className = "metaRow";
  const img = document.createElement("div");
  img.className = "metaImg";
  const src = state.metaMode === "inline" ? state.metaImage : "";
  if (src) {
    const el = document.createElement("img");
    // ipfs:// means nothing to a browser; try a public gateway so the preview
    // shows what an indexer would eventually resolve.
    el.src = src.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + src.slice(7) : src;
    el.alt = "";
    el.addEventListener("error", () => { img.textContent = "image did not load"; img.classList.add("bad"); });
    img.append(el);
  } else {
    img.textContent = state.metaMode === "uri" ? "preview needs the JSON, not the link" : "no image";
  }
  const txt = document.createElement("div");
  txt.className = "metaTxt";
  const t1 = document.createElement("b");
  t1.textContent = (state.name || "?") + " (" + (state.symbol || "?") + ")";
  const t2 = document.createElement("span");
  t2.textContent = state.metaMode === "inline" ? (state.metaDescription || "no description") : (state.metaUri || "no URI set");
  txt.append(t1, t2);
  row.append(img, txt);

  const code = document.createElement("code");
  code.className = "metaJson";
  code.textContent = "metadataURI() \u2192 " + (val.length > 220 ? val.slice(0, 220) + "\u2026" : val || "(empty)");

  const note = document.createElement("div");
  note.className = "metaNote";
  note.textContent = state.metaMode === "inline"
    ? "Adds roughly " + Math.ceil(val.length / 32) * 32 + " bytes to the contract, paid once at deploy."
    : "The contract will store this string and nothing else. Whether it resolves is not checked here.";

  box.append(row, code, note);
}

function renderRangePresets() {
  const box = $("#rangePresets");
  box.textContent = "";
  for (const r of RANGE_PRESETS) {
    const lab = document.createElement("label");
    lab.className = "radio";
    const inp = document.createElement("input");
    inp.type = "radio"; inp.name = "range"; inp.value = r.id; inp.checked = state.range === r.id;
    const sp = document.createElement("span");
    const b = document.createElement("b"); b.textContent = r.name;
    const em2 = document.createElement("em"); em2.className = "needs"; em2.textContent = "Needs: " + r.needs;
    sp.append(b, document.createTextNode(" — " + r.what), qmark(r.like, r.name), em2);
    lab.append(inp, sp);
    inp.addEventListener("change", () => {
      state.range = r.id;
      $("#bandRow").hidden = r.id !== "band";
      $("#tickRow").hidden = r.id !== "manual";
      updateRangeOut();
    });
    box.append(lab);
  }
}

async function ticksForRange() {
  const spacing = spacingOf(state.poolFee);
  const s = metaA && metaB ? sortPair(metaA.address, metaB.address) : null;
  if (state.range === "full") return { lower: usable(MIN_TICK, spacing, "up"), upper: usable(MAX_TICK, spacing, "down") };
  if (state.range === "manual") {
    return { lower: usable(Number($("#tickLower").value) || 0, spacing, "down"), upper: usable(Number($("#tickUpper").value) || 0, spacing, "up") };
  }
  if (state.range === "band") {
    if (!s) throw new Error("set both tokens first");
    const lo = tickFromPrice($("#rangeMin").value, metaA.decimals, metaB.decimals, s.aIsZero);
    const hi = tickFromPrice($("#rangeMax").value, metaA.decimals, metaB.decimals, s.aIsZero);
    return { lower: usable(Math.min(lo, hi), spacing, "down"), upper: usable(Math.max(lo, hi), spacing, "up") };
  }
  // one-sided and single tick need to know where the price is right now
  const cur = await currentTick();
  if (!cur) throw new Error("that pool does not exist yet — create it in step 2 first");
  const t = Math.floor(cur.tick / spacing) * spacing;
  if (state.range === "single") return { lower: t, upper: t + spacing };
  /* A range entirely ABOVE the current tick holds only token0; entirely BELOW,
   * only token1. Which of those is "your token" depends on the address sort, so
   * the side is worked out rather than assumed. */
  const wantA = state.range === "sell";
  const holdsToken0 = wantA ? s.aIsZero : !s.aIsZero;
  return holdsToken0
    ? { lower: t + spacing, upper: usable(MAX_TICK, spacing, "down") }
    : { lower: usable(MIN_TICK, spacing, "up"), upper: t };
}

async function updateRangeOut() {
  const out = $("#rangeOut");
  out.textContent = "";
  if (!metaA || !metaB) { out.textContent = "Set both tokens in step 2 to see what this range does."; return; }
  try {
    const { lower, upper } = await ticksForRange();
    const s = sortPair(metaA.address, metaB.address);
    const cur = await currentTick();
    const lines = [];
    lines.push("Ticks " + lower + " → " + upper + " (spacing " + spacingOf(state.poolFee) + ")");
    if (lower !== usable(MIN_TICK, spacingOf(state.poolFee), "up") || upper !== usable(MAX_TICK, spacingOf(state.poolFee), "down")) {
      const pl = priceFromTick(lower, metaA.decimals, metaB.decimals, s.aIsZero);
      const pu = priceFromTick(upper, metaA.decimals, metaB.decimals, s.aIsZero);
      lines.push("Active between " + Math.min(pl, pu).toExponential(4) + " and " + Math.max(pl, pu).toExponential(4) + " " + metaB.symbol + " per " + metaA.symbol);
    }
    if (cur) {
      const side = upper <= cur.tick ? "entirely below the price — it will hold only " + (s.aIsZero ? metaB.symbol : metaA.symbol)
        : lower >= cur.tick ? "entirely above the price — it will hold only " + (s.aIsZero ? metaA.symbol : metaB.symbol)
        : "spanning the current price — it takes both tokens";
      lines.push("Right now the range sits " + side + ".");
      lines.push("Pool tick is " + cur.tick + ".");
    } else {
      lines.push("No pool at this pair and fee yet.");
    }
    for (const l of lines) { const d = document.createElement("div"); d.textContent = l; out.append(d); }
  } catch (e) { out.textContent = readableError(e); }
}

async function refreshBalances() {
  if (!account) return;
  for (const [meta, elBal, elMax] of [[metaA, "#liqABal", "#liqAMax"], [metaB, "#liqBBal", "#liqBMax"]]) {
    if (!meta) continue;
    try {
      const [b] = await callRead(meta.address, ERC20_ABI, "balanceOf", [account]);
      const human = ethers.formatUnits(b, meta.decimals);
      $(elBal).textContent = "balance " + human + " " + meta.symbol +
        (meta.address.toLowerCase() === QUOTE.address.toLowerCase() ? " — this also pays your gas" : "");
      $(elMax).dataset.value = human;
    } catch { /* a dead node here is cosmetic and must not block the form */ }
  }
}

async function approveIfNeeded(tokenAddr, amount, log, label) {
  const c = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const cur = await c.allowance(account, ARC.positionManager);
  if (cur >= amount) { log(label + ": already approved"); return; }
  log(label + ": approving exactly " + amount.toString() + ", not unlimited…");
  await (await c.approve(ARC.positionManager, amount)).wait();
  log(label + ": approved", "ok");
}

async function addLiquidity() {
  const log = logger("liqLog");
  const btn = $("#addLiqBtn");
  btn.disabled = true;
  try {
    if (!metaA || !metaB) throw new Error("set both tokens in step 2 first");
    if (!signer) { await connect(); if (!signer) return; }
    const s = sortPair(metaA.address, metaB.address);
    const { lower, upper } = await ticksForRange();
    if (lower >= upper) throw new Error("lower tick is not below upper tick — widen the range");
    log("ticks " + lower + " → " + upper);

    const amtA = ethers.parseUnits(($("#liqA").value || "0").trim(), metaA.decimals);
    const amtB = ethers.parseUnits(($("#liqB").value || "0").trim(), metaB.decimals);
    if (amtA <= 0n && amtB <= 0n) throw new Error("enter an amount on at least one side");

    const amount0 = s.aIsZero ? amtA : amtB;
    const amount1 = s.aIsZero ? amtB : amtA;

    if (state.version === "v4") {
      await addLiquidityV4(lower, upper, amount0, amount1, log);
      return;
    }

    if (amount0 > 0n) await approveIfNeeded(s.token0, amount0, log, "token0");
    if (amount1 > 0n) await approveIfNeeded(s.token1, amount1, log, "token1");

    const nfpm = new ethers.Contract(ARC.positionManager, NFPM_ABI, signer);
    log("minting the position…");
    const tx = await nfpm.mint({
      token0: s.token0, token1: s.token1, fee: state.poolFee,
      tickLower: lower, tickUpper: upper,
      amount0Desired: amount0, amount1Desired: amount1,
      /* The pool takes whatever ratio the range allows and leaves the rest in
       * your wallet, so there is nothing to protect against here beyond the
       * price moving between now and the block — which the deadline covers. */
      amount0Min: 0, amount1Min: 0,
      recipient: account, deadline: Math.floor(Date.now() / 1000) + 1800,
    });
    log("sent: " + tx.hash);
    await tx.wait();
    log("liquidity added", "ok");
    $$(".step").find((x) => x.dataset.step === "3").classList.add("is-done");
    loadPositions();
    goStep(5);
  } catch (e) { log(readableError(e), "err"); } finally { btn.disabled = false; }
}

/* ── your tokens: what a contract really has ────────────────────────── */

/* Every function leaves its 4-byte selector in the deployed code. Hash the
 * signature, look for the bytes. A hit is strong evidence it is there; a miss
 * is near-proof it is not — and that is a far better answer than trusting a
 * source listing or a name. */
async function addLiquidityV4(lower, upper, amount0, amount1, log) {
  const k = v4Key();
  const cur = await currentTick();
  if (!cur) throw new Error("that V4 pool has no price yet — initialise it in step 2 first");

  const L = liquidityFor(cur.sqrt, lower, upper, amount0, amount1);
  if (L <= 0n) throw new Error("those amounts buy no liquidity in that range — check which side the range is on");
  log("liquidity " + L.toString() + " at tick " + cur.tick);

  // Permit2 is two approvals per token and the first one is the one people
  // skip: the ERC-20 allowance goes to Permit2, not to the position manager.
  if (amount0 > 0n) await permit2Steps(ethers, signer, k.currency0, amount0, log);
  if (amount1 > 0n) await permit2Steps(ethers, signer, k.currency1, amount1, log);

  const data = encodeMint(k, lower, upper, L, amount0, amount1, account);
  const posm = new ethers.Contract(V4.positionManager, POSM_ABI, signer);
  log("minting the position…");
  const tx = await posm.modifyLiquidities(data, Math.floor(Date.now() / 1000) + 1800);
  log("sent: " + tx.hash);
  await tx.wait();
  log("liquidity added to the V4 pool", "ok");
  log("note: this site does not index V4 yet, so it will not appear on thecusp.io");
  $$(".step").find((x) => x.dataset.step === "3").classList.add("is-done");
}

const PROBE = [
  { sig: "mint(address,uint256)", label: "Mint new supply", level: "danger" },
  { sig: "setPaused(bool)", label: "Pause all transfers", level: "danger" },
  { sig: "pause()", label: "Pause all transfers", level: "danger" },
  { sig: "setBlocked(address,bool)", label: "Block addresses", level: "danger" },
  { sig: "blacklist(address)", label: "Block addresses", level: "danger" },
  { sig: "enableTrading()", label: "Trading switch", level: "danger" },
  { sig: "setLimits(uint256,uint256)", label: "Change transfer/wallet caps", level: "danger" },
  { sig: "setTax(uint16,address)", label: "Change the transfer fee", level: "fatal" },
  { sig: "upgradeTo(address)", label: "Replace the whole contract", level: "fatal" },
  { sig: "changeAdmin(address)", label: "Hand over proxy admin", level: "fatal" },
  { sig: "burn(uint256)", label: "Burn your own tokens", level: "safe" },
  { sig: "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", label: "Gasless approvals", level: "safe" },
  { sig: "renounceOwnership()", label: "Ownership can be dropped", level: "safe" },
  { sig: "transferOwnership(address)", label: "Ownership can be handed over", level: "caution" },
];
const STATE_READS = [
  { sig: "owner()", type: "address", label: "Owner" },
  { sig: "admin()", type: "address", label: "Proxy admin" },
  { sig: "implementation()", type: "address", label: "Implementation" },
  { sig: "paused()", type: "bool", label: "Paused" },
  { sig: "tradingEnabled()", type: "bool", label: "Trading enabled" },
  { sig: "taxBps()", type: "uint256", label: "Transfer fee (bps)" },
  { sig: "maxSupply()", type: "uint256", label: "Hard cap (raw)" },
  { sig: "metadataURI()", type: "string", label: "Metadata" },
];

async function inspect(addr) {
  const code = await rawCall("eth_getCode", [addr, "latest"]);
  if (!code || code === "0x") throw new Error("there is no contract at that address");
  const found = [];
  const seen = new Set();
  for (const p of PROBE) {
    const sel = ethers.id(p.sig).slice(2, 10);
    if (code.includes(sel) && !seen.has(p.label)) { seen.add(p.label); found.push(p); }
  }
  const meta = await readToken(addr);
  const values = [];
  for (const r of STATE_READS) {
    const sel = ethers.id(r.sig).slice(2, 10);
    if (!code.includes(sel)) continue;
    try {
      const res = await rawCall("eth_call", [{ to: addr, data: "0x" + sel }, "latest"]);
      if (!res || res === "0x") continue;
      let v;
      if (r.type === "address") { const a = "0x" + res.slice(26); v = a === ethers.ZeroAddress ? "none (zero address)" : a; }
      else if (r.type === "bool") v = BigInt(res) ? "yes" : "no";
      else if (r.type === "string") {
        const [s] = ethers.AbiCoder.defaultAbiCoder().decode(["string"], res);
        if (!s) continue;
        v = s;
      }
      else v = BigInt(res).toString();
      values.push({ label: r.label, value: v });
    } catch { /* one unreadable getter must not kill the report */ }
  }
  let supply = null;
  if (meta && !meta.unreachable) {
    try { const [ts] = await callRead(addr, ERC20_ABI, "totalSupply"); supply = ethers.formatUnits(ts, meta.decimals); }
    catch { /* optional */ }
  }
  const selectores = new Set();
  for (const c of CONTROLES) {
    const sel = ethers.id(c.sig).slice(2, 10);
    if (code.includes(sel)) selectores.add(sel);
  }
  return { address: ethers.getAddress(addr), code: (code.length - 2) / 2, found, values, meta, supply, selectores };
}

function renderTokenList() {
  const box = $("#tokenList");
  box.textContent = "";
  const list = saved();
  if (!list.length) {
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = "Nothing deployed from this browser yet. You can still inspect any address above.";
    box.append(p);
    return;
  }
  for (const t of list) box.append(tokenCard(t));
}

function tokenCard(t) {
  const el = document.createElement("div"); el.className = "pos";
  const head = document.createElement("div"); head.className = "pos-head";
  const nm = document.createElement("span"); nm.className = "pos-pair";
  nm.textContent = (t.name || "?") + " · " + (t.symbol || "?") + (t.proxy ? "  (proxy)" : "");
  const ad = document.createElement("span"); ad.className = "pos-id"; ad.textContent = t.address;
  head.append(nm, ad);

  const actions = document.createElement("div"); actions.className = "pos-actions";
  const open = document.createElement("button"); open.className = "btn btn-sm"; open.textContent = "What does it do?";
  const usePool = document.createElement("button"); usePool.className = "btn btn-sm"; usePool.textContent = "Use in a pool";
  actions.append(open, usePool);

  const body = document.createElement("div"); body.className = "inspect"; body.hidden = true;
  open.addEventListener("click", async () => {
    if (!body.hidden) { body.hidden = true; return; }
    body.hidden = false; body.textContent = "reading the deployed bytecode…";
    try {
      const info = await inspect(t.address);
      if (t.abi) info.abi = t.abi;
      renderInspect(body, info);
    }
    catch (e) { body.textContent = readableError(e); }
  });
  usePool.addEventListener("click", () => { $("#poolTokenA").value = t.address; onPairChange(); goStep(2); });

  el.append(head, actions, body);
  return el;
}

/* Cada poder detectado, con su mando. Un contrato que TIENE una lista negra y
 * no te deja usarla desde la misma pantalla donde te la ensena es media
 * herramienta. */
const CONTROLES = [
  { sig: "mint(address,uint256)", nombre: "Mint new supply", boton: "Mint",
    campos: [{ k: "to", et: "To address", ph: "0x..." }, { k: "amt", et: "Amount (whole tokens)", ph: "1000" }],
    arma: (v, dec) => ["mint", [v.to, ethers.parseUnits(v.amt || "0", dec)]],
    abi: "function mint(address,uint256)" },

  { sig: "setPaused(bool)", nombre: "Freeze every transfer", boton: "Apply",
    campos: [{ k: "on", et: "Paused", tipo: "bool" }],
    arma: (v) => ["setPaused", [v.on === "true"]],
    abi: "function setPaused(bool)",
    aviso: "While this is on, nobody can sell -- including you." },

  { sig: "setBlocked(address,bool)", nombre: "Block an address", boton: "Apply",
    campos: [{ k: "who", et: "Address", ph: "0x..." }, { k: "on", et: "Blocked", tipo: "bool" }],
    arma: (v) => ["setBlocked", [v.who, v.on === "true"]],
    abi: "function setBlocked(address,bool)",
    aviso: "A blocked wallet can neither send nor receive. The chart keeps moving for everyone else." },

  { sig: "enableTrading()", nombre: "Turn trading on", boton: "Enable",
    campos: [], arma: () => ["enableTrading", []],
    abi: "function enableTrading()",
    aviso: "One-way. Once it is on it can never be turned off again.", confirmar: true },

  { sig: "setLimits(uint256,uint256)", nombre: "Transfer and wallet caps", boton: "Apply",
    campos: [{ k: "tx", et: "Max per transfer (raw)", ph: "0" }, { k: "w", et: "Max per wallet (raw)", ph: "0" }],
    arma: (v) => ["setLimits", [BigInt(v.tx || "0"), BigInt(v.w || "0")]],
    abi: "function setLimits(uint256,uint256)" },

  { sig: "setTax(uint16,address)", nombre: "Transfer fee", boton: "Apply",
    campos: [{ k: "bps", et: "Basis points (100 = 1%)", ph: "0" }, { k: "to", et: "Recipient", ph: "0x..." }],
    arma: (v) => ["setTax", [Number(v.bps || 0), v.to]],
    abi: "function setTax(uint16,address)",
    aviso: "Above zero, swaps through a V3 or V4 pool revert. Buying and selling stop working." },

  { sig: "setMetadataURI(string)", nombre: "Picture and links", boton: "Update",
    campos: [{ k: "uri", et: "New metadataURI", ph: '{"image":"https://..."}' }],
    arma: (v) => ["setMetadataURI", [v.uri]],
    abi: "function setMetadataURI(string)" },

  { sig: "upgradeTo(address)", nombre: "Replace the contract", boton: "Upgrade",
    campos: [{ k: "impl", et: "New implementation", ph: "0x..." }],
    arma: (v) => ["upgradeTo", [v.impl]],
    abi: "function upgradeTo(address)",
    aviso: "Every balance stays and every rule can change. There is no undo.", confirmar: true },

  { sig: "changeAdmin(address)", nombre: "Proxy admin", boton: "Change",
    campos: [{ k: "who", et: "New admin", ph: "0x0000...0000 to seal it forever" }],
    arma: (v) => ["changeAdmin", [v.who]],
    abi: "function changeAdmin(address)",
    aviso: "Setting it to the zero address makes the contract permanent: no upgrade can ever happen again.", confirmar: true },

  { sig: "transferOwnership(address)", nombre: "Hand over ownership", boton: "Transfer",
    campos: [{ k: "who", et: "New owner", ph: "0x..." }],
    arma: (v) => ["transferOwnership", [v.who]],
    abi: "function transferOwnership(address)", confirmar: true },

  { sig: "renounceOwnership()", nombre: "Drop ownership", boton: "Renounce",
    campos: [], arma: () => ["renounceOwnership", []],
    abi: "function renounceOwnership()",
    aviso: "Permanent. Every owner-only control on this page stops working, for good.", confirmar: true },

  { sig: "burn(uint256)", nombre: "Burn your own tokens", boton: "Burn",
    campos: [{ k: "amt", et: "Amount (whole tokens)", ph: "1000" }],
    arma: (v, dec) => ["burn", [ethers.parseUnits(v.amt || "0", dec)]],
    abi: "function burn(uint256)", propio: true },
];

function mando(addr, c, dec, logBox) {
  const el = document.createElement("div");
  el.className = "ctl";
  const cab = document.createElement("div");
  cab.className = "ctl-head";
  const t = document.createElement("b"); t.textContent = c.nombre;
  cab.append(t);
  if (c.aviso) cab.append(qmark(c.aviso, c.nombre));
  el.append(cab);

  const fila = document.createElement("div");
  fila.className = "ctl-row";
  const vals = {};
  for (const f of c.campos) {
    if (f.tipo === "bool") {
      const sel = document.createElement("select");
      for (const [v, txt] of [["true", "yes"], ["false", "no"]]) {
        const o = document.createElement("option"); o.value = v; o.textContent = txt; sel.append(o);
      }
      sel.addEventListener("change", () => { vals[f.k] = sel.value; });
      vals[f.k] = "true";
      const lab = document.createElement("label"); lab.className = "field";
      const sp = document.createElement("span"); sp.textContent = f.et;
      lab.append(sp, sel); fila.append(lab);
    } else {
      const lab = document.createElement("label"); lab.className = "field";
      const sp = document.createElement("span"); sp.textContent = f.et;
      const inp = document.createElement("input");
      inp.type = "text"; inp.placeholder = f.ph || "";
      inp.addEventListener("input", () => { vals[f.k] = inp.value.trim(); });
      lab.append(sp, inp); fila.append(lab);
    }
  }
  const btn = document.createElement("button");
  btn.className = "btn btn-sm" + (c.confirmar ? " btn-danger" : "");
  btn.textContent = c.boton;
  btn.addEventListener("click", () => ejecutar(addr, c, vals, dec, logBox, btn));
  fila.append(btn);
  el.append(fila);
  return el;
}

async function ejecutar(addr, c, vals, dec, box, btn) {
  const log = posLogger(box);
  try {
    if (!signer) { await connect(); if (!signer) return; }
    if (c.confirmar && !confirm(c.nombre + "\n\n" + (c.aviso || "") + "\n\nGo ahead?")) return;
    let fn, args;
    try { [fn, args] = c.arma(vals, dec); }
    catch (e) { throw new Error("check the values: " + (e.shortMessage || e.message)); }
    btn.disabled = true;
    const con = new ethers.Contract(addr, [c.abi], signer);
    log(fn + "(" + args.map((x) => String(x)).join(", ") + ")");
    const tx = await con[fn](...args);
    log("sent: " + tx.hash);
    await tx.wait();
    log("done", "ok");
  } catch (e) {
    log(readableError(e), "err");
  } finally { btn.disabled = false; }
}

/* Un mando para CUALQUIER funcion, construido del ABI. Lo de arriba (CONTROLES)
 * son atajos con su aviso escrito para las que ya conocemos; esto cubre el
 * resto, incluida una que te hayas inventado editando el contrato. */
function tipoAmigable(t) {
  if (t === "address") return "0x...";
  if (t.startsWith("uint") || t.startsWith("int")) return "number";
  if (t === "bool") return "true / false";
  if (t === "string") return "text";
  if (t.startsWith("bytes")) return "0x...";
  return t;
}

function valorPara(tipo, txt) {
  const v = String(txt == null ? "" : txt).trim();
  if (tipo === "bool") return v === "true" || v === "1" || v === "yes";
  if (tipo.endsWith("[]")) {
    const base = tipo.slice(0, -2);
    return v ? v.split(",").map((x) => valorPara(base, x)) : [];
  }
  if (tipo.startsWith("uint") || tipo.startsWith("int")) return BigInt(v || "0");
  return v;
}

function mandoAbi(addr, frag, logBox) {
  const escritura = frag.stateMutability !== "view" && frag.stateMutability !== "pure";
  const el = document.createElement("div");
  el.className = "ctl";
  el.dataset.kind = escritura ? "write" : "read";

  const cab = document.createElement("div");
  cab.className = "ctl-head";
  const t = document.createElement("b"); t.textContent = frag.name;
  const tag = document.createElement("span"); tag.className = "ctl-tag";
  tag.textContent = escritura ? "write" : "read";
  cab.append(t, tag);
  el.append(cab);

  const fila = document.createElement("div");
  fila.className = "ctl-row";
  const inputs = [];
  for (const inp of frag.inputs) {
    const lab = document.createElement("label"); lab.className = "field";
    const sp = document.createElement("span");
    sp.textContent = (inp.name || inp.type) + " (" + inp.type + ")";
    const i = document.createElement("input");
    i.type = "text"; i.placeholder = tipoAmigable(inp.type);
    lab.append(sp, i); fila.append(lab);
    inputs.push({ tipo: inp.type, el: i });
  }
  const btn = document.createElement("button");
  btn.className = "btn btn-sm" + (escritura ? "" : " btn-ghost");
  btn.textContent = escritura ? "Send" : "Read";
  const salida = document.createElement("div");
  salida.className = "ctl-out"; salida.hidden = true;

  btn.addEventListener("click", async () => {
    const log = posLogger(logBox);
    btn.disabled = true;
    try {
      let args;
      try { args = inputs.map((x) => valorPara(x.tipo, x.el.value)); }
      catch (e) { throw new Error("check the values: " + e.message); }
      const firma = "function " + frag.name + "(" + frag.inputs.map((i) => i.type).join(",") + ")" +
        (escritura ? "" : " view returns (" + (frag.outputs || []).map((o) => o.type).join(",") + ")");
      if (!escritura) {
        const res = await callRead(addr, [firma], frag.name, args);
        salida.hidden = false;
        salida.textContent = res.map((x) => String(x)).join("  |  ") || "(empty)";
      } else {
        if (!signer) { await connect(); if (!signer) return; }
        const con = new ethers.Contract(addr, [firma], signer);
        log(frag.name + "(" + args.map(String).join(", ") + ")");
        const tx = await con[frag.name](...args);
        log("sent: " + tx.hash);
        await tx.wait();
        log("done", "ok");
      }
    } catch (e) {
      if (escritura) log(readableError(e), "err");
      else { salida.hidden = false; salida.textContent = readableError(e); }
    } finally { btn.disabled = false; }
  });

  fila.append(btn);
  el.append(fila, salida);
  return el;
}

function renderInspect(box, r) {
  box.textContent = "";
  const rows = document.createElement("div"); rows.className = "pos-rows";
  const row = (k, v) => { const d = document.createElement("div"); const a = document.createElement("span"); a.textContent = k; const b = document.createElement("b"); b.textContent = v; d.append(a, b); rows.append(d); };
  if (r.meta && r.meta.symbol) {
    row("Symbol", r.meta.symbol);
    row("Decimals", String(r.meta.decimals));
  } else {
    // Saying nothing here reads as "this token has no symbol". It has one; we
    // could not read it, and those are different problems with different fixes.
    row("Symbol", r.meta && r.meta.unreachable ? "no node answering \u2014 connect a wallet" : "does not answer symbol()");
  }
  if (r.supply) row("Total supply", r.supply);
  row("Deployed code", r.code + " bytes");
  for (const v of r.values) row(v.label, v.value);
  box.append(rows);

  const meta = (r.values.find((v) => v.label === "Metadata") || {}).value;
  if (meta) {
    let img = null, desc = null;
    try {
      const j = JSON.parse(meta);
      img = j.image; desc = j.description;
    } catch { if (/^(ipfs|https?):/.test(meta)) desc = meta; }
    const row2 = document.createElement("div");
    row2.className = "metaRow";
    const cir = document.createElement("div");
    cir.className = "metaImg";
    if (img) {
      const el = document.createElement("img");
      el.src = img.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + img.slice(7) : img;
      el.alt = "";
      el.addEventListener("error", () => { cir.textContent = "image did not load"; cir.classList.add("bad"); });
      cir.append(el);
    } else { cir.textContent = "link"; }
    const tx = document.createElement("div");
    tx.className = "metaTxt";
    const b1 = document.createElement("b"); b1.textContent = "metadataURI()";
    const s1 = document.createElement("span"); s1.textContent = desc || meta.slice(0, 90);
    tx.append(b1, s1);
    row2.append(cir, tx);
    box.append(row2);
  }

  const h = document.createElement("div"); h.className = "inspect-h";
  h.textContent = r.found.length ? "Functions found in the bytecode" : "No special functions found — it looks like a plain fixed-supply token";
  box.append(h);

  if (r.found.length) {
    const ul = document.createElement("ul"); ul.className = "powers";
    for (const f of r.found) {
      const li = document.createElement("li");
      li.dataset.level = f.level;
      const dot = document.createElement("span"); dot.className = "feat-dot";
      const s = document.createElement("span"); s.textContent = f.label;
      const c = document.createElement("code"); c.textContent = f.sig;
      li.append(dot, s, c); ul.append(li);
    }
    box.append(ul);
  }

  /* And the controls. Whether they will work depends on who you are, so that is
   * said before the buttons rather than discovered by a reverted transaction. */
  const disponibles = CONTROLES.filter((c) => r.selectores.has(ethers.id(c.sig).slice(2, 10)));
  if (!disponibles.length) return;

  const dueno = (r.values.find((v) => v.label === "Owner") || {}).value || "";
  const admin = (r.values.find((v) => v.label === "Proxy admin") || {}).value || "";
  const yo = (account || "").toLowerCase();
  const soyDueno = yo && dueno.toLowerCase() === yo;
  const soyAdmin = yo && admin.toLowerCase() === yo;

  const h2 = document.createElement("div"); h2.className = "inspect-h";
  h2.textContent = "Use them";
  box.append(h2);

  const quien = document.createElement("div");
  quien.className = "ctl-who";
  quien.dataset.ok = (soyDueno || soyAdmin) ? "yes" : "no";
  quien.textContent = !yo
    ? "Connect a wallet to use these."
    : soyDueno || soyAdmin
      ? "This wallet is the " + (soyDueno ? "owner" : "proxy admin") + ", so these will go through."
      : dueno && dueno.startsWith("none")
        ? "Ownership was renounced, so the owner-only ones below will revert for everybody, including you."
        : "This wallet is not the owner. The owner-only ones will revert.";
  box.append(quien);

  const logBox = document.createElement("div");
  logBox.className = "log"; logBox.hidden = true;

  /* Si tenemos el ABI -- porque el token se hizo aqui, o porque lo has pegado --
   * se pinta TODO lo que el contrato sabe hacer, no solo lo que alguien penso
   * en poner en una lista. Eso es lo que hace innecesario el explorador. */
  if (r.abi && r.abi.length) {
    const fns = r.abi.filter((f) => f.type === "function" && f.name);
    const escrituras = fns.filter((f) => f.stateMutability !== "view" && f.stateMutability !== "pure");
    const lecturas = fns.filter((f) => f.stateMutability === "view" || f.stateMutability === "pure");
    const yaCubiertas = new Set(disponibles.map((c) => c.sig.split("(")[0]));

    for (const [titulo, lista] of [["Everything it can do", escrituras], ["Everything it can tell you", lecturas]]) {
      const restantes = lista.filter((f) => !yaCubiertas.has(f.name));
      if (!restantes.length) continue;
      const hh = document.createElement("div"); hh.className = "inspect-h";
      hh.textContent = titulo;
      box.append(hh);
      for (const f of restantes) box.append(mandoAbi(r.address, f, logBox));
    }
  }

  // Todos se pintan siempre. Esconder los que van a revertir deja a alguien
  // mirando una pantalla que no explica por que falta lo que esta buscando; el
  // aviso de arriba dice quien eres y eso basta.
  for (const c of disponibles) {
    box.append(mando(r.address, c, r.meta ? r.meta.decimals : 18, logBox));
  }
  box.append(logBox);
}

/* ── your liquidity ─────────────────────────────────────────────────── */

async function loadPositions() {
  const box = $("#positions");
  if (!account) return;
  box.textContent = "";
  const loading = document.createElement("p"); loading.className = "empty"; loading.textContent = "reading your positions…";
  box.append(loading);
  try {
    const [count] = await callRead(ARC.positionManager, NFPM_ABI, "balanceOf", [account]);
    const n = Number(count);
    box.textContent = "";
    if (!n) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "No liquidity positions in this wallet yet."; box.append(p); return; }
    for (let i = 0; i < n; i++) {
      const [id] = await callRead(ARC.positionManager, NFPM_ABI, "tokenOfOwnerByIndex", [account, i]);
      box.append(renderPosition(id, await callRead(ARC.positionManager, NFPM_ABI, "positions", [id])));
    }
  } catch (e) {
    box.textContent = "";
    const p = document.createElement("p"); p.className = "empty"; p.textContent = "Could not read positions: " + readableError(e);
    box.append(p);
  }
}

async function symbolOf(addr) {
  if (addr.toLowerCase() === QUOTE.address.toLowerCase()) return "USDC";
  const m = await readToken(addr);
  return m && m.symbol ? m.symbol : addr.slice(0, 8) + "…";
}

function renderPosition(id, pos) {
  const el = document.createElement("div"); el.className = "pos";
  const head = document.createElement("div"); head.className = "pos-head";
  const pair = document.createElement("span"); pair.className = "pos-pair"; pair.textContent = "loading…";
  const idEl = document.createElement("span"); idEl.className = "pos-id"; idEl.textContent = "#" + id.toString();
  head.append(pair, idEl);
  Promise.all([symbolOf(pos.token0), symbolOf(pos.token1)])
    .then(([a, b]) => { pair.textContent = a + " / " + b + " · " + (Number(pos.fee) / 10000).toFixed(2) + "%"; });

  const rows = document.createElement("div"); rows.className = "pos-rows";
  const row = (k, v) => { const d = document.createElement("div"); const a = document.createElement("span"); a.textContent = k; const b = document.createElement("b"); b.textContent = v; d.append(a, b); rows.append(d); };

  /* QUE ES ESTA POSICION, dicho en palabras.
   *
   * Un lanzamiento crea cuatro y en V3 cada rango es un NFT distinto -- no se
   * pueden juntar. En pantalla salian las cuatro identicas, con "514000 →
   * 527600" como unica diferencia. Un numero de tick no le dice nada a nadie:
   * hay que traducirlo a precio y decir de que lado del precio esta, que es lo
   * que determina si lleva tokens, dolares o las dos cosas. */
  const etiqueta = document.createElement("div");
  etiqueta.className = "pos-kind";
  etiqueta.textContent = "reading where the price is…";
  el.append(etiqueta);

  (async () => {
    const usdcEsToken0 = String(pos.token0).toLowerCase() === QUOTE.address.toLowerCase();
    const otro = usdcEsToken0 ? pos.token1 : pos.token0;
    const meta = await readToken(otro);
    const dec = meta && meta.decimals != null ? meta.decimals : 18;
    const sim = (meta && meta.symbol) || "the token";

    // precio en USDC por token, a partir del tick. Si el USDC es token0 la
    // relacion se invierte, igual que en el resto de la pagina.
    const pr = (t) => {
      const r = Math.pow(1.0001, Number(t));
      return usdcEsToken0 ? (1 / r) * 10 ** (dec - QUOTE.decimals) : r * 10 ** (dec - QUOTE.decimals);
    };
    const pa = pr(pos.tickLower), pb = pr(pos.tickUpper);
    const lo = Math.min(pa, pb), hi = Math.max(pa, pb);
    row("Price range", "$" + lo.toExponential(3) + "  →  $" + hi.toExponential(3));

    let tick = null;
    try {
      const [pool] = await callRead(ARC.v3Factory, FACTORY_ABI, "getPool", [pos.token0, pos.token1, pos.fee]);
      if (pool && pool !== ethers.ZeroAddress) {
        const s0 = await callRead(pool, POOL_ABI, "slot0");
        tick = Number(s0[1]);
        row("Price now", "$" + pr(tick).toExponential(3));
      }
    } catch { /* sin red, la etiqueta se queda en lo que se sepa */ }

    if (tick === null) {
      etiqueta.textContent = "Cannot read where the price is right now — connect a wallet.";
      return;
    }
    const arriba = Number(pos.tickLower) >= tick;
    const abajo = Number(pos.tickUpper) <= tick;
    // Con el USDC de token0 el orden se invierte: ticks altos = precio bajo.
    const porEncimaDelPrecio = usdcEsToken0 ? abajo : arriba;
    const porDebajoDelPrecio = usdcEsToken0 ? arriba : abajo;

    if (porEncimaDelPrecio) {
      etiqueta.dataset.kind = "sell";
      etiqueta.textContent = "SELL WALL — sits above the price, so it holds only " + sim +
        ". As the price rises into it, these are sold for USDC at the prices above.";
    } else if (porDebajoDelPrecio) {
      etiqueta.dataset.kind = "buy";
      etiqueta.textContent = "FLOOR — sits below the price, so it holds only USDC. It is what a seller sells into; if the price falls into it you end up buying " + sim + ".";
    } else {
      etiqueta.dataset.kind = "both";
      etiqueta.textContent = "ACTIVE — the price is inside this range, so it holds both and is the one earning fees right now.";
    }
  })();

  row("Liquidity", pos.liquidity.toString());
  row("Tick range", pos.tickLower + " → " + pos.tickUpper);
  row("Uncollected fees", pos.tokensOwed0.toString() + " / " + pos.tokensOwed1.toString());

  const log = document.createElement("div"); log.className = "log"; log.hidden = true;
  const actions = document.createElement("div"); actions.className = "pos-actions";

  const mk = (text, cls, fn) => { const b = document.createElement("button"); b.className = "btn btn-sm " + (cls || ""); b.textContent = text; b.addEventListener("click", fn); return b; };

  const lockRow = document.createElement("div"); lockRow.className = "pos-lock";
  const lf = document.createElement("label"); lf.className = "field";
  const lfs = document.createElement("span"); lfs.textContent = "Unlocked on";
  const lfi = document.createElement("input"); lfi.type = "date";
  lf.append(lfs, lfi);
  lockRow.append(lf, mk("Deploy locker & lock", "btn-primary", () => lockPosition(id, lfi.value, log)));

  const moreRow = document.createElement("div"); moreRow.className = "pos-lock";
  const m0 = document.createElement("label"); m0.className = "field";
  const m0s = document.createElement("span"); m0s.textContent = "token0 amount (raw)";
  const m0i = document.createElement("input"); m0i.type = "text"; m0i.inputMode = "numeric"; m0i.placeholder = "0";
  m0.append(m0s, m0i);
  const m1 = document.createElement("label"); m1.className = "field";
  const m1s = document.createElement("span"); m1s.textContent = "token1 amount (raw)";
  const m1i = document.createElement("input"); m1i.type = "text"; m1i.inputMode = "numeric"; m1i.placeholder = "0";
  m1.append(m1s, m1i);
  moreRow.append(m0, m1, mk("Add", "btn-primary", () => increase(id, pos, m0i.value, m1i.value, log)));

  actions.append(
    mk("Collect fees", "", () => cobrarFees(id, log)),
    mk("Add more", "", () => moreRow.classList.toggle("is-open")),
    mk("Lock with a deadline", "", () => lockRow.classList.toggle("is-open")),
    mk("Withdraw everything", "", () => withdrawPosition(id, pos, log)),
    mk("Burn permanently", "btn-danger", () => burnPosition(id, log)),
  );

  el.append(head, rows, actions, moreRow, lockRow, log);
  return el;
}

function posLogger(box) {
  return (msg, cls) => {
    box.hidden = false;
    const row = document.createElement("div");
    const m = document.createElement("span"); if (cls) m.className = cls; m.textContent = msg;
    row.append(m); box.append(row);
  };
}

/* Cobrar comisiones NO toca el principal: en V3 lo que `collect` paga es
 * `tokensOwed`, y el principal solo pasa a estar debido despues de un
 * `decreaseLiquidity`. Por eso esto funciona incluso con la posicion
 * bloqueada -- el locker tiene collectFees() y no tiene decreaseLiquidity. */
async function cobrarFees(id, box) {
  const log = posLogger(box);
  try {
    if (!signer) { await connect(); if (!signer) return; }
    const nfpm = new ethers.Contract(ARC.positionManager, NFPM_ABI, signer);
    const MAX128 = (1n << 128n) - 1n;
    log("collecting fees on #" + id.toString() + " — this cannot touch your liquidity");
    await (await nfpm.collect({ tokenId: id, recipient: account, amount0Max: MAX128, amount1Max: MAX128 })).wait();
    log("collected", "ok");
    loadPositions();
  } catch (e) { log(readableError(e), "err"); }
}

async function increase(id, pos, a0, a1, box) {
  const log = posLogger(box);
  try {
    if (!signer) { await connect(); if (!signer) return; }
    const amount0 = BigInt((a0 || "0").replace(/[^0-9]/g, "") || "0");
    const amount1 = BigInt((a1 || "0").replace(/[^0-9]/g, "") || "0");
    if (!amount0 && !amount1) throw new Error("enter an amount");
    if (amount0) await approveIfNeeded(pos.token0, amount0, log, "token0");
    if (amount1) await approveIfNeeded(pos.token1, amount1, log, "token1");
    const nfpm = new ethers.Contract(ARC.positionManager, NFPM_ABI, signer);
    log("adding to the same range…");
    await (await nfpm.increaseLiquidity({
      tokenId: id, amount0Desired: amount0, amount1Desired: amount1,
      amount0Min: 0, amount1Min: 0, deadline: Math.floor(Date.now() / 1000) + 1800,
    })).wait();
    log("added", "ok");
    loadPositions();
  } catch (e) { log(readableError(e), "err"); }
}

async function withdrawPosition(id, pos, box) {
  const log = posLogger(box);
  try {
    if (!signer) { await connect(); if (!signer) return; }
    const nfpm = new ethers.Contract(ARC.positionManager, NFPM_ABI, signer);
    const deadline = Math.floor(Date.now() / 1000) + 1800;
    if (pos.liquidity > 0n) {
      log("removing liquidity…");
      await (await nfpm.decreaseLiquidity({ tokenId: id, liquidity: pos.liquidity, amount0Min: 0, amount1Min: 0, deadline })).wait();
    }
    log("collecting what is owed…");
    const MAX128 = (1n << 128n) - 1n;
    await (await nfpm.collect({ tokenId: id, recipient: account, amount0Max: MAX128, amount1Max: MAX128 })).wait();
    log("withdrawn", "ok");
    loadPositions();
  } catch (e) { log(readableError(e), "err"); }
}

async function burnPosition(id, box) {
  const log = posLogger(box);
  const ok = confirm(
    "This sends position #" + id.toString() + " to a dead address.\n\n" +
    "The liquidity can never be withdrawn again — not by you, not by anyone — and " +
    "neither can the fees it earns from now on.\n\nThis cannot be undone."
  );
  if (!ok) return;
  try {
    if (!signer) { await connect(); if (!signer) return; }
    const nfpm = new ethers.Contract(ARC.positionManager, NFPM_ABI, signer);
    log("sending the position to " + ARC.deadAddress + "…");
    await (await nfpm.safeTransferFrom(account, ARC.deadAddress, id)).wait();
    log("burned permanently", "ok");
    loadPositions();
  } catch (e) { log(readableError(e), "err"); }
}

/* The locker is compiled and deployed by whoever uses it. There is no shared
 * locker of ours, so there is nothing to trust beyond the code below. */
const LOCKER_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * Holds one Uniswap V3 position NFT until a timestamp, then gives it back to
 * the address that locked it. No admin, no owner, no early exit: the only
 * thing that can release the position is time.
 */
interface IPositionManager {
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    function collect(CollectParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);
}

contract LiquidityLock {
    address public immutable manager;
    address public immutable beneficiary;
    uint256 public immutable unlockTime;
    uint256 public immutable tokenId;

    event Unlocked(uint256 tokenId, address to);

    constructor(address manager_, address beneficiary_, uint256 unlockTime_, uint256 tokenId_) {
        require(unlockTime_ > block.timestamp, "unlock time is in the past");
        manager = manager_;
        beneficiary = beneficiary_;
        unlockTime = unlockTime_;
        tokenId = tokenId_;
    }

    /// Trading fees stay claimable the whole time it is locked. Locking
    /// liquidity should not mean giving up what it earns.
    function collectFees() external {
        require(msg.sender == beneficiary, "not the beneficiary");
        IPositionManager(manager).collect(
            IPositionManager.CollectParams({
                tokenId: tokenId,
                recipient: beneficiary,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
    }

    function withdraw() external {
        require(block.timestamp >= unlockTime, "still locked");
        require(msg.sender == beneficiary, "not the beneficiary");
        IPositionManager(manager).safeTransferFrom(address(this), beneficiary, tokenId);
        emit Unlocked(tokenId, beneficiary);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
`;

async function lockPosition(id, dateStr, box) {
  const log = posLogger(box);
  try {
    if (!dateStr) throw new Error("pick a date first");
    const unlock = Math.floor(new Date(dateStr + "T00:00:00").getTime() / 1000);
    if (!isFinite(unlock) || unlock <= Math.floor(Date.now() / 1000)) throw new Error("pick a date in the future");
    if (!signer) { await connect(); if (!signer) return; }
    const file = await compileAll(LOCKER_SOURCE, log);
    const c = file.LiquidityLock;
    log("locker compiled: " + (c.evm.bytecode.object.length / 2) + " bytes", "ok");
    const lock = await new ethers.ContractFactory(c.abi, "0x" + c.evm.bytecode.object, signer)
      .deploy(ARC.positionManager, account, unlock, id);
    await lock.waitForDeployment();
    const lockAddr = await lock.getAddress();
    log("locker deployed at " + lockAddr, "ok");
    const nfpm = new ethers.Contract(ARC.positionManager, NFPM_ABI, signer);
    log("sending the position into the locker…");
    await (await nfpm.safeTransferFrom(account, lockAddr, id)).wait();
    log("locked until " + dateStr + " \u2014 write down " + lockAddr, "ok");
    loadPositions();
    return true;
  } catch (e) { log(readableError(e), "err"); return false; }
}

/* ── LA PESTANA 6 ────────────────────────────────────────────────────────
 * El plan se configura, se pinta y se ejecuta desde el mismo objeto: lo que
 * ves en la tabla y lo que se firma no pueden separarse porque salen de la
 * misma llamada. */

let PLAN = planPorDefecto();

const SUPPLIES_RAPIDOS = [
  ["1M", 1e6], ["21M", 21e6], ["1B", 1e9],
  ["420.69T", 420690000000000], ["1 quadrillion", 1e15],
];

/* LOS DECIMALES DEL PLAN, EN UN SOLO SITIO.
 *
 * Vivian en cinco, con dos reglas distintas, y por eso la tabla llego a
 * imprimir "6 decimals" para un token que el contrato iba a desplegar con 18.
 * Un token que se despliega aqui SIEMPRE tiene 18 -- lo fija generateSource --
 * y uno que ya existe tiene los que diga la cadena.
 *
 * Con ?? y no ||, porque 0 decimales es legitimo y con || se volvia 18. */
function decDelPlan() {
  return PLAN.modo === "existente" ? (PLAN.decimals ?? 18) : 18;
}

function leerPlan() {
  const n = (id, def) => { const v = Number(String($(id).value).replace(/[^0-9.]/g, "")); return isFinite(v) && v > 0 ? v : def; };
  if (PLAN.modo !== "existente") PLAN.nombre = $("#pName").value.trim() || "My Token";
  if (PLAN.modo !== "existente") PLAN.símbolo = ($("#pSym").value.trim() || "MTK").toUpperCase();
  if (PLAN.modo !== "existente") PLAN.supply = Math.floor(n("#pSupply", 1e9));
  PLAN.mcapObjetivo = n("#pMcap", MCAP_POR_DEFECTO);
  PLAN.imagen = $("#pImage").value.trim();
  PLAN.web = $("#pWeb").value.trim();
  PLAN.twitter = $("#pTw").value.trim();
  PLAN.telegram = $("#pTg").value.trim();
  PLAN.descripción = $("#pDesc").value.trim();
  PLAN.metadataEditable = $("#pEditable").checked;
  PLAN.compra.usdc = Number(String($("#pBuy").value).replace(/[^0-9.]/g, "")) || 0;
  PLAN.tesoreríaPct = Math.max(0, Math.min(100, Number($("#pTreasury").value) || 0));
  $$("#pStages .stage").forEach((el, k) => {
    const t = PLAN.tramos[k];
    if (!t) return;
    /* El % del muro no se teclea: es todo lo que no es tesoreria. */
    t.pct = pctDelMuro(PLAN);
    el.querySelector(".s-pct").value = String(t.pct);
    t.desde = Number(el.querySelector(".s-from").value) || t.desde;
    t.hasta = Number(el.querySelector(".s-to").value) || t.hasta;
    t.bloquear = el.querySelector(".s-lock").checked;
    t.meses = Math.max(1, Number(el.querySelector(".s-months").value) || 6);
  });
  pintarPlan();
}

function pintarTramos() {
  const box = $("#pStages");
  box.textContent = "";
  PLAN.tramos.forEach((t, k) => {
    const el = document.createElement("div");
    el.className = "stage";
    const campo = (cls, et, val, soloLectura) => {
      const l = document.createElement("label"); l.className = "field";
      const s = document.createElement("span"); s.textContent = et;
      const i2 = document.createElement("input");
      i2.type = "text"; i2.inputMode = "decimal"; i2.className = cls; i2.value = val;
      if (soloLectura) { i2.readOnly = true; i2.tabIndex = -1; }
      else i2.addEventListener("input", leerPlan);
      l.append(s, i2); return l;
    };
    const cab = document.createElement("div"); cab.className = "stage-head";
    const b = document.createElement("b"); b.textContent = "Sell wall";
    cab.append(b, qmark(
      "Holds only your token, so it costs you no USDC. As the price rises through this band it sells for you, at prices anyone can read on chain before they buy. It takes everything that is not your treasury, so nothing is left over. The average you get is the geometric mean of the two ends, not the top.",
      "Sell wall"));
    el.append(cab);

    const fila = document.createElement("div"); fila.className = "stage-row";
    fila.append(campo("s-pct", "% of supply (all but the treasury)", pctDelMuro(PLAN), true));
    fila.append(campo("s-from", "from × price", t.desde));
    fila.append(campo("s-to", "to × price", t.hasta));

    const lk = document.createElement("label"); lk.className = "field stage-lock";
    const ls = document.createElement("span"); ls.textContent = "Lock";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.className = "s-lock"; cb.checked = t.bloquear;
    cb.addEventListener("change", leerPlan);
    const mo = document.createElement("input");
    mo.type = "text"; mo.inputMode = "numeric"; mo.className = "s-months"; mo.value = t.meses;
    mo.addEventListener("input", leerPlan);
    const wrap = document.createElement("div"); wrap.className = "lockRow";
    const mLab = document.createElement("span"); mLab.className = "unit"; mLab.textContent = "months";
    wrap.append(cb, mo, mLab);
    lk.append(ls, wrap);
    fila.append(lk);
    el.append(fila);
    box.append(el);
  });
}

const MODOS = [
  { id: "nuevo", name: "Deploy a new one",
    what: "the plan creates the token and then its market",
    like: "One extra signature, and the contract comes out with no mint, no pause, no blacklist and no tax." },
  { id: "existente", name: "I already have one",
    what: "paste the address and the plan goes straight to the pool",
    like: "For a token minted anywhere \u2014 here, another launchpad, or by hand. Supply, symbol and decimals are read from the chain, so the opening price still comes out of the market cap you choose. You need to be holding the tokens the walls will use." },
];

function pintarModo() {
  const box = $("#pModo");
  box.textContent = "";
  for (const m of MODOS) {
    const lab = document.createElement("label"); lab.className = "radio";
    const inp = document.createElement("input");
    inp.type = "radio"; inp.name = "pmodo"; inp.value = m.id; inp.checked = (PLAN.modo || "nuevo") === m.id;
    const sp = document.createElement("span");
    const b = document.createElement("b"); b.textContent = m.name;
    sp.append(b, document.createTextNode(" \u2014 " + m.what), qmark(m.like, m.name));
    lab.append(inp, sp);
    inp.addEventListener("change", async () => {
      PLAN.modo = m.id;
      const ex = m.id === "existente";
      /* Lo que se leyo de la cadena NO sobrevive al cambio de modo. PLAN.decimals
       * lo escribia esta lectura y nada lo devolvia a 18: pegabas un token de 6,
       * cambiabas a "Deploy a new one", y el token nuevo salia con 18 decimales
       * mientras la pool se abria con 6. Un factor de 1e12 sobre el precio que
       * la tabla acababa de imprimir. */
      if (!ex) { PLAN.decimals = 18; PLAN.tokenExistente = null; }
      $("#pExistingBox").hidden = !ex;
      /* Con un token que YA existe, su identidad esta escrita en la cadena y no
       * hay metadataURI que poner. Ensenar esos campos seria ofrecer algo que el
       * plan no puede hacer. */
      $("#identityH").hidden = ex;
      /* Se ocultan los CONTENEDORES, no cada campo suelto: esconder los inputs
       * de una rejilla y dejar la rejilla deja un hueco vacio donde antes habia
       * algo, que se lee como que la pagina se ha roto. */
      for (const id of ["pName", "pImage", "pTw"]) {
        const g = $("#" + id).closest(".grid2"); if (g) g.hidden = ex;
      }
      const d = $("#pDesc").closest(".field"); if (d) d.hidden = ex;
      const ed = $("#pEditable").closest(".radio"); if (ed) ed.hidden = ex;
      // El supply viene de la cadena; su recuadro comparte rejilla con el market
      // cap, que SI se elige, asi que se oculta solo el campo.
      const su = $("#pSupply").closest(".field"); if (su) su.hidden = ex;
      // "Size" con un solo campo debajo ya no describe lo que hay ahi: el
      // tamano viene dado y lo unico que se elige es a que precio abre.
      $("#sizeH").textContent = ex ? "Opening price" : "Size";
      if (ex) await leerTokenExistente();
      leerPlan();
    });
    box.append(lab);
  }
}

/* Lee lo que ya esta escrito en el token. El precio sigue saliendo de dividir
 * el market cap que elijas entre ese supply, asi que "abre a 5.000" vale igual
 * para un token de otro. */
async function leerTokenExistente() {
  const dir = $("#pExisting").value.trim();
  const info = $("#pExistingInfo");
  /* Se olvida el token anterior ANTES de intentar leer el nuevo. Si no, una
   * lectura que falla -- una direccion a medio pegar, un nodo mudo -- dejaba en
   * el plan el token de la vez anterior, y Run lanzaba ESE: creaba su pool y
   * minteaba sus muros mientras el campo mostraba otra direccion. */
  PLAN.tokenExistente = null;
  if (!ethers.isAddress(dir)) { info.textContent = "Paste a token address."; return; }
  info.textContent = "reading\u2026";
  const m = await readToken(dir);
  if (!m || m.unreachable) {
    info.textContent = m && m.unreachable
      ? "No Arc node is answering right now \u2014 connect a wallet and it will use yours."
      : "That address does not answer symbol() and decimals(). Is it an ERC-20?";
    return;
  }
  try {
    const [ts] = await callRead(dir, ERC20_ABI, "totalSupply");
    PLAN.supply = Math.floor(Number(ethers.formatUnits(ts, m.decimals)));
    PLAN.simbolo_ = m.symbol;
    PLAN["s\u00edmbolo"] = m.symbol;
    PLAN.nombre = m.symbol;
    PLAN.decimals = m.decimals;
    PLAN.tokenExistente = ethers.getAddress(dir);
    let saldo = null;
    if (account) {
      try { const [b] = await callRead(dir, ERC20_ABI, "balanceOf", [account]); saldo = Number(ethers.formatUnits(b, m.decimals)); } catch {}
    }
    info.textContent = m.symbol + " \u00b7 " + PLAN.supply.toLocaleString("es") + " supply \u00b7 " +
      m.decimals + " decimals" +
      (saldo !== null ? "  \u00b7  you hold " + Math.round(saldo).toLocaleString("es") +
        " (" + ((saldo / PLAN.supply) * 100).toFixed(1) + "%)" : "");
    pintarPlan();
  } catch (e) { info.textContent = readableError(e); }
}

/* "QUE PASA CON LO QUE SOBRA" SE FUE CON LOS TRES MUROS (17-sep-2026). Con un
 * solo muro que se lleva todo lo que no es tesoreria no sobra nada que decidir,
 * y una pregunta sin respuesta posible solo confunde. */

function pintarChips() {
  const box = $("#pSupplyChips");
  box.textContent = "";
  for (const [et, v] of SUPPLIES_RAPIDOS) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chipBtn"; b.textContent = et;
    if (PLAN.supply === v) b.setAttribute("aria-pressed", "true");
    b.addEventListener("click", (e) => { e.preventDefault(); $("#pSupply").value = String(v); leerPlan(); });
    box.append(b);
  }
}

function pintarPlan() {
  const r = planResumen(PLAN);
  const P0 = precioDe(PLAN);
  $("#pPriceOut").textContent =
    "Opens at $" + P0.toExponential(4) + " per token. Computed from the two numbers above — never typed.";

  const av = avisosDe(PLAN);
  const w = $("#pWarn");
  w.textContent = ""; w.hidden = !av.length;
  if (av.length) {
    const t = document.createElement("div"); t.className = "conflicts-title";
    t.textContent = "Worth knowing before you sign";
    w.append(t);
    for (const x of av) { const p = document.createElement("p"); p.textContent = x; w.append(p); }
  }

  const T = (n) => n >= 1e12 ? (n / 1e12).toFixed(2) + "T" : n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : Math.round(n).toLocaleString("es");
  const existente = PLAN.modo === "existente";
  const filas = [
    existente
      ? ["Use " + PLAN.símbolo,
         (PLAN.tokenExistente || "paste the address above") + " · " +
         PLAN.supply.toLocaleString("es") + " supply · " + decDelPlan() + " decimals",
         "—"]
      : ["Deploy " + PLAN.símbolo,
         PLAN.supply.toLocaleString("es") + " supply, " + decDelPlan() + " decimals",
         "1 tx"],
    ["Create the pool", "against USDC, 1.00% fee, opening at $" + P0.toExponential(4) + "  (mcap $" + PLAN.mcapObjetivo.toLocaleString("es") + ")", r.compra > 0 ? "atomic" : "in the batch"],
  ];
  // El porcentaje AL LADO del numero. "10.000.000" no se lee como "1%" de un
  // vistazo, y eso hizo dudar de un calculo que estaba bien. Un numero que
  // lleva su propia unidad no necesita que nadie divida mentalmente.
  const pct = (n) => " (" + ((n / PLAN.supply) * 100).toFixed(n / PLAN.supply < 0.01 ? 2 : 0) + "% of supply)";
  for (const p of r.posiciones) {
    const que = p.tokens > 0 ? T(p.tokens) + " tokens" + pct(p.tokens) + ", no USDC" : "$" + p.usdc + " USDC, no tokens";
    const cierre = p.bloquear ? "  ·  locked " + p.meses + " months" : "";
    const junto = r.compra > 0 ? "atomic" : "in the batch";
    filas.push([p.etiqueta, que + "  ·  $" + p.min.toExponential(3) + " → $" + p.max.toExponential(3) + cierre, p.bloquear ? junto + " + 2 tx" : junto]);
  }
  /* LA COMPRA INICIAL, EN LA MISMA TRANSACCION QUE LA POOL. Ver compra-atomica.js. */
  if (r.compra > 0) {
    filas.push(["First buy", "$" + r.compra + " USDC  ·  in the same transaction that creates the pool and the wall — nobody can buy before you", "atomic"]);
  }
  /* LO QUE TE QUEDAS TU, EN UNA SOLA FILA.
   *
   * Antes salian "Treasury 1%" y "Unallocated 9%" como si fueran cosas
   * distintas. No lo son: las dos acaban en tu cartera. Alguien que pide
   * quedarse el 1% y ve que se queda el 10% tiene razon en desconfiar, y el
   * reparto silencioso del sobrante es culpa de la herramienta, no suya.
   *
   * Es ademas EL numero que mira cualquiera que compre. Va junto y va claro. */
  if (r.quema > 0) {
    filas.push(["BURN", T(r.quema) + pct(r.quema) + "  —  sent to the dead address, in its own transaction, gone for good", "1 tx"]);
  }

  const tuyo = r.reservas.reduce((a, x) => a + x.tokens, 0);
  if (tuyo > 0) {
    const detalle = r.reservas.map((x) => x.etiqueta.toLowerCase() + " " + ((x.tokens / PLAN.supply) * 100).toFixed(0) + "%").join(" + ");
    filas.push([
      "YOU KEEP",
      T(tuyo) + pct(tuyo) + (r.reservas.length > 1 ? "  —  " + detalle : "") +
      "  —  sold into the pool for expenses, never withdrawn as liquidity",
      "—",
    ]);
  }

  const box = $("#pTable");
  box.textContent = "";
  const t2 = document.createElement("div"); t2.className = "plan";
  for (const [c1, c2, c3] of filas) {
    const row = document.createElement("div"); row.className = "plan-row";
    const n1 = document.createElement("b"); n1.textContent = c1;
    const n2 = document.createElement("span"); n2.textContent = c2;
    const n3 = document.createElement("code"); n3.textContent = c3;
    row.append(n1, n2, n3); t2.append(row);
  }
  box.append(t2);

  /* Ya no se resta el despliegue aqui: resumen() conoce el modo y lo cuenta.
   * Restarlo dos veces daba un paso de menos en cuanto los dos sitios
   * intentaban arreglar lo mismo. */
  const pasosReales = r.pasos;
  /* LAS CIFRAS SALEN DE LAS POSICIONES, NO DE LOS PORCENTAJES QUE PEDISTE.
   *
   * Esta linea decia r.repartido y r.tesoreria + r.libre, y las dos estaban
   * mal desde que se anadio la decision sobre el sobrante: con el reparto por
   * omision ("a los muros") imprimia "80% into the walls, 20% STAYS WITH YOU"
   * mientras la tabla justo encima decia 85% y 15%. Dos cifras distintas para
   * lo mismo, a un centimetro una de otra, y la de abajo era la equivocada.
   *
   * Ahora se suman los tokens que van de verdad a cada sitio: la misma fuente
   * que pinta la tabla, asi que no pueden discrepar. */
  const enMuros = r.posiciones.reduce((a, p) => a + p.tokens, 0);
  /* `tuyo` ya esta calculado arriba, para la fila YOU KEEP. Es EL mismo numero:
   * calcularlo dos veces es el mecanismo por el que acabaron imprimiendose dos
   * cifras distintas para lo mismo a un centimetro una de otra. Y `pct` de
   * arriba devuelve " (X% of supply)", que no encaja en una linea de resumen,
   * asi que este solo da el porcentaje. */
  const soloPct = (n) => {
    const v = (n / PLAN.supply) * 100;
    return (v >= 10 || v === 0 ? v.toFixed(0) : v.toFixed(1)) + "%";
  };
  $("#pCost").textContent =
    pasosReales + " transactions \u00b7 $" + r.usdc + " of USDC for the first buy \u00b7 roughly $" +
    (0.02 + pasosReales * 0.02).toFixed(2) + " of gas \u00b7 " +
    soloPct(enMuros) + " into the wall \u00b7 " + soloPct(tuyo) + " STAYS WITH YOU" +
    (r.quema > 0 ? " \u00b7 " + soloPct(r.quema) + " burnt" : "") +
    (r.bloqueos ? "  \u00b7  " + r.bloqueos + " position(s) locked" : "");
}

/* Lo que falta para pagar una posicion, dicho en palabras, o null si alcanza.
 * Un saldo que no se puede leer NO cuenta como insuficiente: parar por un nodo
 * mudo seria peor que intentarlo y que revierta. */
async function noAlcanza(s, a0, a1, log) {
  const mira = async (addr, want) => {
    if (want <= 0n) return null;
    let bal;
    try { [bal] = await callRead(addr, ERC20_ABI, "balanceOf", [account]); }
    catch { return null; }
    if (BigInt(bal) >= want) return null;
    let sym = addr.toLowerCase() === QUOTE.address.toLowerCase() ? QUOTE.symbol : PLAN["s\u00edmbolo"];
    let dec = addr.toLowerCase() === QUOTE.address.toLowerCase() ? QUOTE.decimals : decDelPlan();
    return "needs " + ethers.formatUnits(want, dec) + " " + sym +
           ", wallet holds " + ethers.formatUnits(bal, dec);
  };
  return (await mira(s.token0, a0)) || (await mira(s.token1, a1));
}

/* ---- progreso de un plan ------------------------------------------------
 * Un plan son hasta catorce firmas y se corta por cualquier motivo: un rechazo
 * en la cartera, un nodo que deja de contestar, una pestana cerrada. Volver a
 * empezar desde cero significaria crear otra vez la pool y mintear otra vez los
 * muros con los tokens que queden, que es como se pierde dinero de verdad.
 *
 * La nota de aqui abajo NO es la fuente de la verdad: solo guarda que id de NFT
 * mirar. Lo que cuenta es lo que responde la cadena. */
const PROG_KEY = "arclauncher.progreso";
function progTodo() { try { return JSON.parse(localStorage.getItem(PROG_KEY) || "{}"); } catch { return {}; } }
function progLeer(dir) { return progTodo()[String(dir).toLowerCase()] || { pos: {} }; }
function apuntar(dir, i, campos) {
  const t = progTodo(), k = String(dir).toLowerCase();
  const cur = t[k] || { pos: {} };
  cur.pos = cur.pos || {};
  cur.pos[i] = Object.assign({}, cur.pos[i], campos);
  t[k] = cur;
  try { localStorage.setItem(PROG_KEY, JSON.stringify(t)); } catch {}
}
function apuntarQuema(dir) {
  const t = progTodo(), k = String(dir).toLowerCase();
  t[k] = Object.assign({ pos: {} }, t[k], { quema: true });
  try { localStorage.setItem(PROG_KEY, JSON.stringify(t)); } catch {}
}

/* Que parte del plan esta YA en la cadena. positions(id) contesta aunque el NFT
 * ya no sea tuyo, asi que una posicion bloqueada -- que vive en su locker -- se
 * detecta igual que una que sigue en tu cartera. */
async function yaHecho(dir, s, acciones, log) {
  const out = { pool: false, pos: {}, quema: false };
  const nota = progLeer(dir);
  out.quema = !!nota.quema;

  try {
    const [pool] = await callRead(ARC.v3Factory, FACTORY_ABI, "getPool", [s.token0, s.token1, PLAN.fee]);
    out.pool = !!pool && pool !== ethers.ZeroAddress;
  } catch (e) {
    log("could not check whether the pool exists \u2014 assuming it does not", "err");
  }

  for (let i = 0; i < acciones.length; i++) {
    const g = nota.pos && nota.pos[i];
    if (!g || !g.id) continue;
    try {
      const p = await callRead(ARC.positionManager, NFPM_ABI, "positions", [BigInt(g.id)]);
      const mismoPar = String(p[2]).toLowerCase() === s.token0.toLowerCase() &&
                       String(p[3]).toLowerCase() === s.token1.toLowerCase() &&
                       Number(p[4]) === PLAN.fee;
      const mismoRango = Number(p[5]) === acciones[i].lower && Number(p[6]) === acciones[i].upper;
      if (mismoPar && mismoRango && BigInt(p[7]) > 0n) {
        out.pos[i] = { minted: true, locked: !!g.locked, id: String(g.id) };
      }
    } catch { /* si no contesta, se trata como no hecha: reintentar es recuperable */ }
  }

  /* Sin nota (otro navegador, historial borrado) todavia se puede reconocer una
   * posicion por su rango entre las que tienes. Las BLOQUEADAS no: ya no son
   * tuyas y no salen en esta lista. Se dice, no se calla. */
  const sinNota = acciones.map((a, i) => i).filter((i) => !out.pos[i]);
  if (sinNota.length && out.pool) {
    try {
      const [n] = await callRead(ARC.positionManager, NFPM_ABI, "balanceOf", [account]);
      for (let k = 0; k < Number(n); k++) {
        const [id] = await callRead(ARC.positionManager, NFPM_ABI, "tokenOfOwnerByIndex", [account, k]);
        const p = await callRead(ARC.positionManager, NFPM_ABI, "positions", [id]);
        if (String(p[2]).toLowerCase() !== s.token0.toLowerCase()) continue;
        if (String(p[3]).toLowerCase() !== s.token1.toLowerCase()) continue;
        if (Number(p[4]) !== PLAN.fee || BigInt(p[7]) === 0n) continue;
        for (const i of sinNota) {
          if (out.pos[i]) continue;
          if (Number(p[5]) === acciones[i].lower && Number(p[6]) === acciones[i].upper) {
            out.pos[i] = { minted: true, locked: false, id: String(id) };
            apuntar(dir, i, { minted: true, id: String(id), lower: acciones[i].lower, upper: acciones[i].upper });
          }
        }
      }
      const bloq = acciones.map((a, i) => i).filter((i) => !out.pos[i] && acciones[i].p.bloquear);
      if (bloq.length) {
        log("note: a locked position is no longer in your wallet, so it cannot be found this way \u2014 " +
            "if one of the walls is already locked, it would be minted again", "err");
      }
    } catch { /* la lista es una ayuda, no un requisito */ }
  }
  return out;
}

async function ejecutarPlan() {
  const log = logger("pLog");
  const btn = $("#pRun");
  btn.disabled = true;
  try {
    leerPlan();
    /* LOS DECIMALES, DERIVADOS UNA VEZ Y USADOS EN TODAS PARTES.
     *
     * PLAN.decimals lo escribe la lectura de un token existente y nada lo
     * devolvia a 18. Asi que pegabas un token de 6, cambiabas de idea, elegias
     * "Deploy a new one" y el token nuevo salia con 18 decimales -- eso lo fija
     * el contrato -- pero la pool se abria con 6: un factor de 1e12 sobre el
     * precio que la tabla acababa de imprimir, y los muros minteados con la
     * billonesima parte de los tokens. Sin revertir.
     *
     * Y ?? en vez de ||, porque un token de 0 decimales es legitimo y con ||
     * se convertia en uno de 18. */
    const DEC = decDelPlan();
    const r = planResumen(PLAN);
    if (PLAN.modo === "existente") r.pasos -= 1;   // no hay despliegue que firmar
    if (!signer) { log("connect a wallet first"); await connect(); }
    if (!signer) { log("no wallet — nothing was done", "err"); return; }

    const cfg = {
      name: PLAN.nombre, symbol: PLAN.símbolo, supply: String(PLAN.supply), decimals: DEC,
      ownership: "keep", metaMode: "inline", metaMutable: PLAN.metadataEditable,
      metaImage: PLAN.imagen, metaDescription: PLAN.descripción,
      metaWebsite: PLAN.web, metaTwitter: PLAN.twitter, metaTelegram: PLAN.telegram,
      taxBps: 0, taxCeilingBps: 1000, maxSupply: "0", maxTxAmount: "0", maxWalletAmount: "0",
    };
    for (const f of FEATURES) cfg[f.id] = false;

    /* El contador de firmas es de todo el plan, no del despliegue. Vivio un rato
     * dentro del else y con un token que ya existe no llegaba a declararse:
     * "firma is not defined" en la primera linea de despues del if. */
    let paso = 0;
    const firma = (q) => { paso++; log("sign " + paso + " of " + r.pasos + ": " + q); };

    let dir;
    if (PLAN.modo === "existente") {
      if (!PLAN.tokenExistente) throw new Error("paste the token address first");
      dir = PLAN.tokenExistente;
      log("using a token that already exists: " + dir);
      log(PLAN.símbolo + " · " + PLAN.supply.toLocaleString("es") + " supply · " + PLAN.decimals + " decimals");
      /* Sin esto el token no aparecia en "what you launched", que es justo donde
       * se van a manejar las posiciones que este plan le acaba de crear. */
      remember({ address: dir, name: PLAN.nombre, symbol: PLAN.símbolo,
                 decimals: decDelPlan(), image: PLAN.imagen,
                 at: new Date().toISOString() });
    } else {
    log("compiling " + PLAN.símbolo + "…");
    const file = await compileAll(generateSource(cfg), log);
    const nombre = Object.keys(file)[0];
    const c = file[nombre];
    log("compiled: " + (c.evm.bytecode.object.length / 2) + " bytes", "ok");

    firma("deploy the token");
    const tk = await new ethers.ContractFactory(c.abi, "0x" + c.evm.bytecode.object, signer).deploy();
    await tk.waitForDeployment();
    dir = await tk.getAddress();
    log("token at " + dir, "ok");
    remember({ address: dir, name: PLAN.nombre, symbol: PLAN.símbolo, decimals: DEC,
               abi: c.abi, image: PLAN.imagen, at: new Date().toISOString() });
    }

    const s = sortPair(dir, QUOTE.address);
    const sq = sqrtPriceX96From(precioDe(PLAN), DEC, QUOTE.decimals, s.aIsZero);
    log(PLAN.símbolo + " sorted as token" + (s.aIsZero ? "0" : "1"));
    const nfpm = new ethers.Contract(ARC.positionManager, NFPM_ABI, signer);
    const tickSpot = tickFromPrice(precioDe(PLAN), DEC, QUOTE.decimals, s.aIsZero);

    /* Las cuentas se hacen ANTES de pedir la primera firma. Asi el contador
     * puede contar solo lo que falta, y "sign 1 of 2" sigue siendo verdad en un
     * plan que ya iba por la mitad. */
    const acciones = r.posiciones.map((p) => {
      const lo0 = tickFromPrice(p.min, DEC, QUOTE.decimals, s.aIsZero);
      const hi0 = tickFromPrice(p.max, DEC, QUOTE.decimals, s.aIsZero);
      const amtTok = p.tokens > 0 ? ethers.parseUnits(String(Math.floor(p.tokens)), DEC) : 0n;
      const amtUsd = p.usdc > 0 ? ethers.parseUnits(String(p.usdc), QUOTE.decimals) : 0n;
      /* Un muro lleva solo el token; el suelo lleva solo USDC. Cual de los dos
       * es token0 lo decide el orden de las direcciones, no una suposicion. */
      const soloToken0 = p.usdc > 0 ? !s.aIsZero : s.aIsZero;
      const ap = apartarDelPrecio(usable(Math.min(lo0, hi0), 200, "down"),
                                  usable(Math.max(lo0, hi0), 200, "up"),
                                  Math.floor(tickSpot), 200, soloToken0);
      return {
        p,
        lower: ap.lower,
        upper: ap.upper,
        a0: s.aIsZero ? amtTok : amtUsd,
        a1: s.aIsZero ? amtUsd : amtTok,
      };
    });

    log("checking what is already on chain\u2026");
    const hecho = await yaHecho(dir, s, acciones, log);

    /* QUE QUEDA POR HACER, DECIDIDO ANTES DE CONTAR NADA.
     * El saldo se mira aqui, no dentro del bucle de firmas, porque una posicion
     * que se va a saltar no puede contarse entre las que vas a firmar. */
    const pendientes = [];
    for (let i = 0; i < acciones.length; i++) {
      const a = acciones[i], ya = hecho.pos[i];
      log("\u2014 " + a.p.etiqueta + ": ticks " + a.lower + " \u2192 " + a.upper +
          (ya && ya.minted ? "   already there, #" + ya.id : ""));
      if (ya && ya.minted) continue;
      const falta = await noAlcanza(s, a.a0, a.a1, log);
      if (falta) {
        log(a.p.etiqueta + ": skipped \u2014 " + falta, "err");
        log("   if this wall is already placed and locked, that is expected: " +
            "its tokens left your wallet when it was locked.", "ok");
        continue;
      }
      pendientes.push({ i, ...a });
    }

    /* EL PRECIO DE LA POOL, EXACTO AL DEL PLAN O NO.  (17-sep-2026)
     * Decide si la compra inicial puede ir junto a la pool: cualquier compra
     * mueve el precio, asi que una pool que sigue EXACTAMENTE en el sqrtPriceX96
     * del plan es una pool en la que nadie ha comprado todavia. Si no se puede
     * leer, cuenta como movida: repetir una compra es peor que saltarsela. */
    let precioIntacto = !hecho.pool;
    if (hecho.pool) {
      log("pool already exists \u2014 not created again", "ok");
      /* Y su precio no es el que dice el plan: la pool ya existia, quiza ya
       * cotizo. Los muros se calcularon contra el precio TEORICO, asi que si el
       * real se ha movido estan en otro sitio del que la tabla dice. Se lee y
       * se avisa; no se corrige por detras. */
      try {
        const [dirPool] = await callRead(ARC.v3Factory, FACTORY_ABI, "getPool", [s.token0, s.token1, PLAN.fee]);
        const s0 = await callRead(dirPool, POOL_ABI, "slot0");
        precioIntacto = BigInt(s0[0]) === sq;
        const real = priceFromTick(Number(s0[1]), DEC, QUOTE.decimals, s.aIsZero);
        const desvio = (real / precioDe(PLAN) - 1) * 100;
        log("   its real price is $" + real.toExponential(4) + " (tick " + Number(s0[1]) + "), " +
            "the plan assumes $" + precioDe(PLAN).toExponential(4));
        if (Math.abs(desvio) > 1) {
          log("   that is " + desvio.toFixed(1) + "% away from the plan. The walls below were " +
              "placed against the plan price, so they sit somewhere else than the table says. " +
              "Set the market cap to match, or check the ranges before signing.", "err");
        }
      } catch { log("   could not read its current price", "err"); }
    }

    /* LA COMPRA INICIAL: ATOMICA, O LA MAS RAPIDA POSIBLE.  (17-sep-2026)
     * El dueño: "en vez de suelo pon compra atomica y si no puede ser atomica,
     * lo mas rapido".
     *   atomica       el muro aun no esta y la pool no existe (o sigue intacta):
     *                 un contrato de un solo uso crea la pool, pone el muro y
     *                 compra en UNA transaccion. Ver compra-atomica.js.
     *   compraSuelta  el muro ya esta puesto y la pool sigue intacta, o sea que
     *                 nadie ha comprado: ya no puede ir junto, se compra YA, en
     *                 su propia transaccion, contra el router.
     *   ninguna       la pool ya ha operado: una "primera" compra no seria la
     *                 primera. Se dice y no se hace. */
    const compraUsd = compraDe(PLAN);
    const amtCompra = compraUsd > 0 ? ethers.parseUnits(String(compraUsd), QUOTE.decimals) : 0n;
    const muroYaPuesto = acciones.some((a, i) => hecho.pos[i] && hecho.pos[i].minted);
    const atomica = amtCompra > 0n && pendientes.length === 1 && precioIntacto;
    const compraSuelta = amtCompra > 0n && pendientes.length === 0 && muroYaPuesto && hecho.pool && precioIntacto;
    if (amtCompra > 0n && !atomica && !compraSuelta) {
      log(hecho.pool && !precioIntacto
        ? "first buy skipped: the pool is not at the plan price any more, so somebody has already traded or created it — buy from Trade if you still want to"
        : "first buy skipped: the wall is not going to be placed on this run, so there is nothing to buy from", "err");
    }
    if (atomica || compraSuelta) {
      /* El saldo ANTES de la primera firma. El USDC de Arc es tambien el gas,
       * asi que la cartera tiene que tener la compra y algo mas. */
      try {
        const [bal] = await callRead(QUOTE.address, ERC20_ABI, "balanceOf", [account]);
        if (BigInt(bal) < amtCompra) {
          throw new Error("the first buy needs $" + compraUsd + " USDC and the wallet holds $" +
                          ethers.formatUnits(bal, QUOTE.decimals) + " — nothing was signed");
        }
      } catch (e) { if (!e.empty && /first buy needs/.test(e.message)) throw e; }
    }
    let routerAprobado = false;
    if (compraSuelta) {
      try {
        const [cur] = await callRead(QUOTE.address, ERC20_ABI, "allowance", [account, ARC_SWAP_ROUTER]);
        routerAprobado = BigInt(cur) >= amtCompra;
      } catch { /* sin leer, se pide la aprobacion: firmar una de mas no pierde nada */ }
    }

    /* EL CONTADOR, CON LO QUE DE VERDAD SE VA A FIRMAR. */
    const necesita0 = pendientes.some((q) => q.a0 > 0n);
    const necesita1 = pendientes.some((q) => q.a1 > 0n);
    const hayLote = pendientes.length > 0 || !hecho.pool;
    const bloqueosPendientes = acciones.reduce((n, a, i) => {
      const y = hecho.pos[i];
      const seVaAMintear = pendientes.some((q) => q.i === i);
      if (!a.p.bloquear) return n;
      if (y && y.locked) return n;
      return (y && y.minted) || seVaAMintear ? n + 2 : n;
    }, 0);
    r.pasos = (necesita0 ? 1 : 0) + (necesita1 ? 1 : 0) + (hayLote ? 1 : 0) +
              (atomica ? 1 : 0) + (compraSuelta ? (routerAprobado ? 1 : 2) : 0) +
              bloqueosPendientes + (r.quema > 0 && !hecho.quema ? 1 : 0);
    const hechas = acciones.length - pendientes.length;
    if (hechas || hecho.pool) {
      log("resuming: " + (hecho.pool ? "pool exists, " : "") + hechas + " of " +
          acciones.length + " positions already there \u2014 " + r.pasos + " signature" +
          (r.pasos === 1 ? "" : "s") + " left", "ok");
    }
    if (r.pasos === 0) { log("nothing left to do \u2014 this plan is already complete", "ok"); }

    /* UNA APROBACION POR MONEDA, NO UNA POR POSICION.
     * El permiso es una cifra acumulada, no un permiso por operacion: se suma
     * lo que necesitan todas las posiciones que faltan y se pide una vez. */
    const total0 = pendientes.reduce((a, q) => a + q.a0, 0n);
    const total1 = pendientes.reduce((a, q) => a + q.a1, 0n);

    if (atomica) {
      const q = pendientes[0];
      const hecha = await lanzarConCompraAtomica({ s, sq, q, amtCompra, compraUsd, DEC, firma, log });
      apuntar(dir, q.i, { minted: true, id: hecha.id === null ? null : String(hecha.id), lower: q.lower, upper: q.upper });
      hecho.pos[q.i] = { minted: true, locked: false, id: hecha.id === null ? null : String(hecha.id) };
      hecho.pool = true;
    }

    if (!atomica) {
    if (total0 > 0n) { firma("approve token0 once, for every position"); await approveIfNeeded(s.token0, total0, log, "token0"); }
    if (total1 > 0n) { firma("approve token1 once, for every position"); await approveIfNeeded(s.token1, total1, log, "token1"); }

    /* LA POOL Y TODOS LOS MINTS, EN UNA SOLA TRANSACCION.
     *
     * multicall() hace delegatecall sobre el propio position manager, asi que
     * todo esto ocurre en un bloque, o no ocurre nada. Trece firmas eran trece
     * ventanas y trece oportunidades de que una fallara por la mitad y te
     * dejara una pool a medio construir. Y sale mas barato: una sola vez el
     * coste base de la transaccion.
     *
     * Lo que NO va aqui son los bloqueos. Meterlos exigiria conocer los ids de
     * los NFT antes de que existan, prediciendolos desde un contador; se leen
     * del recibo despues, que es exacto. Un locker que ahorra dos firmas a
     * cambio de adivinar un id no es un ahorro. */
    if (hayLote) {
      const llamadas = [];
      if (!hecho.pool) {
        llamadas.push(nfpm.interface.encodeFunctionData(
          "createAndInitializePoolIfNecessary", [s.token0, s.token1, PLAN.fee, sq]));
      }
      for (const q of pendientes) {
        llamadas.push(nfpm.interface.encodeFunctionData("mint", [{
          token0: s.token0, token1: s.token1, fee: PLAN.fee,
          tickLower: q.lower, tickUpper: q.upper,
          amount0Desired: q.a0, amount1Desired: q.a1, amount0Min: 0, amount1Min: 0,
          recipient: account, deadline: Math.floor(Date.now() / 1000) + 1800,
        }]));
      }
      firma((hecho.pool ? "" : "create the pool and ") + "mint " + pendientes.length +
            " position" + (pendientes.length === 1 ? "" : "s") + " in one transaction");
      const rec = await (await nfpm.multicall(llamadas)).wait();
      const ids = idsDelRecibo(rec);
      if (ids.length !== pendientes.length) {
        log("minted " + pendientes.length + " positions but read " + ids.length +
            " ids from the receipt \u2014 the ones without an id have to be locked by hand", "err");
      }
      pendientes.forEach((q, k) => {
        const id = k < ids.length ? ids[k] : null;
        apuntar(dir, q.i, { minted: true, id: id === null ? null : String(id), lower: q.lower, upper: q.upper });
        hecho.pos[q.i] = { minted: true, locked: false, id: id === null ? null : String(id) };
        log("   " + q.p.etiqueta + " done" + (id === null ? "" : ", #" + id), "ok");
      });
    }
    }

    /* Si ya no podia ir junto, la compra va AHORA, antes que los bloqueos: cada
     * segundo que la pool pasa sin ella es un segundo para que compre otro. */
    if (compraSuelta) {
      await compraInicialSuelta({ dir, amtCompra, compraUsd, routerAprobado, firma, log });
    }

    /* Y los bloqueos, uno a uno, porque cada uno despliega su propio locker. */
    for (let i = 0; i < acciones.length; i++) {
      const { p } = acciones[i];
      const ya = hecho.pos[i];
      if (!p.bloquear || !ya || !ya.minted || ya.locked) continue;
      if (!ya.id) { log(p.etiqueta + ": no id for it \u2014 lock it by hand from Your liquidity", "err"); continue; }
      const idNft = BigInt(ya.id);
      const fecha = new Date(Date.now() + p.meses * 30 * 24 * 3600 * 1000);
      firma("deploy the locker for " + p.etiqueta);
      firma("send position #" + idNft + " into it");
      /* Solo se apunta si de verdad se bloqueo. lockPosition se come sus
       * propios errores, asi que apuntarlo a ciegas dejaba una posicion marcada
       * como bloqueada para siempre, sin estarlo. */
      const ok = await lockPosition(idNft, fecha.toISOString().slice(0, 10), $("#pLog"));
      if (ok) apuntar(dir, i, { locked: true });
      else log(p.etiqueta + ": not locked \u2014 the position is yours and unlocked. " +
               "Run again, or lock it by hand from Your liquidity.", "err");
    }

    if (r.quema > 0 && !hecho.quema) {
      firma("burn " + Math.round(r.sobrante) + "% of the supply");
      const erc = new ethers.Contract(dir, ["function transfer(address,uint256) returns (bool)"], signer);
      await (await erc.transfer(ARC.deadAddress, ethers.parseUnits(String(Math.floor(r.quema)), DEC))).wait();
      log("burnt " + Math.round(r.sobrante) + "% to " + ARC.deadAddress, "ok");
      apuntarQuema(dir);
    }

    log("PLAN COMPLETE — token " + dir, "ok");
    $("#poolTokenA").value = dir;
    onPairChange(); renderTokenList(); loadPositions(); pintarMios();
  } catch (e) {
    log(readableError(e), "err");
    log("stopped here \u2014 a later step makes no sense if this one failed", "err");
    log("nothing before this was lost. Press Run again and it picks up where it " +
        "stopped: what is already on chain is read back and not repeated.", "ok");
  } finally { btn.disabled = false; }
}

/* Los ids de los NFT creados, del propio recibo y EN ORDEN. El Transfer del
 * position manager desde la direccion cero lleva el tokenId en topics[3].
 *
 * En plural desde que los mints viajan juntos: un recibo trae ahora varios, y
 * el orden de los logs es el orden en que se ejecutaron. Se leen; NO se
 * predicen desde un contador, que parece equivalente y deja de serlo en cuanto
 * alguien mintea entre que miras y firmas. */
function idsDelRecibo(rec) {
  const T = ethers.id("Transfer(address,address,uint256)");
  const CERO = "0x" + "0".repeat(64);
  const out = [];
  for (const l of rec.logs || []) {
    if (String(l.address).toLowerCase() !== ARC.positionManager.toLowerCase()) continue;
    if (l.topics[0] !== T || l.topics.length < 4) continue;
    if (l.topics[1] !== CERO) continue;          // solo los recien creados
    out.push(BigInt(l.topics[3]));
  }
  return out;
}
function idDelRecibo(rec) {
  const t = idsDelRecibo(rec);
  return t.length ? t[0] : null;
}

/* ── LA POOL, EL MURO Y LA COMPRA EN UNA TRANSACCION ─────────────────────
 * Todo lo que importa del contrato esta en compra-atomica.js. Aqui:
 *
 * 1. LA DIRECCION DEL LANZADOR SE CONOCE ANTES DE QUE EXISTA: la da la cartera y
 *    el nonce con el que se va a desplegar. Las dos aprobaciones gastan dos
 *    nonces, asi que se despliega con el tercero, y a esa direccion se aprueba.
 * 2. ANTES DE DESPLEGAR SE COMPRUEBA QUE EL NONCE ES EL PREVISTO. Si la cartera
 *    mando otra cosa entre medias, el lanzador caeria en otra direccion sin
 *    permisos y revertiria: se para antes, sin gastar mas que las aprobaciones,
 *    que apuntan a una direccion que ya nunca puede tener codigo.
 * 3. Aprobaciones EXACTAS, no ilimitadas, como el resto de la pagina. */
async function lanzarConCompraAtomica({ s, sq, q, amtCompra, compraUsd, DEC, firma, log }) {
  log("compiling the one-shot launcher: pool, wall and first buy in one transaction…");
  const file = await compileAll(COMPRA_ATOMICA_SOURCE, log);
  const c = file.AtomicLaunch;
  if (!c) throw new Error("the one-shot launcher did not compile — nothing was signed");
  log("launcher compiled: " + (c.evm.bytecode.object.length / 2) + " bytes", "ok");

  const tokenMuro = q.a0 > 0n ? s.token0 : s.token1;
  const cantMuro = q.a0 > 0n ? q.a0 : q.a1;
  if (cantMuro <= 0n) throw new Error("the wall holds no tokens — nothing was signed");

  const leerNonce = () => provider.getTransactionCount(account, "pending");
  const n0 = await leerNonce();
  const APROBACIONES = 2;
  const esperado = n0 + APROBACIONES;
  const lanzador = ethers.getCreateAddress({ from: account, nonce: esperado });
  log("the launcher will be deployed at " + lanzador + " (nonce " + esperado + ")");

  const tok = new ethers.Contract(tokenMuro, ERC20_ABI, signer);
  const usd = new ethers.Contract(QUOTE.address, ERC20_ABI, signer);
  firma("approve exactly the wall's " + PLAN.símbolo + " to the launcher");
  await (await tok.approve(lanzador, cantMuro)).wait();
  log("wall tokens approved", "ok");
  firma("approve exactly $" + compraUsd + " USDC to the launcher, for the first buy");
  await (await usd.approve(lanzador, amtCompra)).wait();
  log("USDC for the first buy approved", "ok");

  /* El nodo de la cartera puede tardar un momento en contar el ultimo recibo. */
  let n1 = await leerNonce();
  for (let k = 0; k < 10 && n1 < esperado; k++) {
    await new Promise((ok) => setTimeout(ok, 1000));
    n1 = await leerNonce();
  }
  if (n1 !== esperado) {
    throw new Error("the wallet's next nonce is " + n1 + ", not " + esperado + ": another transaction " +
                    "went out in between, so the launcher would land at an address with no approvals. " +
                    "Nothing was bought and no pool was created — press Run again.");
  }

  const plan = {
    manager: ARC.positionManager, router: ARC_SWAP_ROUTER,
    token0: s.token0, token1: s.token1, fee: PLAN.fee, sqrtPriceX96: sq,
    tickLower: q.lower, tickUpper: q.upper, amount0: q.a0, amount1: q.a1,
    quote: QUOTE.address, buyAmount: amtCompra, minOut: 0n,
  };
  firma("create the pool, place the wall and buy $" + compraUsd + " — one transaction, nobody buys in between");
  const contrato = await new ethers.ContractFactory(c.abi, "0x" + c.evm.bytecode.object, signer).deploy(plan);
  const rec = await contrato.deploymentTransaction().wait();
  const real = (await contrato.getAddress()).toLowerCase();
  if (real !== lanzador.toLowerCase()) {
    log("the launcher landed at " + real + ", not at " + lanzador + " — it could only have worked if " +
        "the approvals matched, so check the transaction", "err");
  }

  const id = idDelRecibo(rec);
  let comprados = null;
  const iface = new ethers.Interface(c.abi);
  for (const l of rec.logs || []) {
    if (String(l.address).toLowerCase() !== real) continue;
    try {
      const ev = iface.parseLog(l);
      if (ev && ev.name === "Launched") comprados = ev.args.tokensBought;
    } catch { /* otro evento */ }
  }
  log("pool created and wall placed" + (id === null ? "" : ", #" + id) + " — tx " + rec.hash, "ok");
  log(comprados === null
    ? "first buy of $" + compraUsd + " done in the same transaction"
    : "first buy: $" + compraUsd + " → " + Number(ethers.formatUnits(comprados, DEC)).toLocaleString("es") +
      " " + PLAN.símbolo + ", in the same transaction — nobody bought before you", "ok");
  return { id, comprados, rec };
}

/* LA COMPRA INICIAL CUANDO YA NO PUEDE SER ATOMICA: la mas rapida posible.
 * Solo se llega aqui con el muro ya puesto y la pool en el precio exacto del
 * plan, o sea sin ninguna compra todavia. El minimo sale del Quoter con un 15 %
 * de margen: protege de que alguien se cuele con una compra grande, y no hace
 * revertir por el movimiento normal de unos segundos. */
async function compraInicialSuelta({ dir, amtCompra, compraUsd, routerAprobado, firma, log }) {
  log("the wall is already in place without a first buy, so it can no longer be atomic — buying right now instead", "err");
  const DEC = decDelPlan();
  if (!routerAprobado) {
    firma("approve exactly $" + compraUsd + " USDC to the swap router");
    const usd = new ethers.Contract(QUOTE.address, ERC20_ABI, signer);
    await (await usd.approve(ARC_SWAP_ROUTER, amtCompra)).wait();
  }
  let minOut = 0n;
  try {
    const cot = await callRead(ARC_QUOTER, QUOTER_ABI, "quoteExactInputSingle",
      [{ tokenIn: QUOTE.address, tokenOut: dir, amountIn: amtCompra, fee: PLAN.fee, sqrtPriceLimitX96: 0 }]);
    minOut = (BigInt(cot[0]) * 85n) / 100n;
  } catch { log("could not quote the buy first — buying without a minimum", "err"); }
  firma("buy $" + compraUsd + " of " + PLAN.símbolo);
  const router = new ethers.Contract(ARC_SWAP_ROUTER, ROUTER_ABI, signer);
  const rec = await (await router.exactInputSingle({
    tokenIn: QUOTE.address, tokenOut: dir, fee: PLAN.fee, recipient: account,
    amountIn: amtCompra, amountOutMinimum: minOut, sqrtPriceLimitX96: 0,
  })).wait();
  log("first buy of $" + compraUsd + " done — tx " + rec.hash + (minOut > 0n
    ? " (at least " + Number(ethers.formatUnits(minOut, DEC)).toLocaleString("es") + " " + PLAN.símbolo + ")" : ""), "ok");
}

/* ── 6b · lo que lanzaste ──────────────────────────────────────────────── */

async function pintarMios() {
  const box = $("#mineList");
  box.textContent = "";
  const list = saved();
  if (!list.length) {
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = "Nothing launched from this browser yet.";
    box.append(p); return;
  }
  for (const t of list) {
    const el = document.createElement("div"); el.className = "pos";
    const head = document.createElement("div"); head.className = "pos-head";
    const nm = document.createElement("span"); nm.className = "pos-pair";
    nm.textContent = (t.name || "?") + " · " + (t.symbol || "?");
    const ad = document.createElement("span"); ad.className = "pos-id"; ad.textContent = t.address;
    head.append(nm, ad);
    el.append(head);

    const acc = document.createElement("div"); acc.className = "pos-actions";
    const mk = (txt, cls, fn) => { const b = document.createElement("button"); b.className = "btn btn-sm " + (cls || ""); b.textContent = txt; b.addEventListener("click", fn); return b; };
    const log = document.createElement("div"); log.className = "log"; log.hidden = true;
    acc.append(
      mk("Its positions", "", () => { goStep(5); loadPositions(); }),
      mk("What it can do", "", async () => {
        const d = document.createElement("div"); d.className = "inspect";
        el.append(d); d.textContent = "reading…";
        try { const info = await inspect(t.address); if (t.abi) info.abi = t.abi; renderInspect(d, info); }
        catch (e) { d.textContent = readableError(e); }
      }),
      mk("Use in a pool", "", () => { $("#poolTokenA").value = t.address; onPairChange(); goStep(2); }),
    );
    el.append(acc, log);
    box.append(el);
  }
}


/* ── 7 · la cartera rapida y su cluster ─────────────────────────────────── */

/* ── QUE SE QUEDE COMO LO DEJAS ──────────────────────────────────────────
 *
 * Las carteras del cluster salian nuevas en cada visita, y el dueno lo dijo
 * asi: "cada vez que entro se generan nuevas?". No se generaban nuevas -- se
 * derivan por indice, asi que la #3 es SIEMPRE la misma direccion -- lo que se
 * perdia era CUANTAS habia, y sin ese numero no se volvia a derivar ninguna.
 *
 * Asi que se guarda ese numero. Y NADA MAS que hace falta: ni una clave, ni la
 * frase, ni nada de lo que se firma. La clave sale de tu firma y no se escribe
 * en ningun sitio -- eso no cambia. Aqui solo hay un contador y lo que habias
 * tecleado en las tarjetas, que es comodidad, no secreto.
 *
 * Va por direccion principal: dos carteras en el mismo navegador no se pisan
 * los cluster. */
/* LAS MONEDAS QUE YA HAS OPERADO.
 * Se guardan al leerlas bien, y vuelven en el desplegable del campo. Se busca
 * por SIMBOLO porque nadie recuerda una direccion: escribes "da" y sale DAGG.
 * Solo entra lo que la cadena confirmo -- simbolo, decimales y su pool -- asi
 * que la lista no puede llenarse de direcciones que no van a ninguna parte. */
const MONEDAS_KEY = "arclauncher.monedas";
function monedasTodas() {
  try { return JSON.parse(localStorage.getItem(MONEDAS_KEY) || "[]"); } catch { return []; }
}
function monedaRecordar(t) {
  const antes = monedasTodas();
  const previo = antes.find((x) => x.address.toLowerCase() === t.address.toLowerCase());
  const lista = antes.filter((x) => x.address.toLowerCase() !== t.address.toLowerCase());
  lista.unshift({
    address: t.address, symbol: t.symbol, decimals: t.decimals,
    /* Lo que se sepa del saldo se conserva si esta llamada no lo trae: pegar una
     * direccion a mano no deberia borrar lo que la deteccion averiguo. */
    tiene: t.tiene !== undefined ? t.tiene : (previo ? previo.tiene : undefined),
    cuanto: t.cuanto !== undefined ? t.cuanto : (previo ? previo.cuanto : undefined),
  });
  try { localStorage.setItem(MONEDAS_KEY, JSON.stringify(lista.slice(0, 40))); } catch {}
  pintarMonedas();
}

/* Cuanto de cada moneda hay entre TODAS las carteras. Se usa para marcar la
 * lista, asi que un fallo de lectura no puede tumbarla: se devuelve null y esa
 * moneda sale sin marca en vez de salir como "no tienes". */
async function saldoTotalDe(dirToken, decimals) {
  const carteras = rápida ? [rápida, ...clúster] : clúster.slice();
  if (!carteras.length) return null;
  let total = 0n;
  for (const w of carteras) {
    try { const [b] = await callRead(dirToken, ERC20_ABI, "balanceOf", [w.address]); total += BigInt(b); }
    catch { return null; }
  }
  return Number(ethers.formatUnits(total, decimals));
}
function pintarMonedas() {
  const dl = $("#trSaved");
  if (!dl) return;
  dl.textContent = "";
  /* LAS QUE TIENES, PRIMERO. Son las que se van a vender, y buscarlas entre
   * veinte que ya vendiste es el trabajo que esta lista existe para evitar. */
  const lista = monedasTodas().slice().sort((a, b) => (b.tiene ? 1 : 0) - (a.tiene ? 1 : 0));
  for (const m of lista) {
    const o = document.createElement("option");
    /* El VALOR es el simbolo, no la direccion: los navegadores filtran un
     * datalist por el valor, asi que con la direccion ahi escribir "da" no
     * casaria con nada. Todo lo demas va en la etiqueta, que se ve al lado.
     *
     * La marca va en TEXTO y no en color: un datalist no deja pintar sus
     * opciones -- lo dibuja el sistema operativo -- asi que un color se
     * quedaria en una promesa que el navegador no cumple. */
    o.value = m.symbol;
    const marca = m.tiene === true ? "● holding" : m.tiene === false ? "○ empty" : "·";
    const cuanto = m.tiene === true && typeof m.cuanto === "number"
      ? "  " + m.cuanto.toLocaleString("es", { maximumFractionDigits: 0 }) : "";
    o.label = marca + cuanto + "   " + m.address;
    dl.append(o);
  }
}
/* Lo escrito puede ser una direccion o un simbolo ya conocido. */
function resolverMoneda(txt) {
  const t = String(txt || "").trim();
  if (ethers.isAddress(t)) return t;
  const m = monedasTodas().find((x) => String(x.symbol).toLowerCase() === t.toLowerCase());
  return m ? m.address : null;
}

const MEM_KEY = "arclauncher.cluster";
/* LO GASTADO, POR CARTERA Y POR MONEDA.
 * -----------------------------------------------------------------------
 * Un "+12%" necesita un punto de partida, y el punto de partida es lo que
 * pusiste. Se apunta al comprar, se descuenta al vender, y no se deduce de
 * nada: deducir el coste de un saldo actual es como se pintan ganancias que
 * no existen. Si no hay apunte, no hay porcentaje -- y se dice, en vez de
 * ensenar un cero que parece una medicion. */
const COSTE_KEY = "arclauncher.coste";
function costeTodo() {
  try { return JSON.parse(localStorage.getItem(COSTE_KEY) || "{}"); } catch { return {}; }
}
function costeClave(dirCartera, dirToken) {
  return String(dirCartera).toLowerCase() + "|" + String(dirToken).toLowerCase();
}
/* PUESTO Y SACADO POR SEPARADO, y nunca se borra ninguno.
 * -----------------------------------------------------------------------
 * Antes se guardaba un solo "coste" y al vender entero se BORRABA. Con eso la
 * ganancia realizada desaparecia: vendias con beneficio y la herramienta se
 * quedaba sin nada que ensenar, como si no hubiera pasado. Medido en las
 * carteras del dueno: 61 swaps, $255,57 puestos y $277,95 sacados -- +$22,38
 * que el modelo viejo no podia representar porque no quedaba nada abierto.
 *
 * Con las dos mitades sale todo de la misma resta:
 *     ganancia = lo que vale ahora + lo sacado - lo puesto
 * Vale abierta, cerrada y a medias, sin llevar inventario de tokens. */
function costeLeer(dirCartera, dirToken) {
  const v = costeTodo()[costeClave(dirCartera, dirToken)];
  if (!v) return null;
  /* Compatible con lo guardado antes, que solo tenia `usdc`. */
  if (typeof v.puesto === "number") return v;
  if (typeof v.usdc === "number") return { puesto: v.usdc, sacado: 0 };
  return null;
}
function costeAnotar(dirCartera, dirToken, puesto, sacado) {
  const t = costeTodo(), k = costeClave(dirCartera, dirToken);
  const antes = costeLeer(dirCartera, dirToken) || { puesto: 0, sacado: 0 };
  t[k] = { puesto: antes.puesto + (puesto || 0), sacado: antes.sacado + (sacado || 0) };
  try { localStorage.setItem(COSTE_KEY, JSON.stringify(t)); } catch {}
}

function memTodo() {
  try { return JSON.parse(localStorage.getItem(MEM_KEY) || "{}"); } catch { return {}; }
}
function memLeer() {
  if (!cuentaPrincipal) return null;
  return memTodo()[cuentaPrincipal.toLowerCase()] || null;
}
function memGuardar() {
  if (!cuentaPrincipal) return;
  /* CADA FILA GUARDA A QUIÉN PERTENECE, y no es un adorno.
   * ---------------------------------------------------------------------
   * Esto era un array y se leía por POSICIÓN (`g.filas[i]`), o sea que la
   * primera tarjeta era la #0, la segunda la #1… Al meter la rápida principal
   * delante, la posición 0 pasa a ser suya y TODAS las hijas habrían leído el
   * importe y el tick de la de al lado. No da ningún error: sólo aparecen
   * cantidades cambiadas de sitio, que es peor.
   *
   * Se guarda `w` (el índice real, "-1" o "0", "1"…) y se busca por él. Lo
   * guardado ANTES de este cambio no lleva `w`, así que se cae a la posición,
   * que para esos datos sigue siendo correcta — no existía la fila de la
   * principal cuando se escribieron. */
  const filas = [];
  document.querySelectorAll("#fwList [data-w]").forEach((el) => {
    filas.push({
      w: el.dataset.w,
      on: el.querySelector(".wSel").checked,
      amt: el.querySelector(".wAmt").value,
      slip: el.querySelector(".wSlip").value,
    });
  });
  const t = memTodo();
  t[cuentaPrincipal.toLowerCase()] = {
    n: clúster.length,
    token: $("#trToken") ? $("#trToken").value.trim() : "",
    filas,
  };
  try { localStorage.setItem(MEM_KEY, JSON.stringify(t)); } catch {}
}

/* UNA FIRMA POR SESION, NO POR RECARGA.
 * -----------------------------------------------------------------------
 * La clave vivia SOLO en memoria, asi que cada F5 pedia firmar otra vez. Era
 * lo mas seguro y tambien lo mas incomodo, y el dueno lo noto enseguida.
 *
 * `sessionStorage` es el punto medio honesto: sobrevive a recargar y a navegar
 * dentro de la pestana, y MUERE al cerrarla. No queda nada en disco, a
 * diferencia de `localStorage`, donde una clave se queda hasta que alguien la
 * borra -- y donde la guarda Cusp, que tiene otro modelo.
 *
 * Va atada a la direccion principal: cambiar de cuenta en la cartera no puede
 * devolver la rapida de la cuenta anterior.
 *
 * LO QUE ESTO NO PROTEGE, dicho para que nadie se confunda: codigo malicioso
 * corriendo en esta misma pagina lee sessionStorage igual que leia la memoria.
 * No cambia el riesgo; cambia cuantas veces firmas. */
const CLAVE_SESION = "arclauncher.fastkey";

function guardarClaveDeSesion(principal, clave) {
  try { sessionStorage.setItem(CLAVE_SESION + "." + String(principal).toLowerCase(), clave); } catch {}
}
function leerClaveDeSesion(principal) {
  try { return sessionStorage.getItem(CLAVE_SESION + "." + String(principal).toLowerCase()); } catch { return null; }
}
function olvidarClaveDeSesion() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(CLAVE_SESION)) sessionStorage.removeItem(k);
    }
  } catch {}
}

async function usarRápida() {
  const guardada = leerClaveDeSesion(cuentaPrincipal);
  if (guardada) {
    /* Se comprueba que sea una clave valida antes de fiarse: un valor a medias
     * en sessionStorage no puede dejar el sitio sin firmante. */
    try {
      const w = new ethers.Wallet(guardada);
      claveMadre = guardada;
      rápida = w.connect(proveedorRPC());
      signer = rápida; account = rápida.address;
      clúster = [];
      const g = memLeer();
      if (g && g.n > 0) clúster = derivarClúster(ethers, claveMadre, Math.min(50, g.n)).map((x) => x.connect(proveedorRPC()));
      if (g && g.token && $("#trToken") && !$("#trToken").value) { $("#trToken").value = g.token; leerTokenDeCompra(); }
      const chip0 = $("#fastChip");
      chip0.hidden = false;
      chip0.textContent = "fast " + account.slice(0, 6) + "…" + account.slice(-4);
      return rápida;
    } catch { olvidarClaveDeSesion(); }
  }
  const d = await derivarMadre(ethers, firmantePrincipal);
  guardarClaveDeSesion(cuentaPrincipal, d.clave);
  claveMadre = d.clave;
  rápida = d.cartera.connect(proveedorRPC());
  signer = rápida;
  account = rápida.address;
  /* Y se recupera lo que habia: el numero de carteras, la moneda que tenias
   * pegada y lo que habias escrito en cada tarjeta. */
  const guardado = memLeer();
  clúster = [];
  if (guardado && guardado.n > 0) {
    clúster = derivarClúster(ethers, claveMadre, Math.min(50, guardado.n)).map((w) => w.connect(proveedorRPC()));
  }
  if (guardado && guardado.token && $("#trToken") && !$("#trToken").value) {
    $("#trToken").value = guardado.token;
    leerTokenDeCompra();
  }
  const chip = $("#fastChip");
  chip.hidden = false;
  chip.textContent = "fast " + account.slice(0, 6) + "…" + account.slice(-4);
  return rápida;
}

const fwLog = () => logger("fwLog");

async function saldoDe(dir) {
  const hex = await rawCall("eth_getBalance", [dir, "latest"]);
  return BigInt(hex);
}

/* El precio del gas, leido y no fijado: la reserva se calcula con el, y una
 * constante escrita a mano se queda vieja el dia que la cadena se mueva. */
async function precioGas() {
  try { return BigInt(await rawCall("eth_gasPrice", [])); } catch { return 20000000000n; }
}

/* En Arc el saldo NATIVO va en 18 decimales y el USDC como ERC-20 en 6. Es el
 * mismo dinero: comprobado en la cadena, la tesoreria de blop tenia 0x b6e8...
 * nativo y 0xc91c por balanceOf, las dos 0,051484. Aqui todo es nativo, asi
 * que 18, y se dice para que nadie divida por 1e6 mirando "USDC". */
const aUSDC = (wei) => Number(ethers.formatUnits(wei, 18));
const deUSDC = (x) => ethers.parseUnits(String(x), 18);

function tarjeta(etiqueta, dir, saldo, nota) {
  const row = document.createElement("div"); row.className = "plan-row";
  const b = document.createElement("b"); b.textContent = etiqueta;
  const sp = document.createElement("span");
  sp.textContent = (dir || "—") + (nota ? "  ·  " + nota : "");
  const c = document.createElement("code");
  c.textContent = saldo === null ? "…" : "$" + aUSDC(saldo).toFixed(4);
  row.append(b, sp, c);
  return row;
}

async function pintarCarteras() {
  const caja = $("#fastCards");
  if (!caja) return;
  caja.textContent = "";
  if (!cuentaPrincipal) {
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = "Connect a wallet first.";
    caja.append(p);
    /* Y el cluster tambien dice lo suyo: salir aqui dejaba su seccion muda, y
       una caja vacia sin una palabra parece rota, no vacia. */
    await pintarClúster();
    return;
  }
  const t = document.createElement("div"); t.className = "plan";
  t.append(tarjeta("MAIN", cuentaPrincipal, null, "cold — signs only the funding"));
  t.append(tarjeta("FAST", rápida ? rápida.address : null, null,
                   rápida ? "signs everything else, no popups" : "not derived — reconnect to sign for it"));
  caja.append(t);
  // los saldos, despues, para que la tabla salga ya y no en blanco
  try {
    const [m, f] = await Promise.all([
      saldoDe(cuentaPrincipal),
      rápida ? saldoDe(rápida.address) : Promise.resolve(null),
    ]);
    t.replaceChildren(
      tarjeta("MAIN", cuentaPrincipal, m, "cold — signs only the funding"),
      tarjeta("FAST", rápida ? rápida.address : null, f,
              rápida ? "signs everything else, no popups" : "not derived — reconnect"),
    );
    const chip = $("#fastChip");
    if (rápida && f !== null) chip.textContent = "fast $" + aUSDC(f).toFixed(2);
  } catch { /* un nodo mudo no puede dejar el panel roto */ }
  await pintarClúster();
}

/* UNA TARJETA POR CARTERA.
 * -----------------------------------------------------------------------
 * Antes eran dos listas separadas -- una de saldos y otra de filas para
 * comprar -- y para saber que le pasaba a la cartera 3 habia que mirar en dos
 * sitios. Ahora cada cartera es una unidad: su tick, sus DOS saldos (el USDC y
 * el del token que hayas pegado arriba), lo que va a poner, y sus propios
 * botones de comprar, vender, financiar y devolver.
 *
 * El estado de los campos se conserva al repintar: si estabas escribiendo un
 * importe y llega un saldo nuevo, no se te borra de debajo del dedo. */
/* LA SUMA DE TODAS, arriba del todo.
 * Con tres carteras se suma de cabeza; con veinte, no, y esa cifra -- cuanto
 * hay puesto y cuanto vale -- es la que se mira primero. */
function pintarTotal(usdc, toks, vals) {
  const caja = $("#fwTotal");
  if (!caja) return;
  /* La principal cuenta en el total. Ahora opera, así que dejarla fuera daría
   * un "everything" que no es todo. */
  if (!rápida && !clúster.length) { caja.hidden = true; return; }
  const suma = (a) => a.reduce((x, y) => x + (typeof y === "number" ? y : 0), 0);
  const totUSDC = usdc.reduce((x, y) => x + (y ? aUSDC(y) : 0), 0);
  const totVal = suma(vals);
  /* EL TOTAL DEL CLUSTER, DE TODAS LAS MONEDAS Y DE SIEMPRE.
   * No solo de la que este pegada arriba: la ganancia de una moneda ya vendida
   * sigue siendo tuya, y una cifra que se olvida de lo cerrado no es un total.
   * Lo abierto se valora con la cotizacion de arriba; lo cerrado ya esta en
   * `sacado`. */
  let totPuesto = 0, totSacado = 0, conCoste = 0;
  const todosLosApuntes = costeTodo();
  const mias = new Set(clúster.map((w) => w.address.toLowerCase()));
  /* Y la principal, que desde el 8-sep también compra y vende: sin esto su
   * P/L no contaría en el total y el número saldría corto sin decir por qué. */
  if (rápida) mias.add(rápida.address.toLowerCase());
  for (const k of Object.keys(todosLosApuntes)) {
    const [dirW, dirT] = k.split("|");
    if (!mias.has(dirW)) continue;
    const c = costeLeer(dirW, dirT);
    if (!c || c.puesto <= 0) continue;
    totPuesto += c.puesto; totSacado += c.sacado;
    if (trToken && dirT === trToken.address.toLowerCase()) conCoste += 1;
  }
  caja.hidden = false;
  caja.textContent = "";
  const dato = (k, v, cls) => {
    const d = document.createElement("span"); d.textContent = k;
    const b = document.createElement("b"); b.textContent = v;
    if (cls) b.className = cls;
    d.append(b); return d;
  };
  const nFilas = (rápida ? 1 : 0) + clúster.length;
  caja.append(dato(nFilas + (nFilas === 1 ? " wallet" : " wallets") +
    (rápida && clúster.length ? " (main + " + clúster.length + ")" : ""), ""));
  caja.append(dato("USDC", dinero(totUSDC)));
  if (trToken) {
    caja.append(dato(trToken.symbol + " value", totVal > 0 ? dinero(totVal) : "—"));
    caja.append(dato("everything", dinero(totUSDC + totVal)));
  }
  if (totPuesto > 0) {
    const gan = totVal + totSacado - totPuesto;
    const pct = (gan / totPuesto) * 100;
    caja.append(dato("P/L all time", (gan >= 0 ? "+" : "") + dinero(gan) + "   " +
      (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%  on " + dinero(totPuesto) + " traded",
      gan >= 0 ? "up" : "down"));
  }
}

function estadoActual() {
  const prev = new Map();
  document.querySelectorAll("#fwList [data-w]").forEach((el) => {
    prev.set(el.dataset.w, {
      on: el.querySelector(".wSel").checked,
      amt: el.querySelector(".wAmt").value,
      slip: el.querySelector(".wSlip").value,
    });
  });
  return prev;
}

/* Lo guardado de UNA fila. Busca por `w`; si lo guardado es viejo y no lo
 * lleva, cae a la posición, que para esos datos es lo correcto. */
function guardadoDe(g, i) {
  if (!g || !Array.isArray(g.filas)) return null;
  const porW = g.filas.find((f) => f && f.w !== undefined && String(f.w) === String(i));
  if (porW) return porW;
  if (g.filas.some((f) => f && f.w !== undefined)) return null; // formato nuevo: no adivinar
  return esMadre(i) ? null : g.filas[i] || null;
}

function tarjetaCartera(i, w, prev, saldoUSDC, saldoTok, valorVenta) {
  /* Lo que hay en pantalla manda; si no hay nada -- primer pintado tras
   * recargar -- se coge lo guardado, y solo despues el valor por defecto. */
  const g = memLeer();
  const p = prev.get(String(i)) || guardadoDe(g, i) || null;
  const card = document.createElement("div");
  card.className = "wcard"; card.dataset.w = String(i);
  if (esMadre(i)) card.classList.add("wcard-main");

  const top = document.createElement("div"); top.className = "wcard-top";
  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.className = "wSel";
  cb.checked = p ? p.on : true;
  /* LA PRINCIPAL NO SE MARCA, Y ESA ES TODA LA REGLA.
   * ---------------------------------------------------------------------
   * Queda fuera de TODO lo que va en bloque -- comprar con todas, vender con
   * todas, financiar las marcadas, devolverlas, el reparto -- y se consigue
   * con una casilla desactivada y sin marcar, no con un `if` en cada sitio.
   * `elegidas()` ya salta lo no marcado, así que los cinco botones la excluyen
   * solos y no hay ninguno que se pueda olvidar mañana.
   *
   * Sus propios botones de Buy y Sell SÍ funcionan: pasan su índice explícito
   * y esa vía no mira la casilla.
   *
   * Y no es un capricho de interfaz: la principal es quien PAGA el reparto y
   * quien RECIBE lo que vuelve. Marcarla sería mandarse dinero a uno mismo
   * gastando gas. */
  if (esMadre(i)) {
    cb.checked = false;
    cb.disabled = true;
    cb.title = "The fast wallet stays out of the bulk buttons — use its own Buy and Sell";
  }
  cb.addEventListener("change", () => { card.classList.toggle("is-on", cb.checked); memGuardar(); });
  /* "main", no "#-1". El índice interno no es asunto de quien mira. */
  const nm = document.createElement("b");
  nm.textContent = esMadre(i) ? "main" : "#" + i;
  if (esMadre(i)) nm.title = "The fast wallet itself — it funds the others and can trade too";
  const ad = document.createElement("span"); ad.className = "wcard-addr";
  ad.textContent = w.address.slice(0, 8) + "…" + w.address.slice(-4);
  ad.title = w.address;
  top.append(cb, nm, ad);
  card.classList.toggle("is-on", cb.checked);

  const bal = document.createElement("div"); bal.className = "wcard-bal";
  const fila = (k, v) => {
    const d = document.createElement("div");
    const a = document.createElement("span"); a.textContent = k;
    const b = document.createElement("b"); b.textContent = v;
    d.append(a, b); return d;
  };
  bal.append(fila("USDC", saldoUSDC === null ? "…" : "$" + aUSDC(saldoUSDC).toFixed(4)));
  /* El saldo del token que has pegado arriba. Sin esto no sabes que vender, y
   * el boton de vender seria una apuesta. */
  bal.append(fila(trToken ? trToken.symbol : "token",
                  !trToken ? "—" : saldoTok === null ? "…"
                    : Number(ethers.formatUnits(saldoTok, trToken.decimals)).toLocaleString("es")));
  card.append(top, bal);

  /* El contexto de mercado y la ganancia. Solo si hay moneda pegada: sin ella
   * estas cifras no son de nada. */
  if (trToken) {
    const mkt = document.createElement("div"); mkt.className = "wcard-mkt";
    const linea = (k, v, cls) => {
      const d = document.createElement("div");
      const a = document.createElement("span"); a.textContent = k;
      const b = document.createElement("b"); b.textContent = v;
      if (cls) b.className = cls;
      d.append(a, b); return d;
    };
    mkt.append(linea("price", mercado ? dinero(mercado.precio) : "—"));
    mkt.append(linea("mcap", mercado && mercado.mcap ? dinero(mercado.mcap) : "—"));

    /* LA GANANCIA. Se compara lo que vale HOY lo que tiene contra lo que
     * gasto en ello. Si no hay apunte de gasto no se ensena un cero: se dice
     * que no se sabe, porque un cero se lee como "no has ganado nada". */
    /* VALOR y GANANCIA en lineas distintas.
     * Estaban juntas y el dueno pregunto lo obvio: "$27.75, es el PnL o el
     * valor?". Una cifra sin nombre en una fila que se llama P/L se lee como
     * la ganancia. El valor es lo que te darian hoy; la ganancia es eso menos
     * lo que pusiste, y sin saber lo que pusiste no hay ganancia que ensenar. */
    const c = costeLeer(w.address, trToken.address);
    let txt = "—", cls = "";
    if (saldoTok !== null && mercado) {
      const cuantos = Number(ethers.formatUnits(saldoTok, trToken.decimals));
      /* LO QUE VALE ES LO QUE TE DARIAN, no el saldo por el precio de comprar
       * un dolar. En esta pool las dos cifras salen a un 2% -- medido: 1.154.658
       * DAGG cotizan $21,11 vendiendo y $21,60 multiplicando -- pero eso es
       * porque tiene fondo. En una pool fina, multiplicar por el precio de un
       * dolar pinta una ganancia que se evapora al intentar salir, y ese es
       * exactamente el fallo que le costo a alguien el 36% en el otro proyecto.
       * Si la cotizacion de venta no llega, se cae a la multiplicacion y se
       * marca con un ~ para que se vea que es una estimacion. */
      const vale = valorVenta !== null && valorVenta !== undefined ? valorVenta : cuantos * mercado.precio;
      const aprox = valorVenta === null || valorVenta === undefined ? "~" : "";
      mkt.append(linea("value", cuantos > 0 ? aprox + dinero(vale) : "—"));
      if (c && c.puesto > 0) {
        /* vale + sacado - puesto. Sirve con la posicion abierta, cerrada y a
         * medias, y no se pierde al vender. */
        const gan = vale + c.sacado - c.puesto;
        const pct = (gan / c.puesto) * 100;
        txt = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%  (" + dinero(gan) + " on " + dinero(c.puesto) + ")";
        cls = pct >= 0 ? "up" : "down";
      } else if (cuantos > 0) {
        /* Se compro antes de que esto existiera, o en otro sitio. Se puede
         * decir cuanto costo y a partir de ahi el porcentaje es real. */
        txt = "set what you paid";
        cls = "lnk";
      }
    } else {
      mkt.append(linea("value", "—"));
    }
    const filaPL = linea("P/L", txt, cls);
    if (cls === "lnk") {
      filaPL.querySelector("b").addEventListener("click", () => {
        const dicho = prompt("How much USDC did this wallet put into " + trToken.symbol + "?");
        const n = Number(dicho);
        if (!isFinite(n) || n <= 0) return;
        costeAnotar(w.address, trToken.address, n, 0);
        pintarClúster();
      });
    }
    mkt.append(filaPL);
    card.append(mkt);
  }

  const inp = document.createElement("div"); inp.className = "wcard-in";
  const l1 = document.createElement("label");
  const a1 = document.createElement("input");
  a1.className = "wAmt"; a1.type = "text"; a1.inputMode = "decimal";
  a1.value = p ? p.amt : ($("#trAllAmt") ? $("#trAllAmt").value : "0.5");
  l1.append(document.createTextNode("$"), a1);
  const l2 = document.createElement("label");
  const a2 = document.createElement("input");
  a2.className = "wSlip"; a2.type = "text"; a2.inputMode = "decimal";
  a2.value = p ? p.slip : ($("#trAllSlip") ? $("#trAllSlip").value : "5");
  l2.append(a2, document.createTextNode("% slip"));
  a1.addEventListener("change", memGuardar);
  a2.addEventListener("change", memGuardar);
  inp.append(l1, l2);
  card.append(inp);

  const acts = document.createElement("div"); acts.className = "wcard-acts";
  const bt = (txt, cls, fn) => {
    const b = document.createElement("button");
    b.className = "btn " + (cls || ""); b.textContent = txt;
    b.addEventListener("click", fn);
    return b;
  };
  acts.append(
    bt("Buy", "btn-primary", () => operarConElClúster(true, [i])),
    bt("Sell", "", () => operarConElClúster(false, [i])),
  );
  /* LA PRINCIPAL NO SE FINANCIA NI SE DEVUELVE A SÍ MISMA. Es quien paga y
   * quien recibe, así que esos dos botones ahí no significan nada. */
  if (!esMadre(i)) {
    acts.append(
      bt("Fund", "", () => financiarUna(i)),
      bt("$ → fast", "", () => devolverUna(i)),
    );
    /* EL QUE FALTABA. Había botones para mover el USDC en los dos sentidos y
     * ninguno para mover LO QUE COMPRAS, que es justo lo que quieres juntar
     * antes de vender de una vez o de sacarlo. Sin esto había que vender desde
     * cada hija por separado.
     *
     * Manda el saldo ENTERO del token pegado arriba. No lleva importe porque
     * partir una posición entre carteras es lo contrario de lo que se quiere
     * aquí: esto es recoger. */
    const etq = trToken ? trToken.symbol + " → fast" : "token → fast";
    const b = bt(etq, "", () => mandarTokenALaRápida(i));
    if (!trToken) { b.disabled = true; b.title = "Paste a token address above first"; }
    else if (saldoTok === 0n) { b.disabled = true; b.title = "This one holds none"; }
    acts.append(b);
  }
  card.append(acts);
  return card;
}

async function pintarClúster() {
  const caja = $("#fwList");
  if (!caja) return;
  const prev = estadoActual();
  caja.textContent = "";
  if (!rápida) {
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = "Derive the fast wallet first.";
    caja.append(p); return;
  }
  /* LA PRINCIPAL VA LA PRIMERA, y va aunque no haya ni una hija: con cero
   * hijas antes salía "no cluster wallets yet" y no se podía operar con
   * nada, teniendo una cartera con dinero delante. */
  const filas = [[IDX_MADRE, rápida], ...clúster.map((w, i) => [i, w])];
  filas.forEach(([i, w]) => caja.append(tarjetaCartera(i, w, prev, null, null)));

  /* Los saldos, despues de pintar: la rejilla sale ya y se rellena, en vez de
   * quedarse en blanco mientras una cadena lenta contesta. */
  try {
    /* Los saldos van por POSICIÓN en `filas`, no por índice de hija: la fila 0
     * es la principal y su índice es -1. Mezclarlos pintaría el saldo de una
     * cartera en la tarjeta de otra. */
    const cartsFila = filas.map(([, w]) => w);
    const usdc = await Promise.all(cartsFila.map((w) => saldoDe(w.address).catch(() => null)));
    let toks = cartsFila.map(() => null);
    let vals = cartsFila.map(() => null);
    if (trToken) {
      const c = new ethers.Contract(trToken.address, ERC20_ABI, proveedorRPC());
      toks = await Promise.all(cartsFila.map((w) => c.balanceOf(w.address).catch(() => null)));
      /* Una cotizacion de venta por cartera. Son N llamadas, y por eso esto va
       * en el boton de refrescar y no en un temporizador: los nodos de Arc se
       * caen media jornada y una pagina que pregunta sola es una pagina que
       * falla sola. */
      /* EL VALOR, COTIZADO SOBRE LA POSICION ACUMULADA.
       * -----------------------------------------------------------------
       * Cada tarjeta cotizaba su saldo COMO SI VENDIERA SOLA, y eso las
       * sobrevalora a todas menos a la primera: venden contra la misma pool
       * una detras de otra, y la segunda encuentra el precio ya movido.
       *
       * Medido con el dueno: siete carteras marcaban +37% cada una y al
       * vender de verdad salio +$0,42 en aquel tramo. El numero por tarjeta
       * era correcto por separado y engañoso en conjunto, que es la peor
       * clase de correcto.
       *
       * Se cotiza el ACUMULADO y se reparte por diferencias:
       *     valor_k = Q(S_k) - Q(S_(k-1))
       * Es la misma formula que ya usa el lado de la compra, y la suma de las
       * tarjetas pasa a ser lo que de verdad sacarias vendiendolas todas. */
      const conSaldo = [];
      toks.forEach((b, i) => { if (b && b > 0n) conSaldo.push(i); });
      vals = toks.map((b) => (b === 0n ? 0 : null));
      let acumulado = 0n, previo = 0;
      for (const i of conSaldo) {
        acumulado += toks[i];
        try {
          if (trToken.motor) {
            /* V4 y puentes: la misma venta acumulada, cotizada por el motor. */
            const hasta = await ventaPorMotor(acumulado);
            vals[i] = Math.max(0, hasta - previo);
            previo = hasta;
            continue;
          }
          const o = await cotizar(trToken.address, QUOTE.address, acumulado, trToken.fee);
          const hasta = Number(ethers.formatUnits(o, QUOTE.decimals));
          vals[i] = Math.max(0, hasta - previo);
          previo = hasta;
        } catch { vals[i] = null; }
      }
    }
    const prev2 = estadoActual();
    caja.textContent = "";
    filas.forEach(([i, w], k) => caja.append(tarjetaCartera(i, w, prev2, usdc[k], toks[k], vals[k])));
    pintarTotal(usdc, toks, vals);
  } catch { /* un nodo mudo no puede dejar la rejilla rota */ }
}

/* Financiar y devolver, UNA cartera. Las dos las firma la rapida o la propia
 * hija, asi que ninguna abre ventana. */
async function financiarUna(i) {
  const log = fwLog();
  try {
    if (!rápida) throw new Error("derive the fast wallet first");
    /* Financiar la principal sería que se pagase a sí misma. No debería poder
     * llegar aquí --su tarjeta no lleva ese botón y las acciones en bloque la
     * saltan por la casilla desactivada-- pero el día que alguien añada otra
     * vía, que falle diciendo por qué y no con `clúster[-1] is undefined`. */
    if (esMadre(i)) throw new Error("that IS the fast wallet — it pays, it does not fund itself");
    const w = clúster[i];
    const el = document.querySelector('#fwList [data-w="' + i + '"]');
    const cuánto = deUSDC(Number(el.querySelector(".wAmt").value) || 0);
    if (cuánto <= 0n) throw new Error("put an amount on that card first");
    const gp = await precioGas();
    const tope = máximoASacar(await saldoDe(rápida.address), gp);
    if (cuánto > tope) throw new Error("the fast wallet can only send $" + aUSDC(tope).toFixed(4) + ", gas reserved");
    const tx = await rápida.sendTransaction({ to: w.address, value: cuánto, gasLimit: 30000n });
    await tx.wait();
    log("#" + i + " funded with $" + aUSDC(cuánto).toFixed(4), "ok");
    pintarCarteras();
  } catch (e) { log(etiquetaFila(i) + ": " + readableError(e), "err"); }
}

/* ── LLEVAR EL TOKEN A LA RÁPIDA PRINCIPAL ──────────────────────────────
 *
 * El hermano del botón de USDC, que faltaba. Manda el saldo ENTERO del token
 * pegado arriba desde una hija a la rápida.
 *
 * LA TRAMPA DE ESTA CADENA: en Arc el gas ES USDC, así que una hija con el
 * token dentro y el USDC a cero NO PUEDE FIRMAR el envío. El token se queda
 * ahí, y el mensaje que sale de la cadena por su cuenta ("insufficient funds")
 * no dice cuál de las dos cosas falta. Se comprueba antes y se dice con
 * palabras: manda gas primero con "Fund".
 *
 * Y NO se descuenta reserva del token: la reserva de gas se descuenta del USDC
 * y sólo del USDC (`máximoASacar`). Aquí se manda el saldo entero del token
 * porque el token no paga gas. */
async function mandarTokenALaRápida(i) {
  const log = fwLog();
  try {
    if (!rápida) throw new Error("derive the fast wallet first");
    if (esMadre(i)) throw new Error("that IS the fast wallet");
    if (!trToken) throw new Error("paste a token address above first");
    const w = carteraDe(i);
    if (!w) throw new Error("no wallet #" + i);

    const c = new ethers.Contract(trToken.address, ERC20_ABI, w);
    const saldo = await c.balanceOf(w.address);
    if (saldo === 0n) throw new Error("#" + i + " holds no " + trToken.symbol);

    /* El gas, ANTES de firmar. Una hija llena de token y vacía de USDC no
     * puede mover nada, y conviene decirlo con nombre y cifra. */
    const gp = await precioGas();
    const usdc = await saldoDe(w.address);
    /* `reservaDeGas`, no la fórmula a mano: es la MISMA cuenta que usa el resto
     * del fichero (30.000 x precio x 3) y escribirla otra vez aquí fue el fallo
     * del 8-sep — `GAS_TRANSFERENCIA` ni siquiera está importada en este
     * fichero, así que el botón moría con "GAS_TRANSFERENCIA is not defined"
     * en una cartera que sí tenía gas. `node --check` no ve un identificador
     * que no existe, y la prueba en el navegador no lo pisó porque el botón
     * estaba desactivado: sin saldo del token no había nada que mandar. */
    const hace_falta = reservaDeGas(gp);
    if (usdc < hace_falta) {
      throw new Error("#" + i + " has $" + aUSDC(usdc).toFixed(4) +
        " and needs about $" + aUSDC(hace_falta).toFixed(4) +
        " of USDC for gas — on Arc the gas IS USDC. Fund it first.");
    }

    const tx = await c.transfer(rápida.address, saldo);
    await tx.wait();
    log("#" + i + " → fast wallet: " +
        Number(ethers.formatUnits(saldo, trToken.decimals)).toLocaleString("es") + " " + trToken.symbol, "ok");
    pintarCarteras();
  } catch (e) { log(etiquetaFila(i) + ": " + readableError(e), "err"); }
}

/* Todas de golpe. Una a una, no en paralelo: comparten nonce con nada pero sí
 * el mismo nodo, y veinte envíos a la vez contra un RPC de Arc es como se
 * pierde la mitad. */
async function barrerToken() {
  const log = fwLog();
  try {
    if (!rápida) throw new Error("derive the fast wallet first");
    if (!trToken) throw new Error("paste a token address above first");
    if (!clúster.length) throw new Error("no cluster to sweep");
    let movidas = 0, sinGas = 0;
    for (let i = 0; i < clúster.length; i++) {
      const w = clúster[i];
      try {
        const c = new ethers.Contract(trToken.address, ERC20_ABI, w);
        const saldo = await c.balanceOf(w.address);
        if (saldo === 0n) continue;
        const gp = await precioGas();
        if ((await saldoDe(w.address)) < reservaDeGas(gp)) {
          sinGas += 1;
          log("  #" + i + ": holds " + trToken.symbol + " but has no USDC for gas — fund it first", "err");
          continue;
        }
        const tx = await c.transfer(rápida.address, saldo);
        await tx.wait();
        movidas += 1;
        log("  #" + i + " → " + Number(ethers.formatUnits(saldo, trToken.decimals)).toLocaleString("es") + " " + trToken.symbol);
      } catch (e) { log("  " + etiquetaFila(i) + ": " + readableError(e), "err"); }
    }
    log(movidas + " wallet(s) sent their " + trToken.symbol + " to the fast wallet" +
        (sinGas ? " · " + sinGas + " could not, no gas" : ""), movidas ? "ok" : "err");
    pintarCarteras();
  } catch (e) { log(readableError(e), "err"); }
}

async function devolverUna(i) {
  const log = fwLog();
  try {
    if (!rápida) throw new Error("derive the fast wallet first");
    if (esMadre(i)) throw new Error("that IS the fast wallet — it receives, it does not send to itself");
    const w = clúster[i];
    const gp = await precioGas();
    const sacar = máximoASacar(await saldoDe(w.address), gp);
    if (sacar <= 0n) throw new Error("nothing above the gas reserve to send back");
    const tx = await w.sendTransaction({ to: rápida.address, value: sacar, gasLimit: 30000n });
    await tx.wait();
    log("#" + i + " → fast wallet: $" + aUSDC(sacar).toFixed(4), "ok");
    pintarCarteras();
  } catch (e) { log(etiquetaFila(i) + ": " + readableError(e), "err"); }
}

/* UNA POR CLIC, no un numero que reconstruye el conjunto.
 * Con un campo "cuantas", pulsar una vez generaba cuatro de golpe -- el campo
 * ya traia un valor y el boton lo aplicaba entero. Anadir de una en una es lo
 * que la gente espera de un boton que dice "anadir".
 *
 * Las hijas se derivan por indice, asi que quitar la ultima y volver a
 * anadirla devuelve LA MISMA direccion: no se pierde nada por probar. */
function ajustarClúster(n) {
  if (!claveMadre) return;
  const total = Math.max(0, Math.min(50, n));
  clúster = derivarClúster(ethers, claveMadre, total).map((w) => w.connect(proveedorRPC()));
  const nota = $("#fwCountNote");
  if (nota) nota.textContent = total + (total === 1 ? " wallet" : " wallets") +
    " — derived in order, so #3 is always #3.";
  memGuardar();
  pintarClúster();
}

/* Meter dinero: LA UNICA firma de la principal en todo el sitio. */
async function fondearRápida() {
  const log = fwLog();
  const btn = $("#fwFundBtn"); btn.disabled = true;
  try {
    if (!firmantePrincipal) { await connect(); }
    if (!rápida) await usarRápida();
    const cuánto = deUSDC(Number($("#fwFund").value) || 0);
    if (cuánto <= 0n) throw new Error("put an amount in first");
    log("one signature in your wallet — this is the only one");
    const tx = await firmantePrincipal.sendTransaction({ to: rápida.address, value: cuánto });
    log("sent, waiting…");
    await tx.wait();
    log("funded", "ok");
    pintarCarteras();
  } catch (e) { log(readableError(e), "err"); }
  finally { btn.disabled = false; }
}

/* Repartir en UNA transaccion. El contrato se compila aqui, como el token y el
 * locker, asi que no hay nada desplegado de antes en lo que confiar. */
let disperseAddr = null;

async function repartirEntreEllas() {
  const log = fwLog();
  const btn = $("#fwSpreadBtn"); btn.disabled = true;
  try {
    if (!rápida) throw new Error("derive the fast wallet first");
    if (!clúster.length) throw new Error("add some wallets first");

    /* EL IMPORTE ES POR CARTERA, no un total a repartir.
     * -------------------------------------------------------------------
     * Antes era "$2 partidos entre todas", y el dueno lo queria al reves y
     * tiene razon: marcas dos, pones 2, y cada una recibe 2. Marcas otras
     * tres, pones 5, y cada una recibe 5. No hay que dividir de cabeza para
     * saber que le llega a cada una, que es justo lo que se quiere saber.
     *
     * Y va SOLO a las marcadas: el tick ya decide quien opera, asi que decidir
     * tambien quien cobra es la misma idea y no una segunda lista que mantener. */
    const destino = elegidas();
    if (!destino.length) throw new Error("tick the wallets that should receive it");
    const cada = deUSDC(Number($("#fwSpread").value) || 0);
    if (cada <= 0n) throw new Error("put an amount in first");
    const total = cada * BigInt(destino.length);

    const gp = await precioGas();
    const saldo = await saldoDe(rápida.address);
    /* La rapida tambien tiene que quedarse el gas del propio reparto, o manda
     * el dinero y se queda sin poder firmar nada mas. */
    const tope = máximoASacar(saldo, gp);
    if (total > tope) {
      throw new Error("$" + aUSDC(cada).toFixed(4) + " x " + destino.length + " is $" +
        aUSDC(total).toFixed(4) + ", and only $" + aUSDC(tope).toFixed(4) +
        " can leave the fast wallet with gas reserved");
    }

    /* `repartir` reparte un total, asi que se le pasa cada-por-cuantas: con
     * variacion 0 sale exactamente `cada` para todas, y con variacion sale
     * alrededor de esa cifra sin cambiar lo que se manda en total. */
    const trozos = repartir(total, destino.length, Number($("#fwVary").value) || 0, 1);
    log("compiling Disperse…");
    const file = await compileAll(DISPERSE_SOURCE, log);
    const c = file[Object.keys(file)[0]];
    log("deploying it (no popup — the fast wallet signs)…");
    const dep = await new ethers.ContractFactory(c.abi, "0x" + c.evm.bytecode.object, rápida).deploy();
    await dep.waitForDeployment();
    disperseAddr = await dep.getAddress();
    log("Disperse at " + disperseAddr, "ok");

    const d = new ethers.Contract(disperseAddr, c.abi, rápida);
    const tx = await d.send(destino.map((x) => x.w.address), trozos, { value: total });
    await tx.wait();
    log("$" + aUSDC(cada).toFixed(4) + " to each of " + destino.length +
        " — $" + aUSDC(total).toFixed(4) + " in one transaction", "ok");
    pintarCarteras();
  } catch (e) { log(readableError(e), "err"); }
  finally { btn.disabled = false; }
}

/* Traer de vuelta. Cada una se guarda su gas: una cartera vaciada del todo no
 * puede firmar el envio y se queda el dinero dentro para siempre. */
async function barrer(destino, etiqueta) {
  const log = fwLog();
  try {
    if (!clúster.length) throw new Error("no cluster to sweep");
    const gp = await precioGas();
    let movidas = 0;
    for (const w of clúster) {
      try {
        const saldo = await saldoDe(w.address);
        const sacar = máximoASacar(saldo, gp);
        if (sacar <= 0n) continue;
        const tx = await w.sendTransaction({ to: destino, value: sacar, gasLimit: 30000n });
        await tx.wait();
        movidas += 1;
        log("  " + w.address.slice(0, 8) + "… → " + aUSDC(sacar).toFixed(4));
      } catch (e) { log("  " + w.address.slice(0, 8) + "…: " + readableError(e), "err"); }
    }
    log(movidas + " of " + clúster.length + " swept to " + etiqueta, "ok");
    pintarCarteras();
  } catch (e) { log(readableError(e), "err"); }
}

/* SACAR UNA CANTIDAD, que no es lo mismo que vaciar. El boton de barrer se lo
 * lleva todo; esto lleva lo que digas y deja la rapida operativa. */
async function retirarALaPrincipal(todo) {
  const log = fwLog();
  const btn = $("#fwOutBtn"); btn.disabled = true;
  try {
    if (!rápida) throw new Error("derive the fast wallet first");
    if (!cuentaPrincipal) throw new Error("connect your main wallet first");
    const gp = await precioGas();
    const saldo = await saldoDe(rápida.address);
    const tope = máximoASacar(saldo, gp);
    const cuánto = todo ? tope : deUSDC(Number($("#fwOut").value) || 0);
    if (cuánto <= 0n) throw new Error("nothing to send — the balance is at or under the gas reserve");
    if (cuánto > tope) {
      throw new Error("only $" + aUSDC(tope).toFixed(4) + " can leave: the rest is the gas it needs to sign again");
    }
    log("sending $" + aUSDC(cuánto).toFixed(4) + " to " + cuentaPrincipal.slice(0, 8) + "… (no popup)");
    const tx = await rápida.sendTransaction({ to: cuentaPrincipal, value: cuánto, gasLimit: 30000n });
    await tx.wait();
    log("done", "ok");
    pintarCarteras();
  } catch (e) { log(readableError(e), "err"); }
  finally { btn.disabled = false; }
}

$("#fwOutBtn").addEventListener("click", () => retirarALaPrincipal(false));
$("#fwOutMax").addEventListener("click", async () => {
  /* Max ESCRIBE la cifra en el campo antes de mandar nada: ver lo que vas a
   * enviar y luego enviarlo son dos gestos, y juntarlos es como se manda de mas. */
  if (!rápida) return;
  try {
    const gp = await precioGas();
    const tope = máximoASacar(await saldoDe(rápida.address), gp);
    $("#fwOut").value = aUSDC(tope).toFixed(6);
    $("#fwOutNote").textContent = "That is everything except the gas it needs to sign again.";
  } catch (e) { $("#fwOutNote").textContent = readableError(e); }
});

$("#fwFundBtn").addEventListener("click", fondearRápida);
$("#fwSpreadBtn").addEventListener("click", repartirEntreEllas);
$("#fwSweepFast").addEventListener("click", () => {
  if (!rápida) return;
  barrer(rápida.address, "the fast wallet");
});
$("#fwSweepTok").addEventListener("click", () => barrerToken());
$("#fwSweepMain").addEventListener("click", async () => {
  if (!cuentaPrincipal) return;
  await barrer(cuentaPrincipal, "your main wallet");
  /* Y la rapida tambien, que si no el dinero se queda a mitad de camino. */
  if (rápida) {
    const log = fwLog();
    try {
      const gp = await precioGas();
      const sacar = máximoASacar(await saldoDe(rápida.address), gp);
      if (sacar > 0n) {
        const tx = await rápida.sendTransaction({ to: cuentaPrincipal, value: sacar, gasLimit: 30000n });
        await tx.wait();
        log("fast wallet → main: " + aUSDC(sacar).toFixed(4), "ok");
      }
      pintarCarteras();
    } catch (e) { log(readableError(e), "err"); }
  }
});


/* ── 7b · comprar y vender con el cluster ───────────────────────────────
 *
 * TODO ESTO ESTA COMPROBADO EN LA CADENA, no copiado de la documentacion de
 * Uniswap para otra red:
 *
 *   QuoterV2      0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468   8.273 bytes
 *   SwapRouter02  0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77  24.497 bytes
 *
 * Los dos devuelven `factory()` = 0xf0db7b58..., la MISMA factoria V3 que usa
 * esta pagina, y el router devuelve `positionManager()` = 0x39654A85..., el
 * mismo. Son del mismo despliegue del fork, no piezas sueltas parecidas.
 *
 * Y LA FIRMA IMPORTA: el que existe es
 *   exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
 * o sea SIN `deadline`. La variante de ocho campos con deadline NO esta en su
 * bytecode -- comprobado -- y usarla habria revertido todas las compras con un
 * error que no dice nada. */
const ARC_QUOTER = "0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468";
const ARC_SWAP_ROUTER = "0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77";

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];
const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];

let trToken = null;   // { address, symbol, decimals, fee, pool }
/* El precio y la capitalizacion, cotizados y no calculados de un saldo: el
 * Quoter dice lo que de verdad te darian, que es el unico precio que importa
 * cuando vas a vender. Se pide UNA vez por refresco y vale para las tarjetas. */
let mercado = null;   // { precio, mcap, supply }
/* El motor de rutas (V4, hooks de Arguspad y puentes), creado la primera vez
 * que una moneda no tiene pool V3 contra USDC. Ver motor-rutas.js. */
let motorRutas = null;

async function leerMercado() {
  if (!trToken) { mercado = null; return null; }
  if (trToken.motor) return leerMercadoPorMotor();
  try {
    /* Con un dolar, para que el propio deslizamiento no falsee el precio: una
     * cotizacion grande devuelve el precio DESPUES de moverlo. */
    const uno = ethers.parseUnits("1", QUOTE.decimals);
    const out = await cotizar(QUOTE.address, trToken.address, uno, trToken.fee);
    const tokensPorDolar = Number(ethers.formatUnits(out, trToken.decimals));
    if (!isFinite(tokensPorDolar) || tokensPorDolar <= 0) { mercado = null; return null; }
    const precio = 1 / tokensPorDolar;
    let supply = null;
    try {
      const [ts] = await callRead(trToken.address, ERC20_ABI, "totalSupply");
      supply = Number(ethers.formatUnits(ts, trToken.decimals));
    } catch { /* sin supply no hay capitalizacion, y se dice */ }
    mercado = { precio, supply, mcap: supply ? precio * supply : null };
    return mercado;
  } catch { mercado = null; return null; }
}

const dinero = (x) => x >= 1000 ? "$" + Math.round(x).toLocaleString("es")
                    : x >= 1 ? "$" + x.toFixed(2)
                    : "$" + x.toPrecision(3);

/* Que tramo tiene la pool. Se PREGUNTA a la factoria por los cuatro que este
 * fork tiene habilitados en vez de dar por hecho el 1%: un token lanzado en
 * otro tramo existe igual y buscarlo solo en uno lo deja invisible. */
async function buscarPool(dir) {
  const s = sortPair(dir, QUOTE.address);
  for (const t of FEE_TIERS) {
    try {
      const [p] = await callRead(ARC.v3Factory, FACTORY_ABI, "getPool", [s.token0, s.token1, t.fee]);
      if (p && p !== ethers.ZeroAddress) return { fee: t.fee, pool: p, label: t.label };
    } catch { /* un tramo que no contesta no descarta los demas */ }
  }
  return null;
}

async function leerTokenDeCompra() {
  const dir = resolverMoneda($("#trToken").value);
  const info = $("#trInfo");
  trToken = null;
  if (!dir) {
    const escrito = $("#trToken").value.trim();
    info.textContent = escrito
      ? "Not an address, and no coin you have used is called that."
      : "Paste an address, or type a symbol you have used before.";
    pintarClúster(); return;
  }
  info.textContent = "reading…";
  try {
    const m = await readToken(dir);
    if (!m || m.unreachable) {
      info.textContent = m && m.unreachable ? "No Arc node is answering right now." : "That address does not answer symbol() and decimals().";
      pintarClúster(); return;
    }
    const p = await buscarPool(dir);
    /* Sin pool V3 contra USDC: V4, Arguspad y puentes, por el motor. */
    if (!p) { await leerTokenPorMotor(dir, m, info); pintarClúster(); return; }
    trToken = { address: ethers.getAddress(dir), symbol: m.symbol, decimals: m.decimals, fee: p.fee, pool: p.pool };
    monedaRecordar(trToken);
    memGuardar();
    await leerMercado();
    info.textContent = m.symbol + " · " + m.decimals + " decimals · pool " + p.label + " at " + p.pool.slice(0, 10) + "…";
  } catch (e) { info.textContent = readableError(e); }
  pintarClúster();
}

/* Quien entra en una operacion en conjunto: las tarjetas con el tick puesto.
 * `solo` permite que el boton de UNA tarjeta ejecute solo la suya. */
function elegidas(solo) {
  const out = [];
  document.querySelectorAll("#fwList [data-w]").forEach((el) => {
    const i = Number(el.dataset.w);
    if (solo && !solo.includes(i)) return;
    if (!solo && !el.querySelector(".wSel").checked) return;
    /* `clúster[-1]` es `undefined`: la principal se resuelve aparte. */
    const w = carteraDe(i);
    if (!w) return;
    out.push({
      i,
      w,
      cantidad: Number(el.querySelector(".wAmt").value) || 0,
      slippage: Number(el.querySelector(".wSlip").value) || 0,
    });
  });
  return out;
}

/* Cotizar con el Quoter. Revierte por diseno para devolver el numero, asi que
 * se llama con staticCall y NO gasta nada. */
async function cotizar(tokenIn, tokenOut, amountIn, fee) {
  const q = new ethers.Contract(ARC_QUOTER, QUOTER_ABI, proveedorRPC());
  const r = await q.quoteExactInputSingle.staticCall({
    tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n,
  });
  return r[0];
}

async function permisoSuficiente(w, token, cuánto) {
  const c = new ethers.Contract(token, ERC20_ABI, w);
  const actual = await c.allowance(w.address, ARC_SWAP_ROUTER);
  if (actual >= cuánto) return;
  /* Se aprueba el maximo UNA vez por cartera y por moneda: el permiso es una
   * cifra acumulada, no un permiso por operacion, y aprobar en cada compra es
   * una transaccion de gas por nada. */
  const tx = await c.approve(ARC_SWAP_ROUTER, ethers.MaxUint256);
  await tx.wait();
}

/* ── V4, HOOKS DE ARGUSPAD Y PUENTES, POR EL MOTOR DE RUTAS ─────────────
 *
 * Lo que no tiene pool V3 contra USDC ya no se queda en "nothing to trade": se
 * busca en V4 (USDC nativo o ERC-20), en los lanzamientos de Arguspad (con la
 * prueba del hook en cadena) y por los puentes de long.supply, y se opera por
 * el UniversalRouter con rutas.js. Todo lo de dentro esta en motor-rutas.js.
 *
 * LO DE V3 NO CAMBIA: si buscarPool() encuentra la pool, la moneda va por el
 * Quoter y el SwapRouter02 de siempre. Esto solo entra cuando no la encuentra.
 *
 * SIN COMISION: el 1% del motor va a MSG_SENDER y vuelve a la misma cartera en
 * la misma transaccion (motor-rutas.js, y la prueba en tools/probar-motor.mjs). */
function motorDeRutas() {
  if (!motorRutas) motorRutas = MOTOR.crearMotorPropio(ethers, window.Rutas, proveedorRPC());
  return motorRutas;
}

async function leerTokenPorMotor(dir, m, info) {
  info.textContent = m.symbol + " has no V3 pool against USDC — looking for V4 pools, an Arguspad launch and bridges…";
  let d;
  try {
    d = await MOTOR.descubrir({ ethers, Rutas: window.Rutas, motor: motorDeRutas(), provider: proveedorRPC(), token: dir });
  } catch (e) {
    info.textContent = m.symbol + " has no V3 pool against USDC, and the V4 and bridge search failed: " + readableError(e);
    return;
  }
  /* Se ha pegado otra moneda mientras se buscaba: esta respuesta ya no es de nadie. */
  const ahora = resolverMoneda($("#trToken").value);
  if (!ahora || ahora.toLowerCase() !== dir.toLowerCase()) return;
  if (!d.rutas.length) { info.textContent = m.symbol + ": " + MOTOR.motivoSinRuta(d); return; }
  trToken = { address: ethers.getAddress(dir), symbol: m.symbol, decimals: m.decimals, fee: null, pool: null, motor: d };
  monedaRecordar(trToken);
  memGuardar();
  await leerMercado();
  info.textContent = m.symbol + " · " + m.decimals + " decimals · " + MOTOR.textoRuta(d.rutas[0], "compra", m.symbol) +
    (d.rutas.length > 1 ? " · " + d.rutas.length + " routes, the best one is quoted before every trade" : "") +
    " · Uniswap router, no fee";
}

/* El precio con un dolar, como en V3. De ese dolar el router opera 0,99 (el 1%
 * vuelve a la cartera), asi que el precio sale de lo operado, no del dolar. */
async function leerMercadoPorMotor() {
  const t = trToken;
  try {
    const cot = await MOTOR.mejorCotizacion({ motor: motorDeRutas(), rutas: t.motor.rutas, lado: "compra", cantidad: ethers.parseUnits("1", QUOTE.decimals) });
    const tokens = Number(ethers.formatUnits(cot.sale, t.decimals));
    const usdc = MOTOR.usdcGastado(ethers, cot);
    if (!isFinite(tokens) || tokens <= 0 || !(usdc > 0)) { mercado = null; return null; }
    const precio = usdc / tokens;
    let supply = null;
    try {
      const [ts] = await callRead(t.address, ERC20_ABI, "totalSupply");
      supply = Number(ethers.formatUnits(ts, t.decimals));
    } catch { /* sin supply no hay capitalizacion, y se dice */ }
    if (trToken !== t) return mercado;   // se cambio de moneda mientras tanto
    mercado = { precio, supply, mcap: supply ? precio * supply : null };
    return mercado;
  } catch { mercado = null; return null; }
}

/* Lo que daria vender `cantidad` ahora, en USDC. La salida entera: el 1% del
 * router tambien vuelve a la cartera. */
async function ventaPorMotor(cantidad) {
  const cot = await MOTOR.mejorCotizacion({ motor: motorDeRutas(), rutas: trToken.motor.rutas, lado: "venta", cantidad });
  return MOTOR.usdcDeVenta(ethers, cot);
}

/* UNA cartera, por el motor. No lanza nunca: como en V3, una cartera que falla
 * no para a las demas. Cotiza justo antes de SU operacion, dentro de operar.
 * `t` es la moneda que fijo el lote al empezar, y aqui NUNCA se lee `trToken`:
 * el campo sigue abierto mientras el lote corre (ver operarConElClúster). */
async function operarUnaConMotor(esCompra, t, { i, w, cantidad, slippage }, log) {
  const fila = "  " + etiquetaFila(i) + ": ";
  try {
    let amountIn;
    if (esCompra) {
      amountIn = ethers.parseUnits(String(cantidad), QUOTE.decimals);
    } else {
      /* Vender es TODO lo que tenga, igual que en V3. */
      const c = new ethers.Contract(t.address, ERC20_ABI, proveedorRPC());
      amountIn = await c.balanceOf(w.address);
      if (amountIn === 0n) { log(fila + "holds none, skipped"); return; }
    }
    const r = await MOTOR.operar({
      ethers, Rutas: window.Rutas, motor: motorDeRutas(), firmante: w, rutas: t.motor.rutas,
      lado: esCompra ? "compra" : "venta", cantidad: amountIn, slippageBps: Math.round(slippage * 100),
      simbolo: t.symbol, decimales: t.decimals, avisar: (txt) => log(fila + txt),
    });
    /* Se apunta DESPUES de confirmar, como en V3. Al comprar, lo que salio de
     * verdad: la entrada menos el 1% que volvio. */
    if (esCompra) {
      costeAnotar(w.address, t.address, MOTOR.usdcGastado(ethers, r.plan.cot), 0);
    } else {
      /* Lo que VOLVIO, del recibo: en una ruta de USDC ERC-20 son DOS Transfer a
       * la cartera (el 1% y el resto) y se suman. En una nativa no se lee: se
       * apunta lo cotizado, que es lo mejor que se sabe. */
      let vuelta = null;
      if (!r.plan.cot.ruta.nativo) {
        try {
          const T = ethers.id("Transfer(address,address,uint256)");
          const yo = "0x" + w.address.slice(2).toLowerCase().padStart(64, "0");
          let suma = 0n;
          for (const l of (r.recibo && r.recibo.logs) || []) {
            if (String(l.address).toLowerCase() !== QUOTE.address.toLowerCase()) continue;
            if (l.topics[0] !== T || l.topics.length < 3) continue;
            if (String(l.topics[2]).toLowerCase() !== yo) continue;
            suma += BigInt(l.data);
          }
          if (suma > 0n) vuelta = Number(ethers.formatUnits(suma, QUOTE.decimals));
        } catch { /* se cae a lo cotizado */ }
      }
      costeAnotar(w.address, t.address, 0, vuelta !== null ? vuelta : MOTOR.usdcDeVenta(ethers, r.plan.cot));
    }
    log(fila + "done", "ok");
  } catch (e) {
    log(fila + readableError(e), "err");
  }
}

async function operarConElClúster(esCompra, solo) {
  const log = logger("trLog");
  const btns = [$("#trBuy"), $("#trSell")];
  btns.forEach((b) => (b.disabled = true));
  try {
    if (!trToken) throw new Error("paste a token address first");
    if (!clúster.length) throw new Error("derive some cluster wallets first");
    const lista = elegidas(solo);
    if (!lista.length) throw new Error(solo ? "that wallet has no amount set" : "no wallet is ticked");
    const espera = Math.max(0, Number($("#trGap").value) || 0);

    /* LA MONEDA DEL LOTE SE FIJA AQUI, UNA VEZ, y todo lo de abajo lee `tok`.
     * El campo de la moneda sigue abierto mientras el lote corre, y leer el
     * global en cada cartera hacia que, pegando otra direccion en el hueco
     * entre dos, las que quedaban compraran o vendieran LA NUEVA con la cantidad
     * de su tarjeta, bajo una cabecera que decia la vieja. Cazado con carteras
     * simuladas: la segunda compro 0x897c en un lote de ARCX10. Prueba en
     * tools/probar-lote.mjs. */
    const tok = trToken;
    const entra = esCompra ? QUOTE.address : tok.address;
    const sale = esCompra ? tok.address : QUOTE.address;
    const decEntra = esCompra ? QUOTE.decimals : tok.decimals;
    const decSale = esCompra ? tok.decimals : QUOTE.decimals;

    log(lista.length + (esCompra ? " buying " : " selling ") + tok.symbol +
        (espera ? " · " + espera + "s apart" : " · back to back"));

    let parado = false;
    for (let k = 0; k < lista.length; k++) {
      const { i, w, cantidad, slippage } = lista[k];
      /* Si el campo ha cambiado desde que empezo, el lote SE PARA y lo dice.
       * Seguir con la vieja seria operar lo que ya no esta en pantalla, y
       * seguir con la nueva es el fallo de arriba. Cuenta cualquier cambio,
       * tambien volver a pegar la misma (es otro objeto): parar de mas cuesta
       * pulsar otra vez; operar la moneda que no era no se deshace. */
      if (trToken !== tok) {
        log("stopped: the token field changed while " + (esCompra ? "buying " : "selling ") + tok.symbol +
            " — " + (lista.length - k) + " wallet(s) left untouched", "err");
        parado = true;
        break;
      }
      /* V4 Y PUENTES, POR EL MOTOR (ver operarUnaConMotor), con la moneda del
       * lote. Lo de abajo, V3, no cambia salvo que lee `tok`. El hueco entre
       * carteras es el mismo. */
      if (tok.motor) {
        await operarUnaConMotor(esCompra, tok, { i, w, cantidad, slippage }, log);
        if (espera && k < lista.length - 1) await new Promise((s) => setTimeout(s, espera * 1000));
        continue;
      }
      try {
        let amountIn;
        if (esCompra) {
          amountIn = ethers.parseUnits(String(cantidad), decEntra);
        } else {
          /* Vender es TODO lo que tenga: pedir una cantidad de un token cuyo
           * saldo no sabes de memoria es como se firma una venta que revierte. */
          const c = new ethers.Contract(tok.address, ERC20_ABI, proveedorRPC());
          amountIn = await c.balanceOf(w.address);
          if (amountIn === 0n) { log("  " + etiquetaFila(i) + ": holds none, skipped"); continue; }
        }

        /* LA COTIZACION VA AQUI, justo antes de SU operacion, no al principio.
         * Todas caen en la misma pool una detras de otra: la segunda compra a
         * peor precio que la primera, y un presupuesto tomado antes de empezar
         * seria mentira para todas menos la primera. */
        const esperado = await cotizar(entra, sale, amountIn, tok.fee);
        const minOut = (esperado * BigInt(Math.round((100 - slippage) * 100))) / 10000n;
        log("  " + etiquetaFila(i) + ": " + ethers.formatUnits(amountIn, decEntra) + " → " +
            Number(ethers.formatUnits(esperado, decSale)).toLocaleString("es") +
            "  (min " + Number(ethers.formatUnits(minOut, decSale)).toLocaleString("es") + ", " + slippage + "%)");

        await permisoSuficiente(w, entra, amountIn);
        const r = new ethers.Contract(ARC_SWAP_ROUTER, ROUTER_ABI, w);
        const tx = await r.exactInputSingle({
          tokenIn: entra, tokenOut: sale, fee: tok.fee,
          recipient: w.address, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n,
        });
        await tx.wait();
        /* Se apunta DESPUES de confirmar, no antes: una compra que revierte no
         * puede dejar un coste apuntado que luego mienta en el porcentaje. */
        if (esCompra) {
          costeAnotar(w.address, tok.address, Number(ethers.formatUnits(amountIn, decEntra)), 0);
        } else {
          /* Lo que VOLVIO de la venta, no lo que se mandó: se lee del recibo.
           * Si no se puede leer se apunta lo cotizado, que es lo mejor que se
           * sabe, en vez de no apuntar nada y perder la ganancia. */
          let vuelta = null;
          try {
            const rec = await proveedorRPC().getTransactionReceipt(tx.hash);
            const T = ethers.id("Transfer(address,address,uint256)");
            const yo = "0x" + w.address.slice(2).toLowerCase().padStart(64, "0");
            for (const l of rec.logs || []) {
              if (String(l.address).toLowerCase() !== QUOTE.address.toLowerCase()) continue;
              if (l.topics[0] !== T || l.topics.length < 3) continue;
              if (String(l.topics[2]).toLowerCase() !== yo) continue;
              vuelta = Number(ethers.formatUnits(BigInt(l.data), QUOTE.decimals));
              break;
            }
          } catch { /* se cae a lo cotizado */ }
          costeAnotar(w.address, tok.address, 0,
                      vuelta !== null ? vuelta : Number(ethers.formatUnits(esperado, decSale)));
        }
        log("  " + etiquetaFila(i) + ": done", "ok");
      } catch (e) {
        /* Una cartera que falla NO para a las demas: son independientes, y
         * pararlas todas porque a la tercera le falto gas es perder el resto
         * de la ejecucion por nada. */
        log("  " + etiquetaFila(i) + ": " + readableError(e), "err");
      }
      if (espera && k < lista.length - 1) await new Promise((s) => setTimeout(s, espera * 1000));
    }
    if (!parado) log("finished", "ok");
    pintarCarteras();
  } catch (e) { logger("trLog")(readableError(e), "err"); }
  finally { btns.forEach((b) => (b.disabled = false)); }
}

$("#trToken").addEventListener("input", () => {
  clearTimeout(window._trT);
  window._trT = setTimeout(leerTokenDeCompra, 500);
});
const tarjetas = () => document.querySelectorAll("#fwList [data-w]");
const marcar = (v) => {
  tarjetas().forEach((el) => {
    const cb = el.querySelector(".wSel");
    /* "Select all" NO marca la principal. Su casilla está desactivada a
     * propósito (ver `tarjetaCartera`) y saltársela desde aquí la metería en
     * el reparto y en las compras en bloque por la puerta de atrás. */
    if (cb.disabled) return;
    cb.checked = v;
    el.classList.toggle("is-on", v);
  });
  memGuardar();
  planDeCompra();
};

$("#trFill").addEventListener("click", () => {
  const a = $("#trAllAmt").value, s = $("#trAllSlip").value;
  tarjetas().forEach((el) => { el.querySelector(".wAmt").value = a; el.querySelector(".wSlip").value = s; });
  memGuardar();
  planDeCompra();
});
$("#trAll").addEventListener("click", () => marcar(true));
$("#trNone").addEventListener("click", () => marcar(false));
/* El resumen. Suma lo que hay en las tarjetas, no lo que hay en el
 * rellenador: el rellenador es un atajo para escribir, y confundirlo con lo
 * que se va a firmar es justo lo que hace falta evitar. */
function planDeCompra() {
  const el = $("#trPlan");
  if (!el) return;
  const lista = elegidas();
  if (!trToken) { el.textContent = "Paste a token address above to trade it."; return; }
  if (!lista.length) { el.textContent = "No wallet is ticked — tick the cards that should trade."; return; }
  const gap = Number($("#trGap").value) || 0;
  const total = lista.reduce((a, x) => a + x.cantidad, 0);
  const slips = [...new Set(lista.map((x) => x.slippage))];
  const iguales = lista.every((x) => x.cantidad === lista[0].cantidad);
  el.textContent =
    lista.length + (lista.length === 1 ? " wallet buys " : " wallets buy ") + trToken.symbol +
    " · " + (iguales ? "$" + lista[0].cantidad + " each" : "$" + total.toFixed(4).replace(/\.?0+$/, "") + " between them") +
    " · " + (slips.length === 1 ? slips[0] + "% slippage" : "slippage " + Math.min(...slips) + "–" + Math.max(...slips) + "%") +
    " · " + (gap ? gap + "s apart" : "back to back") +
    " · $" + total.toFixed(4).replace(/\.?0+$/, "") + " total";
}
["#trGap", "#trToken"].forEach((s) => $(s) && $(s).addEventListener("input", planDeCompra));
document.addEventListener("input", (e) => {
  if (e.target && e.target.classList &&
      (e.target.classList.contains("wAmt") || e.target.classList.contains("wSlip"))) planDeCompra();
});

$("#trBuy").addEventListener("click", () => operarConElClúster(true));
$("#trSell").addEventListener("click", () => operarConElClúster(false));

/* La cuenta, escrita antes de pulsar: cuantas marcadas, cuanto a cada una y
 * cuanto sale en total. Que la suma la haga la pagina y no tu cabeza. */
function notaDelReparto() {
  const n = elegidas().length;
  const cada = Number($("#fwSpread").value) || 0;
  const nota = $("#fwSpreadNote");
  if (!nota) return;
  planDeCompra();
  nota.textContent = n === 0
    ? "No wallet is ticked — tick the ones that should receive it."
    : n + (n === 1 ? " wallet ticked · " : " wallets ticked · ") +
      "$" + cada + " each · $" + (cada * n).toFixed(4).replace(/\.?0+$/, "") + " leaves the fast wallet";
}
$("#fwSpread").addEventListener("input", notaDelReparto);
document.addEventListener("change", (e) => {
  if (e.target && e.target.classList && e.target.classList.contains("wSel")) notaDelReparto();
});

/* ── EL COSTE, LEIDO DE LA CADENA ────────────────────────────────────────
 *
 * El dueno insistio: "debe ser el numero real". Y tenia razon -- yo le habia
 * ensenado un +1316% construido sobre SUPONER que habia puesto 2 dolares en
 * cada cartera, porque eso decia un log viejo del reparto. Habia seguido
 * comprando desde entonces. Suponer un coste es inventar la ganancia.
 *
 * No hay que suponerlo: la pool lo publica. Cada swap emite un evento `Swap`
 * con `recipient` INDEXADO, y sus `amount0/amount1` son int256 con signo --
 * positivo lo que entra a la pool, negativo lo que sale. Filtrando por el
 * tercer topic salen exactamente los swaps de esa cartera y sus importes
 * exactos, sin decodificar calldata ni adivinar nada.
 *
 * POR QUE NO ARCSCAN, QUE ERA LA PRIMERA VERSION: su API contesta HTTP 200 con
 * `result: []` cuando la llama un navegador, mientras devuelve las 8
 * transacciones a `curl`. Mismo URL, misma ventana de bloques. Es la cicatriz
 * que INDEXER.md deja escrita -- "si Arcscan empieza a fallar de la nada, mira
 * la User-Agent primero" -- y aqui no falla: miente en silencio, que es peor.
 * Medido antes de reescribir esto, no deducido.
 *
 * SE CALCULA EL NETO: puesto comprando menos sacado vendiendo. Asi no hay que
 * reconstruir cuantos tokens habia en cada momento, y ademas es la cifra que
 * importa: lo que llevas puesto de verdad en esa moneda.
 *
 * EL LIMITE, DICHO: `eth_getLogs` de este RPC solo acepta 10.000 bloques por
 * llamada -- unos 83 minutos a medio segundo por bloque. Se piden varios
 * tramos hacia atras y se dice hasta donde se llego, en vez de dar por
 * completa una suma que empieza a media historia. */
const LOGS_TRAMO = 10000;
const LOGS_TRAMOS = 12;        // ~16 h hacia atras; subirlo es mas espera, no mas riesgo
const SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

/* ─── EL COSTE, POR EL HISTORIAL DE LA CARTERA Y NO BARRIENDO LA CADENA ───
 *
 * POR QUE SE REESCRIBIO, con la cifra: al mudar la pagina a otro dominio hubo
 * que reconstruir el coste desde cero, y el boton de abajo trajo $7,58 de los
 * $544,12 que habia de verdad. No fallaba: es que `eth_getLogs` de este RPC
 * acepta 10.000 bloques por llamada -- 83 minutos de cadena -- y doce tramos
 * son 16,7 horas. Todo lo comprado antes, para el boton no existia.
 *
 * Preguntar por la CARTERA en vez de barrer la piscina cambia la escala:
 *
 *     eth_getLogs          10.000 bloques por llamada
 *     Arcscan tokentx     200.000 bloques por llamada     20 veces mas
 *
 * Y una sola llamada trae TODOS sus tokens a la vez -- comprobado: USDC, CUSP
 * y COOLCAT en la misma respuesta -- asi que el USDC de cada operacion viene
 * en el mismo viaje que la moneda, y se cruzan por `hash`. Diez dias de
 * historial pasan de ~173 llamadas por cartera a ~9.
 *
 * DOS COSAS QUE COSTARON UNA MEDICION CADA UNA:
 *
 * 1. EL LIMITE ES `endblock - startblock <= 199.999`, no 200.000. Pedir la
 *    ventana redonda devuelve "Block range too large" -- el mismo desfase de
 *    uno que ya mordio con eth_getLogs.
 *
 * 2. UN `result` QUE NO ES UNA LISTA SIGNIFICA "NO LO SE", NUNCA "CERO".
 *    Arcscan contesta de tres formas y solo dos son un dato:
 *      status=1  message=OK                     -> lista con movimientos
 *      status=0  message=No transactions found  -> lista VACIA, vacio de verdad
 *      status=0  message=NOTOK                  -> TEXTO con el error
 *    Tratar el tercero como cero borraria el coste de una cartera entera y la
 *    dejaria en "+0%" sin que nada avisara. Por eso se lanza. Es la misma
 *    leccion que INDEXER.md dejo escrita del indexer.
 */
const ARCSCAN_API = "https://api.arc-scan.org/api";
const AS_VENTANA = 200000;      // ~27,8 h de cadena por llamada
const AS_VENTANAS = 24;         // ~27 dias hacia atras como mucho
/* Una cartera rapida se crea y se usa en un periodo; pasado su nacimiento no
   hay nada mas atras. Tres ventanas seguidas vacias es el final de su
   historia, y parar ahi ahorra la mayoria de las llamadas. */
const AS_VACIAS_PARA_PARAR = 3;

async function arcscanMovimientos(dir, desde, hasta) {
  const u = new URL(ARCSCAN_API);
  u.searchParams.set("module", "account");
  u.searchParams.set("action", "tokentx");
  u.searchParams.set("address", dir);
  u.searchParams.set("startblock", String(Math.max(0, desde)));
  u.searchParams.set("endblock", String(hasta));
  u.searchParams.set("sort", "asc");

  const r = await fetch(u, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("Arcscan HTTP " + r.status);
  const j = await r.json();
  /* LA UNICA COMPROBACION QUE IMPORTA. Ver el punto 2 de arriba. */
  if (!Array.isArray(j.result)) {
    throw new Error(String(j.result || j.message || "Arcscan no contesto una lista").slice(0, 120));
  }
  return j.result;
}

async function costeDesdeArcscan(w, ultimo) {
  if (!trToken) return null;
  const yo = w.address.toLowerCase();
  const elToken = trToken.address.toLowerCase();
  const elUsdc = QUOTE.address.toLowerCase();

  let puesto = 0, sacado = 0, swaps = 0, vacias = 0, ventanasLeidas = 0;
  const porHash = new Map();

  for (let k = 0; k < AS_VENTANAS; k++) {
    const hasta = ultimo - k * AS_VENTANA;
    if (hasta < 0) break;
    const desde = Math.max(0, hasta - AS_VENTANA + 1);
    const movs = await arcscanMovimientos(w.address, desde, hasta);
    ventanasLeidas += 1;

    if (!movs.length) {
      if (++vacias >= AS_VACIAS_PARA_PARAR) break;
      continue;
    }
    vacias = 0;

    for (const t of movs) {
      const contrato = String(t.contractAddress).toLowerCase();
      if (contrato !== elToken && contrato !== elUsdc) continue;
      const entra = String(t.to).toLowerCase() === yo;
      const sale = String(t.from).toLowerCase() === yo;
      if (!entra && !sale) continue;

      const g = porHash.get(t.hash) || { tok: 0, usdc: 0 };
      if (contrato === elToken) {
        /* Del lado de la moneda solo interesa la DIRECCION, no la cantidad:
           un supply de 18 decimales no cabe en un Number sin perder cifras, y
           aqui solo hace falta saber si entro o salio. */
        g.tok += entra ? 1 : -1;
      } else {
        /* El USDC son 6 decimales: cabe de sobra y es la cifra que se suma. */
        g.usdc += (entra ? 1 : -1) * (Number(t.value) / 10 ** Number(t.tokenDecimal || 6));
      }
      porHash.set(t.hash, g);
    }
  }

  /* UNA OPERACION ES UNA TRANSACCION CON LAS DOS PATAS. Un movimiento de USDC
     suelto es fondear la cartera, y uno de moneda suelto es traspasarla entre
     carteras propias: ninguno de los dos es una compra ni una venta, y contar
     el fondeo como compra inflaria el coste de todas las rapidas. */
  for (const g of porHash.values()) {
    if (g.tok > 0 && g.usdc < 0) { puesto += -g.usdc; swaps += 1; }
    else if (g.tok < 0 && g.usdc > 0) { sacado += g.usdc; swaps += 1; }
  }

  return {
    neto: Math.max(0, puesto - sacado), puesto, sacado, swaps,
    bloques: ventanasLeidas * AS_VENTANA,
  };
}

function comoInt256(hex) {
  const v = BigInt("0x" + hex);
  return v >= (1n << 255n) ? v - (1n << 256n) : v;
}

async function costeDesdeLaCadena(w, ultimo) {
  if (!trToken || !trToken.pool) return null;
  const usdcEsToken0 = QUOTE.address.toLowerCase() < trToken.address.toLowerCase();
  const relleno = "0x" + w.address.slice(2).toLowerCase().padStart(64, "0");
  let puesto = 0, sacado = 0, swaps = 0, tramosLeidos = 0;

  for (let k = 0; k < LOGS_TRAMOS; k++) {
    const hasta = ultimo - k * LOGS_TRAMO;
    const desde = Math.max(0, hasta - LOGS_TRAMO + 1);
    if (hasta <= 0) break;
    let logs;
    try {
      logs = await rawCall("eth_getLogs", [{
        address: trToken.pool,
        fromBlock: "0x" + desde.toString(16),
        toBlock: "0x" + hasta.toString(16),
        topics: [SWAP_TOPIC, null, relleno],
      }]);
    } catch { break; }        // un tramo que falla corta y se dice cuanto se leyo
    tramosLeidos += 1;
    for (const l of logs || []) {
      const d = String(l.data).slice(2);
      /* amount0 y amount1 son los dos primeros int256 del data. El USDC es uno
       * u otro segun ordene la direccion, y eso se calcula, nunca se supone. */
      const a = comoInt256(d.slice(0, 64)), b = comoInt256(d.slice(64, 128));
      const usdc = usdcEsToken0 ? a : b;
      if (usdc > 0n) puesto += Number(ethers.formatUnits(usdc, QUOTE.decimals));
      else sacado += Number(ethers.formatUnits(-usdc, QUOTE.decimals));
      swaps += 1;
    }
  }
  return {
    neto: Math.max(0, puesto - sacado), puesto, sacado, swaps,
    bloques: tramosLeidos * LOGS_TRAMO,
  };
}

async function leerCostesReales() {
  const b = $("#fwCost"), nota = $("#fwRefreshNote");
  const log = fwLog();
  if (!trToken) { nota.textContent = "Paste a token address above first — the cost is per coin."; return; }
  /* Los Swap que se leen son los de UNA pool V3. Una moneda que va por V4 o por
   * un puente no tiene esa pool: su coste es lo que esta pagina apunto al operar. */
  if (trToken.motor) { nota.textContent = "The on-chain cost reader only knows V3 pools. " + trToken.symbol + " trades through V4 or a bridge, so its cost is what this page noted on each buy and sell."; return; }
  if (!rápida && !clúster.length) { nota.textContent = "No wallets to read."; return; }
  b.disabled = true;
  const antes = b.textContent;
  b.textContent = "reading the chain…";
  try {
    const ultimo = Number(BigInt(await rawCall("eth_blockNumber", [])));
    let horas = 0;
    /* La principal tambien, que desde el 8-sep compra y vende: leer el coste
     * de todas menos de una deja su P/L en "set what you paid" para siempre. */
    const filas = (rápida ? [[IDX_MADRE, rápida]] : []).concat(clúster.map((w, i) => [i, w]));
    for (const [i, w] of filas) {
      try {
        const r = await costeDesdeLaCadena(w, ultimo);
        if (!r) continue;
        horas = Math.max(horas, r.bloques * 0.5 / 3600);
        const t = costeTodo();
        t[costeClave(w.address, trToken.address)] = { puesto: r.puesto, sacado: r.sacado };
        try { localStorage.setItem(COSTE_KEY, JSON.stringify(t)); } catch {}
        log(etiquetaFila(i) + ": " + r.swaps + " swaps · in $" + r.puesto.toFixed(4) +
            " · out $" + r.sacado.toFixed(4) + " · net $" + r.neto.toFixed(4), "ok");
      } catch (e) { log(etiquetaFila(i) + ": " + readableError(e), "err"); }
    }
    nota.textContent = "Read from the pool's own Swap events — bought minus sold, " +
      "over the last " + horas.toFixed(1) + " h. Anything older is not counted.";
    await pintarClúster();
  } finally { b.disabled = false; b.textContent = antes; }
}
$("#fwCost").addEventListener("click", leerCostesReales);

/* ── QUE TIENEN ESTAS CARTERAS, SIN QUE SE LO DIGAS ──────────────────────
 *
 * La lista guardada solo sirve en el navegador donde compraste. En uno limpio
 * -- o despues de borrar datos -- no hay nada, y para vender hay que ir a
 * buscar la direccion a otro sitio. Absurdo, teniendo la cadena delante.
 *
 * Cada ERC-20 que llega a una cartera emite un `Transfer` con el destinatario
 * INDEXADO. Filtrando por ese tercer topic, SIN filtrar por contrato, salen
 * todos los tokens que han entrado ahi, y el `address` de cada log es el token.
 * Comprobado contra la cartera #0 del dueno: devuelve DAGG, el USDC y
 * 0xffff...fffe -- que es la direccion de sistema del gas, no un token, y por
 * eso se descarta explicitamente en vez de dejar que ensucie la lista.
 *
 * Luego se pregunta el saldo: solo entra en el desplegable lo que de verdad se
 * tiene, no lo que alguna vez se toco. */
const SENTINELA_GAS = "0xfffffffffffffffffffffffffffffffffffffffe";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function detectarMonedas() {
  const b = $("#fwFind"), nota = $("#fwRefreshNote");
  const log = fwLog();
  const carteras = rápida ? [rápida, ...clúster] : clúster.slice();
  if (!carteras.length) { nota.textContent = "Derive the fast wallet first."; return; }
  b.disabled = true;
  const antes = b.textContent;
  b.textContent = "looking…";
  try {
    const ultimo = Number(BigInt(await rawCall("eth_blockNumber", [])));
    const vistos = new Set();
    for (const w of carteras) {
      const relleno = "0x" + w.address.slice(2).toLowerCase().padStart(64, "0");
      for (let k = 0; k < LOGS_TRAMOS; k++) {
        const hasta = ultimo - k * LOGS_TRAMO;
        const desde = Math.max(0, hasta - LOGS_TRAMO + 1);
        if (hasta <= 0) break;
        let logs;
        try {
          logs = await rawCall("eth_getLogs", [{
            fromBlock: "0x" + desde.toString(16),
            toBlock: "0x" + hasta.toString(16),
            topics: [TRANSFER_TOPIC, null, relleno],
          }]);
        } catch { break; }
        for (const l of logs || []) {
          const a = String(l.address).toLowerCase();
          if (a === QUOTE.address.toLowerCase() || a === SENTINELA_GAS) continue;
          vistos.add(a);
        }
      }
    }
    if (!vistos.size) { nota.textContent = "No tokens found in these wallets."; return; }

    let añadidas = 0;
    for (const a of vistos) {
      try {
        /* Solo entra lo que TIENEN. Un token que paso por aqui y se vendio
         * entero no tiene por que aparecer en un desplegable de vender. */
        let algo = 0n;
        for (const w of carteras) {
          const [bal] = await callRead(a, ERC20_ABI, "balanceOf", [w.address]);
          algo += BigInt(bal);
          if (algo > 0n) break;
        }
        if (algo === 0n) continue;
        const m = await readToken(a);
        if (!m || m.unreachable) continue;
        const cuanto = await saldoTotalDe(a, m.decimals);
        monedaRecordar({ address: ethers.getAddress(a), symbol: m.symbol, decimals: m.decimals,
                         tiene: true, cuanto: cuanto === null ? undefined : cuanto });
        añadidas += 1;
        log("found " + m.symbol + "  " + a, "ok");
      } catch { /* un token ilegible no puede tumbar la busqueda */ }
    }
    nota.textContent = añadidas
      ? añadidas + (añadidas === 1 ? " coin" : " coins") + " found and added to the list — pick one by symbol."
      : "Nothing with a balance found in the last " + (LOGS_TRAMOS * LOGS_TRAMO * 0.5 / 3600).toFixed(0) + " h.";
  } finally { b.disabled = false; b.textContent = antes; }
}
$("#fwFind").addEventListener("click", detectarMonedas);

async function refrescarTodo() {
  const b = $("#fwRefresh"); const nota = $("#fwRefreshNote");
  b.disabled = true;
  const antes = b.textContent;
  b.textContent = "↻ reading…";
  try {
    await leerMercado();
    await pintarCarteras();
    /* Se revisa lo guardado: una moneda que ya se vendio entera tiene que dejar
     * de salir como que la tienes. Solo lo que ya esta en la lista -- esto no
     * busca nada, para eso esta el otro boton. */
    for (const m of monedasTodas()) {
      const cuanto = await saldoTotalDe(m.address, m.decimals);
      if (cuanto === null) continue;
      monedaRecordar({ address: m.address, symbol: m.symbol, decimals: m.decimals,
                       tiene: cuanto > 0, cuanto });
    }
    nota.textContent = mercado
      ? "Price and market cap quoted just now, through the Quoter."
      : (trToken ? "Could not quote it right now — no Arc node answered." : "Paste a token address to see its price here.");
  } catch (e) { nota.textContent = readableError(e); }
  finally { b.disabled = false; b.textContent = antes; }
}
$("#fwRefresh").addEventListener("click", refrescarTodo);

$("#fwAdd").addEventListener("click", () => ajustarClúster(clúster.length + 1));
/* NO SE QUITA UNA CARTERA CON DINERO DENTRO.
 * -----------------------------------------------------------------------
 * "Remove" no destruye: las hijas se derivan por indice, asi que quitar la
 * ultima y volver a anadirla devuelve LA MISMA direccion con lo que tuviera.
 * Eso es bueno -- no se pierde nada -- y es justo lo que lo hace peligroso:
 * la esconde de la lista, y con ella el dinero. Al cabo de un rato nadie se
 * acuerda de que existia.
 *
 * Diez centimos es el umbral porque por debajo de eso lo que hay es polvo de
 * gas, no una posicion: bloquear por dos centimos seria una puerta atascada.
 * Se mira el USDC y TAMBIEN las monedas que esta pagina conoce, porque una
 * cartera vacia de USDC puede estar llena de tokens.
 *
 * Si no se puede leer el saldo NO se quita. Un nodo mudo no es una cartera
 * vacia, y en la duda lo caro es esconder dinero. */
const POLVO_USDC = 0.10;

async function quitarUltima() {
  const log = fwLog();
  const nota = $("#fwCountNote");
  if (!clúster.length) return;
  const w = clúster[clúster.length - 1];
  const i = clúster.length - 1;
  const b = $("#fwDrop");
  b.disabled = true;
  const antes = b.textContent;
  b.textContent = "checking…";
  try {
    let usdc;
    try { usdc = aUSDC(await saldoDe(w.address)); }
    catch {
      nota.textContent = "Could not read #" + i + "'s balance, so it stays. " +
        "A silent node is not an empty wallet.";
      return;
    }
    if (usdc > POLVO_USDC) {
      nota.textContent = "#" + i + " still holds $" + usdc.toFixed(4) +
        ". Send it back first — removing would only hide it from this list, " +
        "and the wallet would still be there with the money in it.";
      return;
    }
    /* Y las monedas conocidas: sin esto se esconde una cartera sin USDC pero
     * llena de tokens, que es peor todavia. */
    for (const m of monedasTodas()) {
      try {
        const [bal] = await callRead(m.address, ERC20_ABI, "balanceOf", [w.address]);
        if (BigInt(bal) > 0n) {
          nota.textContent = "#" + i + " still holds " +
            Number(ethers.formatUnits(bal, m.decimals)).toLocaleString("es", { maximumFractionDigits: 0 }) +
            " " + m.symbol + ". Sell it or send it home first.";
          return;
        }
      } catch { /* una moneda ilegible no bloquea; el USDC ya se comprobo */ }
    }
    ajustarClúster(clúster.length - 1);
    log("#" + i + " removed from the list — the wallet still exists at " +
        w.address.slice(0, 10) + "…, and adding one back brings it home.", "ok");
  } finally { b.disabled = false; b.textContent = antes; }
}
$("#fwDrop").addEventListener("click", quitarUltima);

/* En conjunto, con lo que cada tarjeta tenga escrito: financiar las marcadas y
 * devolverlas todas. Uno a uno ya lo hace cada tarjeta. */
$("#trFundAll").addEventListener("click", async () => {
  for (const { i } of elegidas()) await financiarUna(i);
});
$("#trBackAll").addEventListener("click", async () => {
  for (let i = 0; i < clúster.length; i++) await devolverUna(i);
});

/* ── steps & wiring ─────────────────────────────────────────────────── */

function goStep(n) {
  /* La 7 se pinta al abrirla, no solo al conectar: sin esto el panel sale en
     blanco para quien entra sin cartera, que es justo quien necesita leer que
     hacer. */
  /* String(n), como el resto de la funcion: los botones pasan
     `s.dataset.step`, que es la CADENA "7", y `n === 7` no se cumplia nunca.
     El panel salia en blanco y el fallo no daba ningun error. */
  /* Las tres secciones se pintan al abrir la pestana, y AQUI, que es lo unico
     que corre siempre. Meterlo dentro de pintarClúster lo dejaba colgando de
     un retorno anticipado -- la tercera vez en este fichero que una rama de
     salida se come un pintado y la caja aparece vacia sin dar ningun error. */
  if (String(n) === "7") { pintarMonedas(); pintarCarteras(); pintarClúster(); planDeCompra(); }
  if (String(n) === "8") lpRefrescar();
  $$(".step").forEach((s) => s.classList.toggle("is-active", s.dataset.step === String(n)));
  $$("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== String(n); });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

renderFeatures();
renderOwnership();
renderFeeTiers();
renderRangePresets();
renderMetaModes();
renderVersions();
renderSupplyChips();
pintarModo();
pintarTramos();
pintarChips();
pintarPlan();
pintarMios();
syncMeta();
renderTokenList();
$("#poolTokenB").value = QUOTE.address;
refreshSource();

$("#connectBtn").addEventListener("click", connect);
$("#deployBtn").addEventListener("click", deployToken);
$("#createPoolBtn").addEventListener("click", createPool);
$("#addLiqBtn").addEventListener("click", addLiquidity);
$("#refreshPos").addEventListener("click", loadPositions);
$("#poolTokenA").addEventListener("input", onPairChange);
$("#poolTokenB").addEventListener("input", onPairChange);
$("#poolHooks").addEventListener("input", () => { state.hooks = $("#poolHooks").value.trim() || ethers.ZeroAddress; updateRangeOut(); });
$("#useUsdcBtn").addEventListener("click", () => { $("#poolTokenB").value = QUOTE.address; onPairChange(); });
for (const id of ["fName", "fSymbol", "fSupply", "fDecimals", "mImage", "mDescription", "mWebsite", "mTwitter", "mTelegram", "mUri"]) {
  $("#" + id).addEventListener("input", refreshSource);
}
$("#mMutable").addEventListener("change", refreshSource);
for (const id of ["rangeMin", "rangeMax", "tickLower", "tickUpper"]) $("#" + id).addEventListener("input", updateRangeOut);
$$(".step").forEach((s) => s.addEventListener("click", () => goStep(s.dataset.step)));
$$(".subtab").forEach((s) => s.addEventListener("click", () => {
  $$(".subtab").forEach((x) => x.classList.toggle("is-active", x === s));
  $$("[data-subpanel]").forEach((p) => { p.hidden = p.dataset.subpanel !== s.dataset.sub; });
  if (s.dataset.sub === "manage") pintarMios();
}));
$("#pRun").addEventListener("click", ejecutarPlan);
$("#mineRefresh").addEventListener("click", pintarMios);
for (const id of ["pName","pSym","pSupply","pMcap","pImage","pWeb","pTw","pTg","pDesc","pBuy","pTreasury"]) {
  $("#" + id).addEventListener("input", leerPlan);
}
$("#pEditable").addEventListener("change", leerPlan);
$("#pExisting").addEventListener("input", () => {
  clearTimeout(window._tkTimer);
  window._tkTimer = setTimeout(leerTokenExistente, 500);
});
$("#liqAMax").addEventListener("click", (e) => { e.preventDefault(); $("#liqA").value = e.target.dataset.value || "0"; });
$("#liqBMax").addEventListener("click", (e) => { e.preventDefault(); $("#liqB").value = e.target.dataset.value || "0"; });
$("#inspectBtn").addEventListener("click", async () => {
  const addr = $("#inspectAddr").value.trim();
  const box = $("#tokenList");
  if (!ethers.isAddress(addr)) { alert("That is not an address."); return; }
  box.textContent = "";
  const card = tokenCard({ address: ethers.getAddress(addr), name: "Inspecting", symbol: "?" });
  box.append(card);
  card.querySelector("button").click();
});

$("#editSourceBtn").addEventListener("click", () => {
  const ta = $("#sourceView");
  state.sourceEdited = !state.sourceEdited;
  ta.readOnly = !state.sourceEdited;
  $("#editSourceBtn").textContent = state.sourceEdited ? "Back to generated" : "Edit freely";
  $("#sourceNote").textContent = state.sourceEdited
    ? "You are editing this by hand. The switches no longer touch it, nothing is checked, and it is compiled and deployed exactly as written. Paste anything you like."
    : "Generated from the switches. No imports, nothing hidden — this is the whole thing. Edit it, paste your own, or take it and deploy it somewhere else entirely.";
  if (!state.sourceEdited) refreshSource(); else ta.focus();
});

$("#copySourceBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#sourceView").value);
    $("#copySourceBtn").textContent = "Copied";
    setTimeout(() => { $("#copySourceBtn").textContent = "Copy"; }, 1200);
  } catch { /* clipboard blocked; the textarea is selectable anyway */ }
});

onPairChange();
if (window.ethereum && window.ethereum.selectedAddress) connect();


/* ── LANZAR EN NUESTRA PROPIA LANZADERA ────────────────────────────────────
   La pestaña de al lado arma un token a medida con sus tramos de liquidez.
   Esta lanza en la Factory que desplegamos el 10-sep, donde la economia la
   pone el contrato: abre en $5.000, gradua en $50.000, 1% de comision y
   reparto 80/20. Todo lo que sabe de la cadena vive en launchpad.js.

   LO QUE NO SE PUEDE, Y LA PANTALLA LO DICE: crear el token y marcarlo como
   token de plataforma en la MISMA transaccion. `setPlatformToken` es
   onlyOwner y una cartera normal llama a una funcion por transaccion. Son
   dos firmas, y por eso son DOS BOTONES: con uno solo, si la segunda firma
   fallaba te quedabas sin saber si el token quedo puesto.

   Y VIVE EN EL PASO 8, no en una pestana del 6. */

function lpLog(t) {
  const c = $("#lpLog");
  if (!c) return;
  c.hidden = false;
  c.textContent += (c.textContent ? "\n" : "") + new Date().toLocaleTimeString() + "  " + t;
  c.scrollTop = c.scrollHeight;
}
function lpAviso(t) {
  const w = $("#lpWarn");
  if (!w) return;
  w.hidden = !t;
  w.textContent = t || "";
}

/* El minimo de tokens solo tiene sentido si hay compra, y el contrato lo
   EXIGE si la hay: `require(pairIn != 0 && minTokensOut != 0)`. */
function lpSincronizar() {
  const compra = Number(String($("#lpBuy") ? $("#lpBuy").value : "0").replace(/[^0-9.]/g, "")) || 0;
  const caja = $("#lpMinBox");
  if (caja) caja.hidden = !(compra > 0);
}

/* QUIEN FIRMA AQUI ES LA RAPIDA, y se pide explicitamente en vez de confiar
   en que `signer` ya lo sea. `signer` empieza siendo la wallet inyectada y
   solo pasa a ser la rapida cuando alguien la deriva. La lanzadera tiene de
   dueno la direccion de la rapida, asi que sin derivarla firmaria la
   principal: el lanzamiento SI entraria --es permisivo-- y la marca
   reventaria despues con NotOwner. El peor orden para enterarse. */
function lpFirmante() {
  if (!rápida) {
    throw new Error("Derive your fast wallet in step 7: it signs this, and it is the owner of the launchpad.");
  }
  return rápida;
}

/* EL ESTADO SE LE PREGUNTA AL CONTRATO, no a una direccion escrita aqui: si
   algun dia se cambia `platformWallet` con su setter, esta pantalla se entera
   sola. Se lee por el RPC propio y no por la wallet, para que el panel diga
   la verdad tambien sin conectar. Y ante un fallo de lectura NO se pinta un
   estado inventado: se dice que no se pudo leer. Pintar el estado equivocado
   ante una lectura fallida ya se pago en cusp-web. */
async function lpRefrescar() {
  const caja = $("#lpEstado");
  const boton = $("#lpMark");
  const quien = $("#lpQuienFirma");
  if (!caja) return;

  if (quien) {
    quien.textContent = rápida
      ? "Your fast wallet " + rápida.address.slice(0, 6) + "\u2026" + rápida.address.slice(-4) +
        " signs both buttons, so neither opens a popup."
      : "Derive your fast wallet in step 7 first. It signs here, and it is the owner of this launchpad.";
  }

  let e;
  try {
    e = await PAD.estado(proveedorRPC());
  } catch (err) {
    caja.textContent = "";
    const p = document.createElement("p");
    p.textContent = "Could not read the launchpad just now.";
    caja.append(p);
    if (boton) boton.disabled = true;
    return;
  }

  /* textContent y no innerHTML: aqui entran direcciones que vienen de la
     cadena, y este proyecto ya se comio un XSS por pintar con innerHTML. */
  caja.textContent = "";
  const filas = [
    ["Launches so far", String(e.lanzamientos)],
    ["Platform token", e.tienePlataforma ? e.token : "not set yet"],
    ["Launches", e.pausada ? "paused" : "open"],
    ["Owner", e.dueno],
  ];
  for (const par of filas) {
    const p = document.createElement("p");
    const b = document.createElement("b");
    b.textContent = par[0] + ": ";
    p.append(b, document.createTextNode(par[1]));
    caja.append(p);
  }
  if (e.lanzamientos === 0 && !e.tienePlataforma) {
    const p = document.createElement("p");
    p.textContent = "Nothing has launched here yet, so the next coin is number 0 \u2014 the one meant to be the platform token.";
    caja.append(p);
  }

  /* El boton de marcar mira al DUENO, que es quien puede llamar a
     `setCuspToken`, no a `platformWallet`, que solo cobra. Hoy son la misma
     direccion, y por eso preguntar por la equivocada no se veria. */
  if (boton) {
    const soyDueno = rápida ? await PAD.esElDueno(rápida.address, proveedorRPC()) : false;
    boton.disabled = e.tienePlataforma || !soyDueno;
    if (e.tienePlataforma) {
      lpAvisoMarca("This launchpad already has a platform token, and it cannot be changed.");
    } else if (!rápida) {
      lpAvisoMarca("Derive your fast wallet in step 7: it is the owner of this launchpad.");
    } else if (!soyDueno) {
      lpAvisoMarca("Your fast wallet is not the owner of this launchpad, so it cannot mark anything.");
    } else {
      lpAvisoMarca("");
    }
  }
}

/* EL RESULTADO, CON EL CA COPIABLE. Es lo primero que se necesita despues de
   lanzar y antes se quedaba en una linea del log. Cada direccion va en su
   fila con su boton, porque copiar las dos juntas obliga a recortar a mano.

   `textContent` en las dos, siempre: vienen de la cadena. Y si el
   portapapeles esta bloqueado no se avisa de nada -- el `<code>` se puede
   seleccionar igual, que es como se copia cuando el navegador no deja. */
function lpResultado(r) {
  const caja = $("#lpOut");
  if (!caja) return;
  caja.hidden = false;
  caja.textContent = "";

  const t = document.createElement("h3");
  t.textContent = "Launched";
  caja.append(t);

  const filas = [
    ["Token (CA)", r.token],
    ["Pool", r.pool],
    ["Transaction", r.hash],
  ];
  for (const par of filas) {
    if (!par[1]) continue;
    const fila = document.createElement("div");
    fila.className = "chips";
    const et = document.createElement("b");
    et.textContent = par[0];
    const dir = document.createElement("code");
    dir.textContent = par[1];
    const boton = document.createElement("button");
    boton.className = "btn btn-sm";
    boton.textContent = "Copy";
    boton.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(par[1]);
        boton.textContent = "Copied";
        setTimeout(function () { boton.textContent = "Copy"; }, 1200);
      } catch { /* bloqueado: el <code> se selecciona a mano igual */ }
    });
    fila.append(et, dir, boton);
    caja.append(fila);
  }
}

function lpAvisoMarca(t) {
  const w = $("#lpMarkWarn");
  if (!w) return;
  w.hidden = !t;
  w.textContent = t || "";
}

function lpLogMarca(t) {
  const c = $("#lpMarkLog");
  if (!c) return;
  c.hidden = false;
  c.textContent += (c.textContent ? "\n" : "") + new Date().toLocaleTimeString() + "  " + t;
  c.scrollTop = c.scrollHeight;
}

/* MARCAR, EN SU PROPIO BOTON. No hay tercera oportunidad: el contrato lleva
   `require(cuspToken == address(0))`. Por eso se confirma a mano, aunque la
   rapida firme sin ventana: lo que protege aqui no es la firma, es el aviso. */
async function lpMarcar() {
  const btn = $("#lpMark");
  lpAvisoMarca("");
  const dir = String($("#lpMarkAddr").value || "").trim();
  if (!ethers.isAddress(dir)) { lpAvisoMarca("That is not an address."); return; }
  if (!window.confirm("Mark " + dir + " as the platform token?\n\nThis cannot be undone, and only the first one counts.")) return;
  btn.disabled = true;
  const texto = btn.textContent;
  try {
    const firmante = lpFirmante();
    const h = await PAD.marcarComoPlataforma(firmante, dir, function (t) { btn.textContent = t; lpLogMarca(t); });
    lpLogMarca("marked: " + h);
    await lpRefrescar();
  } catch (err) {
    lpAvisoMarca(String(err.message || err));
    lpLogMarca("STOPPED: " + String(err.message || err));
  } finally {
    btn.textContent = texto;
    btn.disabled = false;
  }
}

function lpNumero(sel, decimales) {
  const v = String($(sel) ? $(sel).value : "0").replace(/[^0-9.]/g, "").trim();
  if (!v) return 0n;
  return ethers.parseUnits(v, decimales);
}

async function lpLanzar() {
  const btn = $("#lpRun");
  lpAviso("");
  if (!rápida) { lpAviso("Derive your fast wallet in step 7: it is the one that signs here."); return; }
  let datos;
  try {
    datos = {
      name: $("#lpName").value.trim(),
      symbol: $("#lpSym").value.trim(),
      metadataURI: PAD.metadata({
        description: $("#lpDesc").value.trim(),
        website: $("#lpWeb").value.trim(),
        twitter: $("#lpTw").value.trim(),
        telegram: $("#lpTg").value.trim(),
        image: $("#lpImage").value.trim(),
      }),
      supply: lpNumero("#lpSupply", 18),
      /* El campo se rellena en PORCENTAJE porque es lo que se entiende, y el
         contrato quiere puntos basicos. Se convierte aqui, en un solo sitio. */
      creatorBurnBps: Math.round((Number(String($("#lpBurn").value).replace(/[^0-9.]/g, "")) || 0) * 100),
      /* Lo pone el modulo desde el firmante, que es la rapida. Escribir aqui
         `account` cobraba a la wallet inyectada cuando aun no habia rapida. */
      feeRecipient: null,
      initialBuyPair: lpNumero("#lpBuy", 6),
      minTokensOut: lpNumero("#lpMinOut", 18),
    };
  } catch (e) { lpAviso(String(e.message || e)); return; }

  const malo = PAD.revisar(datos);
  if (malo.length) { lpAviso(malo.join(" ")); return; }

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  try {
    lpLog("launching " + datos.symbol + "…");
    const r = await PAD.lanzar(lpFirmante(), datos, (t) => { btn.textContent = t; lpLog(t); });
    lpLog("token " + r.token);
    lpLog("pool  " + r.pool);
    lpResultado(r);
    /* La direccion se deja escrita en el campo de marcar, que es el paso
       siguiente y el unico sitio donde hace falta. Se rellena solo si esta
       vacio: pisar algo que el dueno escribio a mano seria peor. */
    if (r.token && $("#lpMarkAddr") && !$("#lpMarkAddr").value.trim()) {
      $("#lpMarkAddr").value = r.token;
    }
    await lpRefrescar();
    lpLog("done.");
  } catch (e) {
    lpAviso(String(e.message || e));
    lpLog("STOPPED: " + String(e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

if ($("#lpRun")) {
  $("#lpAddr").textContent = PAD.LANZADERA;
  $("#lpBuy").addEventListener("input", lpSincronizar);
  lpSincronizar();
  $("#lpRun").addEventListener("click", lpLanzar);
  $("#lpMark").addEventListener("click", lpMarcar);
}
