/* LA ACADEMIA · the trench — front for the memecoin engine (contract in
 * academia/CONTRATO-WEB.md plus the trench additions: tipo "trinchera",
 * positions per token, the `trinchera` block and GET /estado/token/<mint>).
 *
 * Where the data comes from, in this order: the page's own origin when the
 * engine itself serves the page (localhost or the droplet behind cloudflared),
 * then http://localhost:4360 (an engine on this PC), then the public engine
 * host, and finally the published snapshot academia/estado.json.
 *
 * House rules kept here: no page reloads (DOM is patched in place, each block
 * only re-rendered when its signature changes, so nothing flickers), no
 * requestAnimationFrame for entrances (background tabs freeze it; CSS
 * transitions and setTimeout instead), no transforms on chart ancestors. */

/* equity de un puesto: el motor la manda (equity); si no, efectivo + importe + P&L abierto de cada posicion */
function equityDe(a) { if (!a) return 0; if (typeof a.equity === 'number') return a.equity; return (a.saldo || 0) + Object.values(a.posiciones || {}).reduce((x, q) => x + (q.importe || 0) + (q.pnlAbierto || 0), 0); }


import { initOficina, updateOficina, fichaExtraHTML, agoShort, DISPARO_LABEL } from './academia-oficina.js?v=3';

const ENGINE_LOCAL = 'http://localhost:4360';
const ENGINE_DEV_TUNNEL = 'http://localhost:4365';   // development only: an ssh tunnel to the droplet engine (fails instantly when there is none)
const ENGINE_PUBLIC = 'https://trinchera.oligarc.xyz';
const SNAPSHOT = 'academia/estado.json';
const REFRESH_MS = 15000;
const TIMEOUT_MS = 3000;

function apiCandidates() {
  const list = [];
  const own = /^https?:$/.test(location.protocol) && !/basey\.finance|github\.io/i.test(location.host);
  if (own) list.push(location.origin);          // the engine serves the page itself
  list.push(ENGINE_LOCAL, ENGINE_DEV_TUNNEL, ENGINE_PUBLIC);
  return [...new Set(list)];
}

const S = {
  data: null,          // last /estado
  live: false,         // an engine answered
  api: null,           // base URL of the engine that answered (for /estado/token, POST /consejo…)
  fetchedAt: 0,
  failures: 0,
  sig: {},             // per-block render signatures
  prevPop: null,       // Set of ids in the hall last render
  births: new Map(),   // id -> time first seen (for the hall animation)
  deaths: new Map(),   // id -> {t, x, y, color} fading out
  layout: [],          // hall cells for hit-testing: {id, x, y, r}
  lastGen: -1,
  animTimer: null,
  feedSeen: new Set(),
  trenchSeen: null,    // Set of mints seen in the trench lists (to light up the new ones)
  busy: false,
};

const $ = (id) => document.getElementById(id);

/* ── small helpers ─────────────────────────────────────── */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function num(n, d = 2) {
  if (n == null || !isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function money(n) { return n == null || !isFinite(n) ? '—' : (n < 0 ? '−$' : '$') + num(Math.abs(n), 2); }
function pct(n, d = 2, sign = true) {
  if (n == null || !isFinite(n)) return '—';
  const s = sign && n > 0 ? '+' : '';
  return s + num(n, d) + '%';
}
function cls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat'; }
function price(p) {
  if (p == null || !isFinite(p)) return '—';
  if (p >= 1000) return num(p, 0);
  if (p >= 1) return num(p, 2);
  if (p >= 0.01) return num(p, 4);
  if (p >= 0.0001) return num(p, 6);
  return Number(p).toPrecision(3);
}
function compactUsd(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + num(n / 1e9, 2) + 'B';
  if (a >= 1e6) return '$' + num(n / 1e6, 2) + 'M';
  if (a >= 1e4) return '$' + num(n / 1e3, 1) + 'k';
  if (a >= 1e3) return '$' + num(n / 1e3, 2) + 'k';
  return '$' + num(n, 0);
}
function compactN(n) {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1e6) return num(n / 1e6, 1) + 'M';
  if (n >= 1e4) return num(n / 1e3, 1) + 'k';
  return num(n, 0);
}
function ago(t, now = Date.now()) {
  if (!t) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 48) return h + 'h ' + (m % 60) + 'm ago';
  return Math.floor(h / 24) + 'd ago';
}
function minsLabel(m) {
  if (m == null || !isFinite(m)) return '—';
  if (m < 60) return Math.round(m) + ' min';
  if (m < 48 * 60) return Math.floor(m / 60) + ' h ' + Math.round(m % 60) + ' min';
  return Math.floor(m / 1440) + ' d';
}
function dur(ms) {
  if (ms == null || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
function dateShort(t) {
  if (!t) return '—';
  const d = new Date(t);
  return d.toISOString().slice(5, 10).replace('-', '/') + ' ' + d.toISOString().slice(11, 16);
}
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function setHTML(el, html, key) {
  // only touch the DOM when the signature changed: that is what keeps it from flickering
  if (S.sig[key] === html) return false;
  S.sig[key] = html;
  el.innerHTML = html;
  return true;
}
function setText(el, txt) { if (el.textContent !== txt) el.textContent = txt; }
function shortAddr(a) { a = String(a || ''); return a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a; }

/* ── vocabulary of the trench ──────────────────────────── */
const DISPARO = {
  flujo: { label: 'flow reader', what: (d) => `at least ${d.netos5Min} net buyers and ${Math.round((d.ratioComprasMin || 0) * 100)}% or more buys in the last 5 minutes` },
  listos: { label: 'copycat', what: (d) => `at least ${d.listos10Min} watched wallet${d.listos10Min === 1 ? '' : 's'} bought in the last 10 minutes` },
  momentum: { label: 'chaser', what: (d) => `price up ${d.dPrecio5Min}% or more in 5 minutes with more buys than sells` },
  holders: { label: 'community believer', what: (d) => `holders up ${d.dHolders5Min}% or more in 5 minutes and buyers above sellers` },
  rebote: { label: 'knife catcher', what: (d) => `after an hour down ${d.caida1hMin}% or more: the first green minute with more buys than sells` },
  nacimiento: { label: 'trench rat', what: (d) => `a token under 15 minutes old with at least ${d.netos5Min} net buyers and up ${d.subidaMin}% or more since the last minute` },
  devVendio: { label: 'dev-dump buyer', what: (d) => `the dev sold ${d.devVendioMin}% or more of its bag in the last 15 minutes and at least ${d.netos5Min} net buyers keep coming with more buys than sells` },
  tuit: { label: 'tweet chaser', what: (d) => `a watched X account posted the contract address at most ${d.tuitMaxMin} min ago and at least ${d.netos5Min} net buyers followed` },
};
const DISPARO_ORDER = ['flujo', 'listos', 'momentum', 'holders', 'rebote', 'nacimiento', 'devVendio', 'tuit'];
function disparoLabel(t) { return DISPARO[t]?.label || DISPARO_LABEL?.[t] || t || 'strategy'; }
const PAD_LABEL = { 'sin pad': 'no pad', cualquiera: 'any pad', 'pump.fun': 'pump.fun', launchlab: 'LaunchLab', 'met-dbc': 'Meteora DBC', stonkfun: 'stonk.fun' };
function padLabel(p) { return PAD_LABEL[p] || p || 'no pad'; }
const MOTIVO = { objetivo: 'target', stop: 'stop', trailing: 'trailing', tiempo: 'time up', 'listos fuera': 'smart money left', muerto: 'rug', fin: 'data end', 'sin subida': 'no pump', 'dev vende': 'dev sold', despido: 'closed: fired' };
function motivoHTML(m) {
  if (m === 'muerto') return `<span class="why rug skull">rug</span>`;
  const warn = m === 'dev vende' || m === 'despido' ? ' warn' : '';
  return `<span class="why${warn}">${esc(MOTIVO[m] || m || '')}</span>`;
}
function hourKeyLabel(k) {
  // "2026-10-10T09" -> "10/10 09:00" ; a bare "9" (hour of day) -> "09:00"
  const s = String(k ?? '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(s)) return s.slice(5, 10).replace('-', '/') + ' ' + s.slice(11, 13) + ':00';
  return String(s).padStart(2, '0') + ':00';
}
function winRate(ganadas, ops) { return ops ? Math.round((ganadas || 0) / ops * 100) + '%' : '—'; }

/* ── avatars: deterministic from the id (identicon with a frame shape) ── */
function avatarSVG(id, extraClass = '') {
  const h = hash(String(id || 'x'));
  const hue = h % 360;
  const hue2 = (hue + 40 + ((h >>> 8) % 80)) % 360;
  const shape = (h >>> 16) % 4;
  const bg = `hsl(${hue} 45% 16%)`;
  const fg = `hsl(${hue} 80% 62%)`;
  const fg2 = `hsl(${hue2} 85% 70%)`;
  // 5x5 symmetric pixel face from the hash bits
  let cells = '';
  let bits = h ^ (h >>> 7) ^ Math.imul(h, 2654435761);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const on = (bits >>> ((y * 3 + x) % 31)) & 1;
      const alt = (bits >>> ((y * 3 + x + 13) % 31)) & 1;
      if (on) {
        const c = alt ? fg2 : fg;
        cells += `<rect x="${12 + x * 8}" y="${12 + y * 8}" width="8" height="8" fill="${c}"/>`;
        if (x < 2) cells += `<rect x="${12 + (4 - x) * 8}" y="${12 + y * 8}" width="8" height="8" fill="${c}"/>`;
      }
    }
  }
  let frame;
  if (shape === 0) frame = `<rect x="2" y="2" width="60" height="60" rx="14" fill="${bg}"/>`;
  else if (shape === 1) frame = `<circle cx="32" cy="32" r="30" fill="${bg}"/>`;
  else if (shape === 2) frame = `<polygon points="32,2 61,18 61,46 32,62 3,46 3,18" fill="${bg}"/>`;
  else frame = `<polygon points="32,2 62,32 32,62 2,32" fill="${bg}"/>`;
  return `<svg class="avatar ${extraClass}" viewBox="0 0 64 64" aria-hidden="true">${frame}${cells}</svg>`;
}

/* ── data access ───────────────────────────────────────── */
async function fetchJSON(url, opts = {}, timeout = TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function load() {
  if (S.busy) return;
  S.busy = true;
  try {
    let data = null, live = false, api = null;
    // the engine that answered last time gets two tries (it restarts now and then), the others one
    const cands = apiCandidates();
    if (S.api && cands.includes(S.api)) cands.splice(cands.indexOf(S.api), 1), cands.unshift(S.api);
    for (const base of cands) {
      const tries = base === S.api ? 2 : 1;
      for (let i = 0; i < tries && !data; i++) {
        try { data = await fetchJSON(base + '/estado'); live = true; api = base; }
        catch (e) { if (i + 1 < tries) await new Promise((r) => setTimeout(r, 1200)); }
      }
      if (data) break;
    }
    if (!data) { try { data = await fetchJSON(SNAPSHOT, {}, 8000); } catch (e2) { data = null; } }
    if (data) {
      S.data = data; S.live = live; S.api = live ? api : S.api; S.fetchedAt = Date.now(); S.failures = 0;
    } else {
      S.failures++;
    }
    render();
  } finally { S.busy = false; }
}

function stateMap() {
  // id -> best object we know (desk, fired, full agent from the hall tops, or hall summary)
  const d = S.data; const m = new Map();
  if (!d) return m;
  const ev = d.evolucion;
  if (ev) {
    for (const p of ev.poblacion || []) m.set(p.id, { kind: 'hall', ...p });
    for (const a of [...(ev.top || []), ...(ev.topValidados || []), ev.mejorValidado].filter(Boolean)) m.set(a.id, { kind: 'agent', ...a });
  }
  for (const f of d.academia?.despedidos || []) m.set(f.id, { kind: 'fired', ...f });
  for (const p of d.academia?.puestos || []) if (p.agente) m.set(p.agente.id, { kind: 'desk', puesto: p.n, ...p.agente });
  return m;
}
function liveTokens() { const d = S.data; return d?.trinchera?.vivos ?? d?.academia?.tokensVivos ?? null; }

/* ── header ────────────────────────────────────────────── */
function renderHeader() {
  const d = S.data; const st = $('status');
  const now = Date.now();
  if (!d) {
    st.innerHTML = `<span class="dot dead"></span><span>engine offline and no snapshot</span>`;
    setHTML($('ticker'), `<span class="empty">the trench is dark — no engine reachable and academia/estado.json is missing</span>`, 'ticker');
    return;
  }
  const age = now - (d.cuando || S.fetchedAt);
  const wrongType = d.tipo !== 'trinchera';
  if (S.live) {
    const host = S.api === location.origin ? 'this host' : S.api.replace(/^https?:\/\//, '');
    st.innerHTML = `<span class="dot live"></span><span>live · engine at ${esc(host)} · data ${esc(ago(d.cuando, now))}</span>`;
  } else {
    const min = Math.max(0, Math.round(age / 60000));
    st.innerHTML = `<span class="dot snap"></span><span>snapshot from ${min} min ago${wrongType ? ' · old Hyperliquid academy' : ''}</span>`;
  }
  // the strip under the title: what the trench looks like now
  const tr = d.trinchera;
  let html = '';
  if (tr) {
    html += `<span><b>live tokens</b>${num(tr.vivos, 0)}</span><span><b>seen today</b>${num(tr.hoy, 0)}</span>`;
    const pads = Object.entries(tr.porPad || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [p, n] of pads) html += `<span class="pad"><b>${esc(padLabel(p))}</b>${num(n, 0)}</span>`;
    const ev = d.evolucion;
    if (ev?.tokens) html += `<span><b>history</b>${num(ev.tokens, 0)} tokens</span>`;
  } else html = `<span class="empty">${wrongType ? 'this snapshot has no trench block' : 'no trench data yet'}</span>`;
  setHTML($('ticker'), html, 'ticker');
}

function renderClock() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const left = next - now.getTime();
  const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000), s = Math.floor((left % 60000) / 1000);
  const b = $('clock').querySelector('b');
  setText(b, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
}

/* ── the office ────────────────────────────────────────── */
function sparkline(curva) {
  const pts = (curva || []).map((p) => p[1]).filter((v) => isFinite(v));
  if (pts.length < 2) pts.push(...(pts.length ? [pts[0]] : [100, 100]));
  const W = 200, H = 34, pad = 2;
  let lo = Math.min(...pts), hi = Math.max(...pts);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const xs = pts.map((v, i) => [pad + (i / (pts.length - 1)) * (W - pad * 2), pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2)]);
  const line = xs.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = `${xs[0][0].toFixed(1)},${H} ` + line + ` ${xs[xs.length - 1][0].toFixed(1)},${H}`;
  const up = pts[pts.length - 1] >= pts[0];
  const color = up ? '#3fbf7f' : '#e05260';
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polygon class="fill" points="${area}"/><polyline points="${line}" stroke="${color}"/></svg>`;
}

function estadoLabel(e) {
  return e === 'cumple' ? 'performing' : e === 'observacion' ? 'probation' : e === 'despedido' ? 'fired' : (e || '—');
}
function estadoPill(e) {
  const c = e === 'cumple' ? 'ok' : e === 'observacion' ? 'warn' : e === 'despedido' ? 'bad' : 'dim';
  return `<span class="pill ${c}">${esc(estadoLabel(e))}</span>`;
}

function positionRows(ag, full = false, now = Date.now()) {
  const pos = ag.posiciones || {};
  const keys = Object.keys(pos);
  if (!keys.length) return '';
  let html = '';
  for (const mint of keys) {
    const p = pos[mint];
    const pnl = p.pnlAbierto;
    const pctOpen = p.importe ? pnl / p.importe * 100 : null;
    const mins = p.t ? (now - p.t) / 60000 : null;
    html += `<div class="pos-row"><span class="sym" data-token="${esc(p.mint || mint)}">${esc(p.simbolo || shortAddr(mint))}</span>` +
      `<span title="market cap when it bought">in @ ${compactUsd(p.mcap)}</span>` +
      `<span class="${cls(pnl)}">${money(pnl)} ${pctOpen != null ? '(' + pct(pctOpen, 0) + ')' : ''}</span>` +
      `<span title="minutes inside">${minsLabel(mins)}</span>` +
      `<span class="dis">${esc(disparoLabel(p.disparo))}</span>` +
      (full ? `<span>· bought ${price(p.entrada)} · now ${price(p.precio)} · high ${price(p.max)} (×${p.entrada ? num(p.max / p.entrada, 2) : '—'}) · liq ${compactUsd(p.liq)} · ${p.listosAlEntrar ?? 0} watched wallets at entry · $${num(p.importe, 0)} in</span>` : '') +
      `</div>`;
  }
  return html;
}

function deskHTML(p, now) {
  if (!p.agente) {
    return `<div class="desk-n">desk ${p.n}</div><div class="desk-vacant">` +
      `<svg class="chair-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4h12v8H6zM5 12h14v3H5zM7 15v5M17 15v5"/></svg>` +
      `<span class="pill dim">vacant</span><span>waiting for the first validated candidates</span></div>`;
  }
  const a = p.agente;
  const eqDesk = equityDe(a); // lo que vale el puesto: efectivo + posiciones abiertas (el saldo solo es el efectivo libre)
  const pnlPct = a.saldoInicial ? (eqDesk - a.saldoInicial) / a.saldoInicial * 100 : 0;
  const ops = (a.operaciones || []).slice(0, 3);
  let trades = '';
  if (ops.length) {
    trades = `<div class="desk-trades">` + ops.map((o) =>
      `<div class="trade-row"><b>${esc(o.simbolo || shortAddr(o.mint))}</b><span class="${cls(o.pnl)}">${pct(o.pct, 0)}</span>${motivoHTML(o.motivo)}</div>`).join('') + `</div>`;
  } else {
    trades = `<div class="desk-empty">no trades yet</div>`;
  }
  const posHtml = positionRows(a, false, now);
  // nothing open: say what it is doing instead
  let waiting = '';
  if (!Object.keys(a.posiciones || {}).length) {
    const vivos = liveTokens();
    const last = (a.operaciones || [])[0];
    waiting = `<div class="desk-wait">Hired ${esc(agoShort(a.contratado, now))} · scanning ${vivos != null ? num(vivos, 0) : '?'} live tokens` +
      ` · last buy ${last ? esc(agoShort(last.tIn, now)) + ' (' + esc(last.simbolo || shortAddr(last.mint)) + ')' : 'none yet'}</div>`;
  }
  const rugs = (a.operaciones || []).filter((o) => o.motivo === 'muerto').length;
  return `<div class="desk-n">desk ${p.n}</div>` +
    `<div class="desk-head">${avatarSVG(a.id)}<div style="min-width:0"><div class="desk-name">${esc(a.nombre)}</div><div class="desk-strategy">${esc(a.descripcion || '')}</div></div></div>` +
    `<div class="desk-money"><span class="bal">${money(eqDesk)}</span><span class="pnl ${cls(pnlPct)}">${pct(pnlPct)}</span></div>` +
    `<div class="desk-badge">${estadoPill(a.estado)}<span class="pill dim">DD ${num(a.maxDDPct, 1)}%</span>${a.estado === 'observacion' && a.diasObservacion ? `<span class="pill warn">day ${a.diasObservacion}</span>` : ''}${rugs ? `<span class="pill bad" title="positions that went to zero">${rugs} rug${rugs > 1 ? 's' : ''}</span>` : ''}</div>` +
    sparkline(a.curva) +
    (posHtml ? `<div class="desk-pos">${posHtml}</div>` : '') +
    waiting +
    trades;
}

function renderOffice() {
  const d = S.data; const wrap = $('desks');
  const puestos = d?.academia?.puestos || Array.from({ length: 10 }, (_, i) => ({ n: i + 1, agente: null }));
  const now = Date.now();
  // summary
  const hired = puestos.filter((p) => p.agente);
  const libro = d?.academia?.libro || null; // el libro mayor: P&L de todas las mesas desde que se abrio, no se reinicia
  const bal = hired.reduce((s, p) => s + equityDe(p.agente), 0);
  const ini = hired.reduce((s, p) => s + (p.agente.saldoInicial || 0), 0);
  const inPos = hired.reduce((s, p) => s + Object.values(p.agente.posiciones || {}).reduce((x, q) => x + (q.importe || 0) + (q.pnlAbierto || 0), 0), 0);
  const pnl = bal - ini; // bal ya incluye las posiciones (equity)
  const open = hired.reduce((s, p) => s + Object.keys(p.agente.posiciones || {}).length, 0);
  const perf = hired.filter((p) => p.agente.estado === 'cumple').length;
  const prob = hired.filter((p) => p.agente.estado === 'observacion').length;
  const rugs = hired.reduce((s, p) => s + (p.agente.operaciones || []).filter((o) => o.motivo === 'muerto').length, 0);
  const trades = hired.reduce((s, p) => s + (p.agente.operaciones || []).length, 0);
  setHTML($('officeSummary'),
    `<div class="stat"><div class="k">hired</div><div class="v">${hired.length}<small> / ${puestos.length}</small></div></div>` +
    `<div class="stat"><div class="k">equity (paper)</div><div class="v">${money(bal)}<small> · ${money(inPos)} in tokens</small></div></div>` +
    `<div class="stat"><div class="k">P&amp;L (desks now)</div><div class="v ${cls(pnl)}">${money(pnl)}<small> ${ini ? pct(pnl / ini * 100) : ''}</small></div></div>` +
    (libro ? `<div class="stat"><div class="k">ledger since ${new Date(libro.desde).toISOString().slice(5, 16).replace('T', ' ')} UTC</div><div class="v ${cls(libro.total)}">${money(libro.total)}<small> · ${libro.operaciones} trades, ${libro.rugs} rugs (${num(libro.rugsPorHora, 1)}/h), ${libro.despedidos} fired</small></div></div>` : '') +
    `<div class="stat"><div class="k">open · performing · probation</div><div class="v">${open}<small> · </small><span class="pos">${perf}</span><small> · </small><span style="color:var(--caution)">${prob}</span></div></div>`,
    'officeSummary');
  const r = d?.academia?.riesgo || {};
  setText($('officeSub'), `${hired.length} of ${puestos.length} desks taken · $${num(r.importe ?? 10, 0)} per token, ${r.maxAbiertas ?? 5} open at most, $${num(d?.academia?.saldoPuesto ?? r.saldo ?? 100, 0)} per desk · ${trades} trades, ${rugs} rug${rugs === 1 ? '' : 's'} eaten`);

  // one element per desk, patched only when its own signature changes
  if (wrap.children.length !== puestos.length) {
    wrap.innerHTML = puestos.map((p) => `<button class="desk vacant" type="button" data-n="${p.n}"></button>`).join('');
  }
  puestos.forEach((p, i) => {
    const el = wrap.children[i];
    const a = p.agente;
    const sig = JSON.stringify([a?.id, a?.estado, a?.saldo, a?.maxDDPct, a?.diasObservacion, a?.posiciones, (a?.operaciones || []).slice(0, 3), (a?.curva || []).length, (a?.curva || []).slice(-1), liveTokens(), Math.floor(now / 60000)]);
    if (S.sig['desk' + p.n] === sig) return;
    S.sig['desk' + p.n] = sig;
    el.className = 'desk' + (a ? '' : ' vacant');
    el.dataset.estado = a?.estado || '';
    el.dataset.id = a?.id || '';
    el.innerHTML = deskHTML(p, now);
  });
}

/* ── office hours: the ledger hour by hour ─────────────── */
function hoursChart(rows) {
  // rows come newest first; draw oldest -> newest, one bar per hour, the current hour outlined
  const list = rows.slice().reverse();
  if (!list.length) return '';
  // the viewBox follows the real width so the axis text keeps its size on a phone (same trick as the history chart)
  const W = Math.max(320, Math.round(($('hoursBody')?.clientWidth || 760) - 18)), H = 110, L = 44, R = 8, T = 10, B = 20;
  const nowKey = new Date().toISOString().slice(0, 13);
  let hi = 0; for (const r of list) hi = Math.max(hi, Math.abs(r.pnl || 0));
  if (hi <= 0) hi = 1;
  const y0 = T + (H - T - B) / 2;
  const scale = (H - T - B) / 2 / hi;
  const slot = (W - L - R) / list.length;
  const bw = Math.max(2, Math.min(22, slot * 0.72));
  let out = `<line class="grid" x1="${L}" x2="${W - R}" y1="${y0.toFixed(1)}" y2="${y0.toFixed(1)}"/>`;
  out += `<text class="axis" x="${L - 4}" y="${T + 4}" text-anchor="end">${money(hi)}</text><text class="axis" x="${L - 4}" y="${(y0 + 3).toFixed(1)}" text-anchor="end">$0</text><text class="axis" x="${L - 4}" y="${H - B}" text-anchor="end">${money(-hi)}</text>`;
  list.forEach((r, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    const h = Math.abs(r.pnl || 0) * scale;
    const y = r.pnl >= 0 ? y0 - h : y0;
    const cur = r.hora === nowKey;
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="1.5" fill="${r.pnl > 0 ? '#3fbf7f' : r.pnl < 0 ? '#e05260' : '#6b7684'}" opacity="${cur ? 1 : 0.8}"><title>${esc(hourKeyLabel(r.hora))} UTC · ${esc(money(r.pnl))} · ${r.ops} trades · ${r.rugs} rugs</title></rect>`;
    if (cur) out += `<rect x="${(x - 2).toFixed(1)}" y="${T - 4}" width="${(bw + 4).toFixed(1)}" height="${H - T - B + 8}" rx="3" fill="none" stroke="#5b8cff" stroke-width="1" stroke-dasharray="3 2"/>`;
    if (list.length <= 12 || i % Math.ceil(list.length / 8) === 0 || i === list.length - 1) out += `<text class="axis" x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(String(r.hora).slice(11, 13) || hourKeyLabel(r.hora))}h</text>`;
  });
  return `<div class="hours-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${out}</svg></div>`;
}
function renderHours() {
  const lib = S.data?.academia?.libro;
  const rows = (lib?.porHoraOficina || []).slice(0, 48);
  const el = $('hoursBody');
  if (!lib || !Array.isArray(lib.porHoraOficina)) {
    setHTML(el, `<div class="notice">This engine does not publish the ledger by hour yet (academia.libro.porHoraOficina).</div>`, 'hours');
    setText($('hoursSub'), 'no hourly ledger');
    return;
  }
  const nowKey = new Date().toISOString().slice(0, 13);
  const sig = JSON.stringify(rows) + nowKey + '@' + (el.clientWidth || 0);
  if (S.sig.hours === sig) return; S.sig.hours = sig;
  const tot = rows.reduce((s, r) => s + (r.pnl || 0), 0);
  const green = rows.filter((r) => r.pnl > 0).length;
  setText($('hoursSub'), rows.length ? `last ${rows.length} hour${rows.length === 1 ? '' : 's'} with trades · ${money(tot)} realized · ${green} green, ${rows.length - green} red · best and worst desk of each hour` : 'no closed trade yet this session');
  if (!rows.length) { el.innerHTML = `<div class="notice">No closed trade yet since the ledger started${lib.desde ? ' (' + dateShort(lib.desde) + ' UTC)' : ''}.</div>`; return; }
  const trows = rows.map((r) => {
    const cur = r.hora === nowKey;
    const best = r.mejor ? `<span class="hb"><i>best</i><b>${esc(r.mejor.nombre)}</b> <span class="${cls(r.mejor.pnl)}">${money(r.mejor.pnl)}</span><small> ${r.mejor.ops} trade${r.mejor.ops === 1 ? '' : 's'}</small></span>` : `<span class="hb"><i>best</i>—</span>`;
    const worst = r.peor ? `<span class="hb"><i>worst</i><b>${esc(r.peor.nombre)}</b> <span class="${cls(r.peor.pnl)}">${money(r.peor.pnl)}</span><small> ${r.peor.ops} trade${r.peor.ops === 1 ? '' : 's'}</small></span>` : `<span class="hb"><i>worst</i>${r.mejor ? 'only one desk traded' : '—'}</span>`;
    return `<div class="hrow${cur ? ' now' : ''}" data-hour="${esc(r.hora)}">` +
      `<div class="h1"><span class="hh">${esc(hourKeyLabel(r.hora))}${cur ? ' <em>now</em>' : ''}</span><span class="hp ${cls(r.pnl)}">${money(r.pnl)}</span>` +
      `<span class="hm"><b>${r.ops}</b> trades</span><span class="hm"><b class="${r.rugs ? 'neg' : ''}">${r.rugs}</b> rug${r.rugs === 1 ? '' : 's'}</span><span class="hm">win <b>${winRate(r.ganadas, r.ops)}</b></span></div>` +
      `<div class="h2">${best}${worst}</div></div>`;
  }).join('');
  el.innerHTML = hoursChart(rows) + `<div class="hrows">${trows}</div>`;
}

/* ── hall of fame: everyone who sat at a desk, best to worst ─ */
function fameRows() {
  const d = S.data; const lib = d?.academia?.libro;
  const rank = (lib?.ranking || []).map((r) => ({ ...r, fromLedger: true }));
  const ids = new Set(rank.map((r) => r.id));
  // the fired ones the ledger has not seen (hired before it, or before the last restart): from their dismissal file
  const base = d?.academia?.saldoPuesto ?? d?.academia?.riesgo?.saldo ?? 100;
  const extra = (d?.academia?.despedidos || []).filter((f) => !ids.has(f.id)).map((f) => ({
    id: f.id, nombre: f.nombre, pnl: f.netoPct != null ? f.netoPct / 100 * base : null, ops: f.operaciones, ganadas: null, rugs: null,
    contratado: f.contratado, despedido: f.despedido, motivoDespido: f.motivo, sentado: false, mejorEquity: null, disparo: null, descripcion: f.descripcion, fromLedger: false,
  }));
  const all = [...rank, ...extra];
  all.sort((a, b) => ((b.pnl ?? -1e9) - (a.pnl ?? -1e9)) || ((b.ops || 0) - (a.ops || 0)));
  return all;
}
function renderFame() {
  const d = S.data; const lib = d?.academia?.libro;
  const el = $('fameBody');
  if (!lib || !Array.isArray(lib.ranking)) {
    setHTML(el, `<div class="notice">This engine does not publish the ranking yet (academia.libro.ranking).</div>`, 'fame');
    setText($('fameSub'), 'no ranking');
    return;
  }
  const rows = fameRows();
  const sitting = rows.filter((r) => r.sentado).length;
  const sig = JSON.stringify(rows.map((r) => [r.id, r.pnl, r.ops, r.sentado, r.despedido]));
  setText($('fameSub'), `${rows.length} trader${rows.length === 1 ? '' : 's'} through the desks · ${sitting} sitting now · ${rows.length - sitting} gone · realized P&L, best to worst${lib.desde ? ' · ledger since ' + dateShort(lib.desde) + ' UTC' : ''}`);
  if (S.sig.fame === sig) return; S.sig.fame = sig;
  if (!rows.length) { el.innerHTML = `<div class="notice">Nobody has closed a trade yet.</div>`; return; }
  const now = Date.now();
  el.innerHTML = `<div class="fame-list">` + rows.map((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
    const status = r.sentado ? `<span class="pill ok">sitting</span>` :
      r.despedido ? `<span class="pill bad" title="${esc(r.motivoDespido || '')}">fired ${esc(agoShort(r.despedido, now))}</span>` : `<span class="pill dim">gone</span>`;
    const why = !r.sentado && r.motivoDespido ? `<div class="fw">${esc(r.motivoDespido)}</div>` : '';
    const file = r.fromLedger ? '' : `<span class="pill dim" title="hired before the ledger started: P&L estimated from its net % on the starting balance">from its file</span>`;
    return `<button class="frow${r.sentado ? ' sitting' : ''}" type="button" data-open="${esc(r.id)}">` +
      `<span class="fn">${medal}</span>${avatarSVG(r.id)}` +
      `<span class="fmain"><span class="fname">${esc(r.nombre)}${r.disparo ? ` <span class="pill pad">${esc(disparoLabel(r.disparo))}</span>` : ''} ${status}${file}</span>` +
      `<span class="fstats"><span class="${cls(r.pnl)}"><b>${money(r.pnl)}</b></span><span><b>${r.ops ?? '—'}</b> trades</span><span>win <b>${r.ganadas != null ? winRate(r.ganadas, r.ops) : '—'}</b></span><span><b class="${r.rugs ? 'neg' : ''}">${r.rugs ?? '—'}</b> rugs</span><span>best equity <b>${r.mejorEquity != null ? money(r.mejorEquity) : '—'}</b></span><span>hired ${esc(dateShort(r.contratado))}</span></span>${why}</span></button>`;
  }).join('') + `</div>`;
}

/* ── the trench: what the desks are scanning ──────────── */
function safeDot(s) { return `<i class="sdot ${s === true ? 'ok' : s === false ? 'bad' : ''}" title="${s === true ? 'safety check passed' : s === false ? 'flagged by the safety check' : 'not checked yet'}"></i>`; }
function trowHTML(f, now) {
  const age = f.edadMin != null ? minsLabel(f.edadMin) : ago(f.nacido, now);
  return `<button class="trow" type="button" data-token="${esc(f.mint)}" data-k="${esc(f.mint)}">` +
    `<div class="l1">${safeDot(f.segura)}<span class="sym">${esc(f.simbolo || shortAddr(f.mint))}</span><span class="pill pad">${esc(padLabel(f.launchpad))}</span><span class="age">${esc(age)} old</span><span class="d5 ${cls(f.dPrecio5)}">${pct(f.dPrecio5, 1)} <small>5m</small></span></div>` +
    `<div class="l2"><span>mcap <b>${compactUsd(f.mcap)}</b></span><span>liq <b>${compactUsd(f.liq)}</b></span><span>holders <b>${compactN(f.holders)}</b></span>` +
    `<span title="buyers minus sellers, 5 min">net <b class="${cls(f.netos5)}">${f.netos5 > 0 ? '+' : ''}${num(f.netos5, 0)}</b> <small>(${num(f.b5, 0)}/${num(f.s5, 0)})</small></span>` +
    `<span title="watched wallets buying, 10 min">smart <b class="sm">${num(f.listos10, 0)}</b></span>` +
    `<span title="wallets that bought within 2 s of the first buy">snipers <b class="sn">${f.snipers >= 0 ? num(f.snipers, 0) : '?'}</b></span>` +
    `<span title="1 hour price change" class="${cls(f.dPrecio1h)}">${pct(f.dPrecio1h, 0)} 1h</span></div></button>`;
}
function renderTrench() {
  const d = S.data; const tr = d?.trinchera;
  const now = Date.now();
  if (!tr) {
    setHTML($('trenchCounters'), `<div class="notice" style="grid-column:1/-1">No trench block in this data: the engine that wrote it is not the memecoin one.</div>`, 'trenchCounters');
    for (const id of ['trenchBorn', 'trenchHot', 'trenchSmart']) setHTML($(id), '', id);
    setText($('trenchSub'), 'no trench data');
    return;
  }
  const pads = Object.entries(tr.porPad || {}).sort((a, b) => b[1] - a[1]);
  setHTML($('trenchCounters'),
    `<div class="stat"><div class="k">live tokens</div><div class="v">${num(tr.vivos, 0)}<small> with a photo in the last 15 min</small></div></div>` +
    `<div class="stat"><div class="k">seen today</div><div class="v">${num(tr.hoy, 0)}<small> tokens with history</small></div></div>` +
    `<div class="stat pads"><div class="k">by launchpad (today)</div><div class="padlist">${pads.length ? pads.map(([p, n]) => `<span><b>${num(n, 0)}</b> ${esc(padLabel(p))}</span>`).join('') : '<span>nothing yet</span>'}</div></div>`,
    'trenchCounters');
  setText($('trenchSub'), `${num(tr.vivos, 0)} live · ${num(tr.hoy, 0)} seen today · ${num((tr.recientes || []).length, 0)} born in the last hour · ${num((tr.conListos || []).length, 0)} with smart money`);
  const lists = [['trenchBorn', tr.recientes || [], 'Nothing born in the last hour — or the recorder is between photos.'], ['trenchHot', tr.calientes || [], 'No live token right now.'], ['trenchSmart', tr.conListos || [], 'No watched wallet bought anything live in the last 10 minutes.']];
  const seen = S.trenchSeen || new Set(); const first = !S.trenchSeen;
  const all = new Set();
  for (const [id, rows, empty] of lists) {
    const sig = rows.map((f) => f.mint + ':' + f.mcap + ':' + f.netos5 + ':' + f.listos10 + ':' + f.dPrecio5).join('|') + '@' + Math.floor(now / 60000);
    for (const f of rows) all.add(f.mint);
    if (S.sig[id] === sig) continue;
    S.sig[id] = sig;
    $(id).innerHTML = rows.length ? rows.map((f) => trowHTML(f, now)).join('') : `<div class="notice">${empty}</div>`;
    if (!first) for (const el of $(id).children) if (el.dataset.k && !seen.has(el.dataset.k)) el.classList.add('new');
  }
  S.trenchSeen = all;
  setTimeout(() => { for (const el of document.querySelectorAll('.trow.new')) el.classList.remove('new'); }, 1500);
}

/* ── the token file (modal) ───────────────────────────── */
function light(label, state, value, hint = '') {
  return `<div class="light ${state}" title="${esc(hint)}"><i></i><span>${esc(label)}</span><span class="lv">${esc(value)}</span></div>`;
}
function safetyLights(seg, r) {
  if (!seg) return `<div class="notice">No safety report yet for this token (RugCheck / GoPlus are asked a few minutes after birth).</div>`;
  const out = [];
  out.push(light('mint authority', seg.mintAuth ? 'bad' : 'ok', seg.mintAuth ? 'still active' : 'revoked', 'whoever holds it can print more tokens'));
  out.push(light('freeze authority', seg.freezeAuth ? 'bad' : 'ok', seg.freezeAuth ? 'still active' : 'revoked', 'whoever holds it can freeze your wallet'));
  out.push(light('transfer fee', seg.transferFee > 0 ? 'bad' : 'ok', seg.transferFee > 0 ? num(seg.transferFee, 1) + '%' : 'none', 'a tax on every transfer'));
  out.push(light('transfer hook / honeypot', seg.hook ? 'bad' : 'ok', seg.hook ? 'yes' : 'no', 'GoPlus: code that runs on every transfer'));
  out.push(light('mintable (GoPlus)', seg.mintable ? 'bad' : 'ok', seg.mintable ? 'yes' : 'no'));
  out.push(light('freezable (GoPlus)', seg.freezable ? 'bad' : 'ok', seg.freezable ? 'yes' : 'no'));
  out.push(light('rugged (RugCheck)', seg.rugged ? 'bad' : 'ok', seg.rugged ? 'YES' : 'no'));
  const lp = Math.max(seg.lpLocked || 0, seg.quemada || 0);
  out.push(light('LP locked or burned', lp >= 80 ? 'ok' : lp >= 20 ? 'warn' : 'bad', num(lp, 1) + '%', 'liquidity the dev cannot pull'));
  const top = seg.top10;
  out.push(light('top 10 holders', top == null ? '' : top < 30 ? 'ok' : top < 50 ? 'warn' : 'bad', top == null ? '?' : num(top, 1) + '%', 'share of the supply in ten wallets'));
  out.push(light('insiders', seg.insiders > 5 ? 'bad' : seg.insiders > 0 ? 'warn' : 'ok', String(seg.insiders ?? 0), 'RugCheck: wallets linked to the creator'));
  if (seg.creadorSaldo != null) out.push(light('creator balance', '', num(seg.creadorSaldo, 2) + ' SOL · ' + (seg.creadorTokens ?? '?') + ' tokens'));
  if (seg.score != null) out.push(light('RugCheck score', '', String(seg.score), 'as RugCheck gives it'));
  let html = `<div class="lights">${out.join('')}</div>`;
  if ((seg.riesgos || []).length) html += `<ul class="risks">${seg.riesgos.map((x) => `<li>${esc(typeof x === 'string' ? x : x.name || x.nombre || JSON.stringify(x))}${x.description ? ' — ' + esc(x.description) : ''}</li>`).join('')}</ul>`;
  html += `<div class="loading" style="margin-top:6px">checked ${esc(ago(seg.t))} · the desk filter "safe only" means: no mint or freeze authority, no transfer fee, no hook, not rugged${r ? ` · this one is <b class="${r.segura === true ? 'pos' : r.segura === false ? 'neg' : ''}">${r.segura === true ? 'SAFE' : r.segura === false ? 'FLAGGED' : 'not checked'}</b>` : ''}</div>`;
  return html;
}
function firstBuyers(pri, r) {
  if (!pri) return `<div class="notice">First buyers not recorded for this token (the first transactions are fetched a few minutes after birth).</div>`;
  const counts = new Map();
  for (const w of pri.wallets || []) counts.set(w, (counts.get(w) || 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  return `<div class="tk-now" style="margin-bottom:8px">` +
    `<div class="stat"><div class="k">first txs</div><div class="v">${num(pri.n, 0)}</div></div>` +
    `<div class="stat"><div class="k">buyers</div><div class="v">${num(pri.compradores, 0)}</div></div>` +
    `<div class="stat"><div class="k">snipers</div><div class="v ${pri.snipers > 5 ? 'bad' : pri.snipers > 0 ? 'warn' : 'ok'}">${num(pri.snipers, 0)}<small> within 2 s</small></div></div>` +
    `<div class="stat"><div class="k">SOL by snipers</div><div class="v">${num(pri.solSnipers, 2)}</div></div></div>` +
    (rows.length ? `<ul class="wallets">${rows.map(([w, n]) => `<li><span class="w" title="${esc(w)}">${esc(shortAddr(w))}</span><span>${n > 1 ? n + ' buys' : '1 buy'}</span></li>`).join('')}</ul>` : '') +
    `<div class="loading" style="margin-top:6px">first buy ${pri.primeroT ? esc(dateShort(pri.primeroT)) + ' UTC' : '—'} · a sniper is a wallet that bought within 2 seconds of the first buy; if the token survives their exit, that is a signal</div>`;
}
function watchedWallets(listos, r) {
  if (!listos || !listos.length) return `<div class="notice">No watched wallet has bought this token${r?.listos10 ? '' : ' (watched wallets = a seed of profitable traders that grows on its own)'}.</div>`;
  const by = new Map();
  for (const [t, w, sol] of listos) { const x = by.get(w) || { n: 0, sol: 0, last: 0 }; x.n++; x.sol += sol || 0; x.last = Math.max(x.last, t); by.set(w, x); }
  const rows = [...by.entries()].sort((a, b) => b[1].last - a[1].last).slice(0, 12);
  const total = listos.reduce((s, l) => s + (l[2] || 0), 0);
  return `<div class="loading" style="margin-bottom:6px">${listos.length} buys by ${by.size} watched wallet${by.size === 1 ? '' : 's'} · ${num(total, 2)} SOL in total${r ? ` · ${r.listos10 ?? 0} in the last 10 min` : ''}</div>` +
    `<ul class="wallets">${rows.map(([w, x]) => `<li><span class="w" title="${esc(w)}">${esc(shortAddr(w))}</span><span>${x.n} buy${x.n > 1 ? 's' : ''} · ${num(x.sol, 2)} SOL · ${esc(ago(x.last))}</span></li>`).join('')}</ul>`;
}
function tokenChart(fotos) {
  const pts = (fotos || []).filter((f) => f.t && (f.mcap > 0 || f.precio > 0));
  if (pts.length < 2) return `<div class="notice">Not enough photos for a chart yet.</div>`;
  const W = 760, H = 170, L = 46, R = 44, T = 10, B = 22;
  const useMcap = pts.some((f) => f.mcap > 0);
  const val = (f) => useMcap ? f.mcap || 0 : f.precio || 0;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const xs = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  let lo = Infinity, hi = -Infinity; for (const f of pts) { const v = val(f); if (v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < hi * 0.02) { hi *= 1.01; lo *= 0.99; }
  const pad = (hi - lo) * 0.06; lo = Math.max(0, lo - pad); hi += pad;
  const ys = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  // holders and liquidity only get a line when they actually moved (> 3 %): a flat line on its own scale is pure noise
  let holders = pts.map((f) => f.holders).filter((h) => h > 0);
  let hLo = holders.length ? Math.min(...holders) : 0, hHi = holders.length ? Math.max(...holders) : 1;
  const flatNote = [];
  if (holders.length > 1 && (hHi - hLo) / hHi < 0.03) { flatNote.push(`holders flat at ${compactN(hHi)}`); holders = []; }
  const liqAll = pts.filter((f) => f.liq > 0).map((f) => f.liq);
  const liqMoved = liqAll.length > 1 && (Math.max(...liqAll) - Math.min(...liqAll)) / Math.max(...liqAll) >= 0.03;
  if (liqAll.length > 1 && !liqMoved) flatNote.push(`liquidity flat at ${compactUsd(liqAll[liqAll.length - 1])}`);
  const yh = (h) => T + (1 - (h - hLo) / Math.max(1, hHi - hLo)) * (H - T - B);
  let out = '';
  for (let i = 0; i <= 3; i++) {
    const v = lo + (hi - lo) * i / 3; const y = ys(v);
    out += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    out += `<text class="axis" x="${L - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end">${useMcap ? compactUsd(v) : price(v)}</text>`;
  }
  if (holders.length > 1) for (let i = 0; i <= 2; i++) { const h = hLo + (hHi - hLo) * i / 2; out += `<text class="axis" x="${W - R + 4}" y="${(yh(h) + 3).toFixed(1)}" fill="#d9a441">${compactN(h)}</text>`; }
  out += `<text class="axis" x="${L}" y="${H - 6}">${esc(dateShort(t0))}</text><text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(dateShort(t1))} UTC</text>`;
  const line = pts.map((f) => `${xs(f.t).toFixed(1)},${ys(val(f)).toFixed(1)}`).join(' ');
  out += `<polygon class="mfill" points="${xs(t0).toFixed(1)},${(H - B).toFixed(1)} ${line} ${xs(t1).toFixed(1)},${(H - B).toFixed(1)}"/>`;
  const up = val(pts[pts.length - 1]) >= val(pts[0]);
  out += `<polyline points="${line}" fill="none" stroke="${up ? '#3fbf7f' : '#e05260'}" stroke-width="1.8" vector-effect="non-scaling-stroke"/>`;
  if (holders.length > 1) { const hp = pts.filter((f) => f.holders > 0).map((f) => `${xs(f.t).toFixed(1)},${yh(f.holders).toFixed(1)}`).join(' '); out += `<polyline points="${hp}" fill="none" stroke="#d9a441" stroke-width="1.2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`; }
  const liqs = liqMoved ? pts.filter((f) => f.liq > 0) : [];
  if (liqs.length > 1) { const lLo = Math.min(...liqs.map((f) => f.liq)), lHi = Math.max(...liqs.map((f) => f.liq)); const yl = (v) => T + (1 - (v - lLo) / Math.max(1e-9, lHi - lLo)) * (H - T - B); out += `<polyline points="${liqs.map((f) => `${xs(f.t).toFixed(1)},${yl(f.liq).toFixed(1)}`).join(' ')}" fill="none" stroke="#5b8cff" stroke-width="1" stroke-dasharray="2 3" opacity=".8" vector-effect="non-scaling-stroke"/>`; }
  return `<div class="tchart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${out}</svg>` +
    `<div class="tchart-legend"><span><i style="background:${up ? '#3fbf7f' : '#e05260'}"></i>${useMcap ? 'market cap' : 'price'} (left axis)</span>${holders.length > 1 ? '<span><i style="background:#d9a441"></i>holders (right axis)</span>' : ''}${liqs.length > 1 ? '<span><i style="background:#5b8cff"></i>liquidity (own scale)</span>' : ''}<span>${pts.length} photos</span>${flatNote.length ? `<span>${esc(flatNote.join(' · '))}</span>` : ''}</div></div>`;
}
async function openToken(mint) {
  const modal = $('modal'), box = $('modalBox');
  modal.hidden = false; setTimeout(() => modal.classList.add('show'), 10);
  box.innerHTML = `<div class="modal-head"><div><h3>Loading…</h3></div><button class="modal-close" type="button" data-close>×</button></div><div class="loading">Fetching the file of ${esc(shortAddr(mint))}</div>`;
  if (!S.live || !S.api) { box.querySelector('.loading').textContent = 'Token files are only available while an engine is live (this is a snapshot).'; box.querySelector('h3').textContent = shortAddr(mint); return; }
  let t;
  try { t = await fetchJSON(S.api + '/estado/token/' + encodeURIComponent(mint), {}, 8000); }
  catch (e) { box.querySelector('.loading').textContent = /404/.test(e.message) ? 'Gone from the trench: the engine no longer has this token among today\'s.' : 'Could not fetch the token file: ' + e.message; box.querySelector('h3').textContent = shortAddr(mint); return; }
  const r = t.rasgos || {};
  const sym = t.simbolo || shortAddr(mint);
  const now = Date.now();
  let html = `<div class="modal-head"><div class="tk-logo">${esc(String(sym).slice(0, 4).toUpperCase())}</div><div style="min-width:0"><h3>${esc(sym)}${t.nombre && t.nombre !== sym ? ` <span style="color:var(--text-faint);font-weight:400;font-size:14px">${esc(t.nombre)}</span>` : ''}</h3>` +
    `<div class="mh-sub"><span class="pill pad">${esc(padLabel(t.launchpad))}</span>${r.graduado ? '<span class="pill ok">graduated</span>' : t.launchpad === 'pump.fun' ? '<span class="pill dim">on the curve</span>' : ''}${r.marketing ? '<span class="pill warn">paid marketing</span>' : ''}<span>· born ${esc(ago(t.nacido, now))}</span><span>· ${esc(shortAddr(mint))}</span></div></div><button class="modal-close" type="button" data-close>×</button></div>`;
  html += `<div class="modal-body">`;
  html += `<div><h4>Now</h4><div class="tk-now">` +
    `<div class="stat"><div class="k">price</div><div class="v">${price(r.precio)}</div></div>` +
    `<div class="stat"><div class="k">market cap</div><div class="v">${compactUsd(r.mcap)}</div></div>` +
    `<div class="stat"><div class="k">liquidity</div><div class="v ${r.liq < 1000 ? 'bad' : ''}">${compactUsd(r.liq)}</div></div>` +
    `<div class="stat"><div class="k">holders</div><div class="v">${compactN(r.holders)}</div></div>` +
    `<div class="stat"><div class="k">5 min</div><div class="v ${cls(r.dPrecio5)}">${pct(r.dPrecio5, 1)}</div></div>` +
    `<div class="stat"><div class="k">1 hour</div><div class="v ${cls(r.dPrecio1h)}">${pct(r.dPrecio1h, 1)}</div></div>` +
    `<div class="stat"><div class="k">buys / sells (5 min)</div><div class="v">${num(r.b5, 0)}<small> / ${num(r.s5, 0)}</small> <span class="${cls(r.netos5)}" style="font-size:14px">${r.netos5 > 0 ? '+' : ''}${num(r.netos5, 0)} net</span></div></div>` +
    `<div class="stat"><div class="k">organic score</div><div class="v">${r.organico != null ? num(r.organico, 0) : '—'}<small> / 100</small></div></div>` +
    `</div><div class="loading" style="margin-top:6px">age ${esc(minsLabel(r.edadMin))} · ${num(r.traders5, 0)} traders in 5 min · volume 5 min ${compactUsd(r.vol5)} · dev minted ${num(r.devMints, 0)} token${r.devMints === 1 ? '' : 's'} before${r.devMigraciones ? `, ${r.devMigraciones} graduated` : ''}</div></div>`;
  html += `<div><h4>Price · market cap</h4>${tokenChart(t.fotos)}</div>`;
  html += `<div><h4>Safety</h4>${safetyLights(t.seguridad, r)}</div>`;
  html += `<div><h4>First buyers &amp; snipers</h4>${firstBuyers(t.primeros, r)}</div>`;
  html += `<div><h4>Watched wallets that bought</h4>${watchedWallets(t.listos, r)}</div>`;
  html += `<div><h4>Addresses</h4><div class="tk-meta">` +
    `<div class="addr"><b>mint</b> ${esc(mint)}</div>` +
    (t.dev ? `<div class="addr"><b>dev</b> ${esc(t.dev)}</div>` : '') +
    (t.creador && t.creador !== t.dev ? `<div class="addr"><b>creator</b> ${esc(t.creador)}</div>` : '') +
    `<div><a href="https://solscan.io/token/${encodeURIComponent(mint)}" target="_blank" rel="noopener">open in Solscan ↗</a></div></div></div>`;
  html += `</div>`;
  box.innerHTML = html;
}

/* ── the hall ──────────────────────────────────────────── */
function valColor(val, alpha = 1) {
  // -60 .. +60 -> red .. amber .. green
  const v = Math.max(-60, Math.min(60, val ?? -60));
  const t = (v + 60) / 120;
  const hue = Math.round(t * 125);           // 0 red -> 125 green
  const light = 45 + t * 10;
  return `hsl(${hue} 70% ${light}% / ${alpha})`;
}
function drawShape(ctx, tipo, x, y, r) {
  ctx.beginPath();
  switch (tipo) {
    case 'flujo': ctx.arc(x, y, r, 0, Math.PI * 2); break;
    case 'listos': ctx.rect(x - r, y - r, r * 2, r * 2); break;
    case 'momentum': ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.1, y + r * 0.85); ctx.lineTo(x - r * 1.1, y + r * 0.85); ctx.closePath(); break;
    case 'holders': ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.2, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r * 1.2, y); ctx.closePath(); break;
    case 'rebote': ctx.moveTo(x, y + r * 1.15); ctx.lineTo(x + r * 1.1, y - r * 0.85); ctx.lineTo(x - r * 1.1, y - r * 0.85); ctx.closePath(); break;
    case 'nacimiento': {
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const rr = i % 2 ? r * 0.55 : r * 1.3; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath(); break;
    }
    case 'devVendio': {   // pentagon
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 5; const px = x + Math.cos(a) * r * 1.15, py = y + Math.sin(a) * r * 1.15; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath(); break;
    }
    case 'tuit': {        // plus sign
      const t = r * 0.42, R = r * 1.2;
      ctx.moveTo(x - t, y - R); ctx.lineTo(x + t, y - R); ctx.lineTo(x + t, y - t); ctx.lineTo(x + R, y - t); ctx.lineTo(x + R, y + t); ctx.lineTo(x + t, y + t);
      ctx.lineTo(x + t, y + R); ctx.lineTo(x - t, y + R); ctx.lineTo(x - t, y + t); ctx.lineTo(x - R, y + t); ctx.lineTo(x - R, y - t); ctx.lineTo(x - t, y - t);
      ctx.closePath(); break;
    }
    default: ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

function renderHall() {
  const d = S.data; const ev = d?.evolucion;
  const stats = $('hallStats');
  if (!ev) {
    setHTML(stats, `<div class="notice" style="grid-column:1/-1">The hall is empty: the evolution engine has not started yet (evolucion is null).</div>`, 'hallStats');
    setText($('hallSub'), 'no population');
    S.layout = [];
    drawHall([], new Set(), new Set());
    setHTML($('candidates'), '', 'cand');
    return;
  }
  const hist = ev.historia || [];
  const last = hist[hist.length - 1] || {};
  const msAvg = hist.length ? Math.round(hist.slice(-10).reduce((s, h) => s + (h.ms || 0), 0) / Math.min(10, hist.length)) : null;
  const running = ev.empezado ? dur(Date.now() - ev.empezado) : '—';
  const stallLim = ev.config?.estancadoTras || 15;
  const stallCls = ev.estancado >= stallLim ? 'bad' : ev.estancado >= stallLim / 2 ? 'warn' : '';
  const div = last.diversidad;
  const divCls = div != null ? (div < 0.15 ? 'bad' : div < 0.3 ? 'warn' : 'ok') : '';
  setHTML(stats,
    `<div class="stat gen"><div class="k">generation</div><div class="v">${ev.generacion ?? 0}</div></div>` +
    `<div class="stat"><div class="k">stagnant for</div><div class="v ${stallCls}">${ev.estancado ?? 0}<small> gen</small></div></div>` +
    `<div class="stat"><div class="k">diversity</div><div class="v ${divCls}">${div != null ? num(div, 2) : '—'}</div></div>` +
    `<div class="stat"><div class="k">profitable in validation</div><div class="v">${last.rentablesVal ?? '—'}<small> / ${(ev.poblacion || []).length}${last.operan != null ? ' · ' + last.operan + ' trading' : ''}</small></div></div>` +
    `<div class="stat"><div class="k">speed</div><div class="v">${msAvg != null ? num(msAvg / 1000, 1) : '—'}<small> s / gen</small></div></div>` +
    `<div class="stat"><div class="k">running for</div><div class="v">${esc(running)}</div></div>` +
    `<div class="stat"><div class="k">best validated</div><div class="v ${cls(ev.mejorValidado?.validacion?.netoPct)}">${ev.mejorValidado ? pct(ev.mejorValidado.validacion?.netoPct, 1) : '—'}</div></div>`,
    'hallStats');
  const n = (ev.poblacion || []).length;
  setText($('hallSub'), `${n} chairs · ${ev.config?.elite ?? '?'} elite · mutation ${Math.round((ev.config?.pMutacion || 0) * 100)}% · crossover ${Math.round((ev.config?.pCruce || 0) * 100)}% · ${ev.config?.inmigrantes ?? 0} immigrants · validation = last ${Math.round((ev.config?.validacionPct || 0) * 100)}% of the recorded time · ${ev.tokens ?? '?'} tokens with history · no trigger type above 25% of the hall`);

  // births/deaths against the previous population
  const pop = ev.poblacion || [];
  const ids = new Set(pop.map((p) => p.id));
  const now = Date.now();
  if (S.prevPop && ev.generacion !== S.lastGen) {
    for (const id of ids) if (!S.prevPop.has(id)) S.births.set(id, now);
    for (const c of S.layout) if (!ids.has(c.id) && !S.deaths.has(c.id)) S.deaths.set(c.id, { t: now, x: c.x, y: c.y, r: c.r, tipo: c.tipo, val: c.p?.val });
  }
  S.prevPop = ids; S.lastGen = ev.generacion;
  // prune old animation entries
  for (const [id, t] of S.births) if (now - t > 1600) S.births.delete(id);
  for (const [id, v] of S.deaths) if (now - v.t > 1600) S.deaths.delete(id);

  const deskIds = new Set((d.academia?.puestos || []).filter((p) => p.agente).map((p) => p.agente.id));
  drawHall(pop, deskIds, ids);
  if ((S.births.size || S.deaths.size) && !S.animTimer && !document.hidden) {
    // a short setTimeout loop (no rAF): ~1.5 s of fades
    let frames = 0;
    const tick = () => {
      frames++;
      drawHall(S.data?.evolucion?.poblacion || [], deskIds, ids);
      if (frames < 18) S.animTimer = setTimeout(tick, 85); else { S.animTimer = null; S.births.clear(); S.deaths.clear(); drawHall(S.data?.evolucion?.poblacion || [], deskIds, ids); }
    };
    S.animTimer = setTimeout(tick, 85);
  }

  // candidates (top validated)
  const cands = (ev.topValidados || []).slice(0, 8);
  setHTML($('candidates'), cands.map((a) =>
    `<button class="cand" type="button" data-open="${esc(a.id)}"><div class="ch">${avatarSVG(a.id)}<div class="cn" style="min-width:0">${esc(a.nombre)}</div></div>` +
    `<div class="cv"><span>val <b class="${cls(a.validacion?.netoPct)}">${pct(a.validacion?.netoPct, 1)}</b></span><span>${esc(disparoLabel(a.g?.disparo?.tipo))} g${a.generacion}</span></div></button>`).join(''), 'cand');
}

function drawHall(pop, deskIds, aliveIds) {
  const canvas = $('hallCanvas');
  const wrap = $('hallWrap');
  const W = Math.max(280, wrap.clientWidth || 360);
  const small = W < 600;
  const cell = small ? 14 : 18;
  const padX = 12, padTop = 8, labelH = 18, groupGap = 10;
  const cols = Math.max(8, Math.floor((W - padX * 2) / cell));
  const groups = new Map();
  for (const t of DISPARO_ORDER) groups.set(t, []);
  for (const p of pop) { if (!groups.has(p.tipo)) groups.set(p.tipo, []); groups.get(p.tipo).push(p); }
  for (const g of groups.values()) g.sort((a, b) => (b.val ?? -999) - (a.val ?? -999) || (b.fit ?? 0) - (a.fit ?? 0));
  const fits = pop.map((p) => p.fit ?? 0).sort((a, b) => a - b);
  const fitLo = fits[0] ?? 0, fitHi = fits[fits.length - 1] ?? 1;

  // layout
  const layout = []; let y = padTop; const labels = [];
  for (const [tipo, list] of groups) {
    if (!list.length && !DISPARO_ORDER.includes(tipo)) continue;
    labels.push({ y: y + 12, text: `${disparoLabel(tipo)} · ${list.length}` });
    y += labelH;
    list.forEach((p, i) => {
      const cx = padX + (i % cols) * cell + cell / 2;
      const cy = y + Math.floor(i / cols) * cell + cell / 2;
      const frac = fitHi > fitLo ? ((p.fit ?? 0) - fitLo) / (fitHi - fitLo) : 0.5;
      const r = (cell / 2) * (0.42 + 0.5 * frac);
      layout.push({ id: p.id, x: cx, y: cy, r, tipo: p.tipo, color: valColor(p.val), p });
    });
    y += Math.max(1, Math.ceil(list.length / cols)) * cell + groupGap;
    if (!list.length) y += 4;
  }
  const H = Math.max(120, y + 4);
  S.layout = layout;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  // floor
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0f1319'); grad.addColorStop(1, '#0b0e12');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1;
  for (let gx = padX; gx < W; gx += cell * 4) { ctx.beginPath(); ctx.moveTo(gx + .5, 0); ctx.lineTo(gx + .5, H); ctx.stroke(); }
  ctx.font = `600 10px ${getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'}`;
  ctx.fillStyle = '#6b7684'; ctx.textBaseline = 'middle';
  for (const l of labels) ctx.fillText(l.text.toUpperCase(), padX, l.y);
  if (!pop.length) {
    ctx.fillStyle = '#6b7684'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('no chairs yet', W / 2, H / 2); ctx.textAlign = 'left';
  }
  const now = Date.now();
  // fading out: the replaced ones
  for (const [, v] of S.deaths) {
    const a = Math.max(0, 1 - (now - v.t) / 1500);
    if (a <= 0) continue;
    ctx.fillStyle = valColor(v.val, a * 0.9);
    drawShape(ctx, v.tipo, v.x, v.y, v.r * (1 + (1 - a) * 0.6)); ctx.fill();
  }
  for (const c of layout) {
    const born = S.births.get(c.id);
    let a = 1, r = c.r;
    if (born) { const k = Math.min(1, (now - born) / 1200); a = 0.25 + 0.75 * k; r = c.r * (1.6 - 0.6 * k); }
    ctx.globalAlpha = a;
    ctx.fillStyle = c.color;
    drawShape(ctx, c.tipo, c.x, c.y, r); ctx.fill();
    if (born && a < 1) { ctx.strokeStyle = 'rgba(255,255,255,' + (1 - a) + ')'; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (deskIds.has(c.id)) { ctx.strokeStyle = '#5b8cff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, cell / 2 - 1, 0, Math.PI * 2); ctx.stroke(); }
  }
}

function hallClick(ev) {
  const canvas = $('hallCanvas');
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  let best = null, bd = 1e9;
  for (const c of S.layout) { const dd = (c.x - x) ** 2 + (c.y - y) ** 2; if (dd < bd) { bd = dd; best = c; } }
  const card = $('chairCard');
  if (!best || bd > 12 * 12) { card.classList.remove('show'); setTimeout(() => { if (!card.classList.contains('show')) card.hidden = true; }, 200); return; }
  const p = best.p;
  card.innerHTML = `<div class="cc-head">${avatarSVG(p.id)}<div style="min-width:0"><div class="cc-name">${esc(p.nombre)}</div><div class="cc-sub">gen ${p.gen} · ${esc(originLabel(p.origen))} · ${esc(disparoLabel(p.tipo))}</div></div></div>` +
    `<div class="cc-row"><span>launchpad filter</span><b>${esc(padLabel(p.intervalo))}</b></div>` +
    `<div class="cc-row"><span>training score</span><b>${num(p.fit, 1)}</b></div>` +
    `<div class="cc-row"><span>validation score</span><b class="${cls(p.val)}">${num(p.val, 1)}</b></div>` +
    `<div class="cc-row"><span>validation net</span><b class="${cls(p.netoV)}">${pct(p.netoV, 1)}</b></div>` +
    `<div class="cc-row"><span>trades (train)</span><b>${p.ops ?? '—'}</b></div>` +
    `<button class="btn" type="button" data-open="${esc(p.id)}">Open file</button>`;
  const wrapW = $('hallWrap').clientWidth;
  let left = Math.min(Math.max(8, best.x - 115), wrapW - 238);
  let top = best.y + 14;
  card.style.left = left + 'px'; card.style.top = top + 'px';
  card.hidden = false;
  setTimeout(() => card.classList.add('show'), 10);
}
function originLabel(o) { return o === 'cruce' ? 'crossover' : o === 'mutacion' ? 'mutation' : o === 'aleatorio' ? 'random' : (o || ''); }

/* ── history chart (SVG, hand-rolled) ─────────────────── */
function renderHistory() {
  const ev = S.data?.evolucion; const svg = $('history');
  const hist = (ev?.historia || []).slice(-300);
  // the viewBox follows the real width so the axis text keeps its size on a phone
  const W = Math.max(300, Math.round(svg.clientWidth || 800)), H = 190, L = 40, R = 30, T = 10, B = 22;
  const sig = (hist.length ? hist[hist.length - 1].gen + ':' + hist.length : 'none') + '@' + W;
  if (S.sig.history === sig) return; S.sig.history = sig;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (hist.length < 2) { svg.innerHTML = `<text x="${W / 2}" y="100" text-anchor="middle" class="axis">waiting for at least two generations</text>`; return; }
  const xs = (i) => L + (i / (hist.length - 1)) * (W - L - R);
  const series = [
    { k: 'mejorEntreno', c: '#5b8cff' }, { k: 'mejorVal', c: '#3fbf7f' }, { k: 'media', c: '#97a1b0' },
  ];
  let lo = Infinity, hi = -Infinity;
  for (const h of hist) for (const s of series) { const v = h[s.k]; if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const ys = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const yd = (v) => T + (1 - Math.max(0, Math.min(1, v))) * (H - T - B);
  let out = '';
  // grid + left axis
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4; const y = ys(v);
    out += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    out += `<text class="axis" x="${L - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end">${num(v, 0)}</text>`;
  }
  for (let i = 0; i <= 2; i++) { const y = yd(i / 2); out += `<text class="axis" x="${W - R + 4}" y="${(y + 3).toFixed(1)}" fill="#d9a441">${(i / 2).toFixed(1)}</text>`; }
  // x labels
  const first = hist[0].gen, lastG = hist[hist.length - 1].gen;
  out += `<text class="axis" x="${L}" y="${H - 6}">gen ${first}</text><text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">gen ${lastG}</text>`;
  const mid = Math.floor(hist.length / 2);
  out += `<text class="axis" x="${xs(mid).toFixed(1)}" y="${H - 6}" text-anchor="middle">gen ${hist[mid].gen}</text>`;
  for (const s of series) {
    const pts = hist.map((h, i) => isFinite(h[s.k]) ? `${xs(i).toFixed(1)},${ys(h[s.k]).toFixed(1)}` : null).filter(Boolean).join(' ');
    out += `<polyline points="${pts}" fill="none" stroke="${s.c}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
  }
  const dpts = hist.map((h, i) => isFinite(h.diversidad) ? `${xs(i).toFixed(1)},${yd(h.diversidad).toFixed(1)}` : null).filter(Boolean).join(' ');
  out += `<polyline points="${dpts}" fill="none" stroke="#d9a441" stroke-width="1.2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
  svg.innerHTML = out;
}

/* ── feed ──────────────────────────────────────────────── */
const FEED_TYPES = {
  contratacion: ['hire', 'HIRE'], despido: ['fire', 'FIRE'], apertura: ['open', 'BUY'], ganancia: ['win', 'WIN'],
  perdida: ['loss', 'LOSS'], consejo: ['council', 'COUNCIL'], nacimiento: ['birth', 'BIRTH'], record: ['record', 'RECORD'],
  estancamiento: ['stall', 'STALL'], mutacion: ['mutation', 'MUTATE'], generacion: ['gen', 'GEN'], datos: ['gen', 'DATA'],
  // the office learning from the hall, the weather, sizing and partial exits
  aprende: ['learn', '✎ LEARN'], desaprende: ['unlearn', '↶ UNLEARN'], clima: ['weather', '☁ HOUR'], parcial: ['slice', '◔ SLICE'],
  ascenso: ['up', '▲ SIZE'], descenso: ['down', '▼ SIZE'], maestro: ['teach', '★ TEACH'],
};
function renderFeed() {
  const d = S.data; if (!d) return;
  const items = [...(d.academia?.feed || []), ...(d.evolucion?.feed || [])]
    .filter((f) => f && f.t).sort((a, b) => b.t - a.t).slice(0, 80);
  const sig = items.map((f) => f.t + f.tipo + (f.texto || '').length).join('|');
  if (S.sig.feed === sig) { // only refresh the relative times
    const now = Date.now(); const els = $('feed').querySelectorAll('.fa');
    els.forEach((el, i) => { if (items[i]) setText(el, ago(items[i].t, now)); });
    return;
  }
  S.sig.feed = sig;
  const now = Date.now();
  const firstRender = !S.feedSeen.size;
  const html = items.map((f) => {
    let [c, label] = FEED_TYPES[f.tipo] || ['gen', String(f.tipo || '').toUpperCase().slice(0, 7)];
    if (f.tipo === 'perdida' && /\(muerto\)/.test(f.texto || '')) { c = 'rug'; label = '☠ RUG'; }
    if (f.tipo === 'despido' && /restructuring/i.test(f.texto || '')) { c = 'fire'; label = '⌂ RESTRUCT'; }
    if (f.tipo === 'aprende' && /confirmed its lesson/i.test(f.texto || '')) { label = '✔ LESSON'; }
    const key = f.t + ':' + f.tipo + ':' + (f.id || '');
    const fresh = !firstRender && !S.feedSeen.has(key);
    let text = f.id ? `<a href="#" data-open="${esc(f.id)}">${esc(f.texto)}</a>` : esc(f.texto);
    if (f.mint) text += ` <a href="#" data-token="${esc(f.mint)}" title="token file">↗</a>`;
    return `<li class="feed-item${fresh ? ' new' : ''}" data-k="${esc(key)}"><span class="ft ${c}">${label}</span><span class="fx">${text}</span><span class="fa">${esc(ago(f.t, now))}</span></li>`;
  }).join('');
  $('feed').innerHTML = html || `<li class="feed-item"><span class="ft gen">—</span><span class="fx">nothing has happened yet</span><span class="fa"></span></li>`;
  for (const f of items) S.feedSeen.add(f.t + ':' + f.tipo + ':' + (f.id || ''));
  if (firstRender) S.feedSeen.add('__init');
  setText($('feedCount'), items.length + ' events');
  setTimeout(() => { for (const el of $('feed').querySelectorAll('.feed-item.new')) el.classList.remove('new'); }, 1500);
}

/* ── council ───────────────────────────────────────────── */
function verdictHTML(v) {
  return `<li class="verdict">${avatarSVG(v.id)}<div style="min-width:0"><div class="vn"><a href="#" data-open="${esc(v.id)}">${esc(v.nombre)}</a> <span class="pill dim">desk ${v.puesto}</span> ${estadoPill(v.estado)}</div>` +
    `<div class="vm">${esc(v.motivo || '')}</div>` +
    `<div class="vd">7d net <span class="${cls(v.neto7Pct)}">${pct(v.neto7Pct)}</span> · max DD ${num(v.maxDDPct, 1)}% · ${v.operaciones7 ?? 0} trades · balance ${money(v.saldo)}</div></div></li>`;
}
function renderCouncil() {
  const d = S.data; const a = d?.academia;
  const consejos = (a?.consejos || []).slice().sort((x, y) => (x.t || 0) - (y.t || 0));
  const last = consejos[consejos.length - 1];
  const r = a?.reglas || {};
  let body;
  if (!last) body = `<div class="notice">No council has sat yet. The first session is at 00:00 UTC, or press the button to hold it now.</div>`;
  else body = `<ul class="verdicts">${(last.veredictos || []).map(verdictHTML).join('') || '<li class="notice">The council sat but had nobody to judge.</li>'}</ul>`;
  setHTML($('councilBody'), body, 'council');
  setText($('councilWhen'), last ? `${dateShort(last.t)} UTC${last.forzado ? ' (extraordinary)' : ''} · ${(last.veredictos || []).length} verdicts · ${consejos.length} session${consejos.length === 1 ? '' : 's'} so far` : (a?.ultimoConsejo ? 'last: ' + dateShort(a.ultimoConsejo) : 'none yet'));
  const minOps = r.minOperacionesParaJuzgar ?? 3;
  setHTML($('rules'),
    `<li><span class="pill ok">performing</span><span>At least ${minOps} trades in the last 7 days and a 7-day net above ${num(r.cumpleNetoPct ?? 0, 0)}%. Keeps the desk; the probation counters reset.</span></li>` +
    `<li><span class="pill warn">probation</span><span>Fewer than ${minOps} trades in 7 days (too little data to judge), at most ${r.observacionMaxDias ?? 3} days in a row; or it trades but does not win, at most ${r.sinGanarMaxDias ?? 5} days in a row.</span></li>` +
    `<li><span class="pill bad">fired</span><span>Max drawdown of ${num(r.despidoDDPct ?? 25, 0)}% or more, or a 7-day net below ${num(r.despidoNeto7dPct ?? -10, 0)}%, or more than ${r.observacionMaxDias ?? 3} days without enough trades, or more than ${r.sinGanarMaxDias ?? 5} days trading without profit. The desk goes to the best validated candidate in the hall that is not a near-copy of someone already seated.</span></li>` +
    `<li><span class="pill dim">how</span><span>Rules, not a model: cheap, reproducible and explainable. Every verdict and its reason is written to the agent's file. A rug counts as a −100% trade.</span></li>`,
    'rules');
  const btn = $('holdCouncil');
  btn.disabled = !S.live;
  setText($('holdHint'), S.live ? 'Runs the verdicts right now (POST /consejo); an extraordinary session does not add probation days.' : 'Only available while an engine is live.');
}

async function holdCouncil() {
  if (!S.live || !S.api) return;
  if (!confirm('Hold the council now? It will judge every desk with the rules and may fire agents.')) return;
  const btn = $('holdCouncil'); btn.disabled = true;
  try {
    await fetchJSON(S.api + '/consejo', { method: 'POST' }, 20000);
    toast('The council has sat. Refreshing…');
    await load();
  } catch (e) { toast('Council failed: ' + e.message); }
  btn.disabled = !S.live;
}

/* ── fired / requests / supervisors ────────────────────── */
function renderOthers() {
  const d = S.data; const a = d?.academia;
  const fired = a?.despedidos || [];
  setText($('firedCount'), fired.length ? String(fired.length) : '');
  setHTML($('fired'), fired.length ? `<ul class="rows">` + fired.slice().sort((x, y) => (y.despedido || 0) - (x.despedido || 0)).map((f) =>
    `<li class="row">${avatarSVG(f.id)}<div style="min-width:0"><div class="rn"><a href="#" data-open="${esc(f.id)}">${esc(f.nombre)}</a><span class="pill dim">desk ${f.puesto}</span></div>` +
    `<div class="rm">${esc(f.motivo || '')}</div>` +
    `<div class="rd">net <span class="${cls(f.netoPct)}">${pct(f.netoPct)}</span> · max DD ${num(f.maxDDPct, 1)}% · ${f.operaciones ?? 0} trades · hired ${dateShort(f.contratado)} · fired ${dateShort(f.despedido)}</div></div></li>`).join('') + `</ul>`
    : `<div class="notice">Nobody has been fired yet.</div>`, 'fired');

  const reqs = d?.peticiones || [];
  const pend = reqs.filter((r) => r.estado === 'pendiente').length;
  setText($('reqCount'), reqs.length ? `${pend} pending / ${reqs.length}` : '');
  setHTML($('requests'), reqs.length ? `<ul class="rows">` + reqs.slice().sort((x, y) => (y.t || 0) - (x.t || 0)).map((r) => {
    const st = r.estado === 'aprobada' ? '<span class="pill ok">approved</span>' : r.estado === 'rechazada' ? '<span class="pill bad">rejected</span>' : '<span class="pill warn">pending</span>';
    const buttons = r.estado === 'pendiente' ? `<div class="rq"><button class="btn btn-ok" type="button" data-req="${esc(r.id)}" data-act="aprobar" ${S.live ? '' : 'disabled'}>Approve</button><button class="btn btn-danger" type="button" data-req="${esc(r.id)}" data-act="rechazar" ${S.live ? '' : 'disabled'}>Reject</button></div>` : '';
    return `<li class="row pillrow"><span class="pill dim">${esc(r.de || '?')}</span><div style="min-width:0"><div class="rn">${esc(r.titulo)} ${st}</div>` +
      `<div class="rm">${esc(r.motivo || '')}</div>` +
      (r.queGana ? `<div class="rm"><b>Expected gain:</b> ${esc(r.queGana)}</div>` : '') +
      `<div class="rd">${r.coste ? 'cost ' + esc(r.coste) + ' · ' : ''}${dateShort(r.t)}${r.decidida ? ' · decided ' + dateShort(r.decidida) : ''}</div>${buttons}</div></li>`;
  }).join('') + `</ul>` : `<div class="notice">No requests. When a supervisor or the council needs another data source (wallet trades, X, a paid feed) or a rule change, it will appear here for you to approve or reject.</div>`, 'requests');

  const sup = d?.supervisores || { roles: [], informes: [] };
  const roles = sup.roles || [], informes = sup.informes || [];
  setText($('supCount'), roles.length ? `${roles.length} roles · ${informes.length} reports` : '');
  let html = '';
  if (roles.length) html += `<ul class="rows">` + roles.map((r) =>
    `<li class="row pillrow"><span class="pill dim">${esc(r.rol)}</span><div style="min-width:0"><div class="rn">${esc(r.nombre || r.rol)}</div><div class="rd">${r.puntos ?? 0} pts · ${r.hallazgosUtiles ?? 0} useful of ${r.hallazgos ?? 0} findings · since ${dateShort(r.desde)}</div></div></li>`).join('') + `</ul>`;
  if (roles.length && !informes.length) html += `<div class="notice" style="margin-top:8px">No reports yet.</div>`;
  if (informes.length) html += `<ul class="rows" style="margin-top:8px">` + informes.slice().sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, 6).map((i) =>
    `<li class="row pillrow"><span class="pill dim">${esc(i.rol)}</span><div style="min-width:0"><div class="rm">${esc(i.resumen || '')}</div>` +
    (i.hallazgos || []).map((h) => `<div class="rd"><b>${esc(h.gravedad || '')}</b> ${esc(h.titulo)} — ${esc(h.texto || '')} <span class="req-state">${esc(h.estado || '')}</span></div>`).join('') +
    `<div class="rd">${dateShort(i.t)}</div></div></li>`).join('') + `</ul>`;
  if (!html) html = `<div class="notice">No supervisors on this engine yet. When they exist (Data, Evolution, Risk, UI) their findings land here. They fight for their seat too.</div>`;
  setHTML($('supervisors'), html, 'sup');
}

async function decideRequest(id, act) {
  if (!S.live || !S.api) return;
  const label = act === 'aprobar' ? 'Approve' : 'Reject';
  if (!confirm(`${label} request ${id}?`)) return;
  try {
    await fetchJSON(S.api + '/peticion/' + encodeURIComponent(id) + '/' + act, { method: 'POST' }, 10000);
    toast(`Request ${act === 'aprobar' ? 'approved' : 'rejected'}.`);
    await load();
  } catch (e) { toast('Failed: ' + e.message); }
}

/* ── footer ────────────────────────────────────────────── */
function renderFooter() {
  const d = S.data; if (!d) { setText($('footMeta'), ''); return; }
  const ev = d.evolucion;
  const parts = [`engine v${d.motor?.version || '?'}`, `up since ${dateShort(d.motor?.arrancado)} UTC`];
  if (d.motor?.msPaso != null) parts.push(`paper step ${num(d.motor.msPaso / 1000, 1)} s`);
  if (ev) {
    parts.push(`${num(ev.tokens ?? (ev.poblacion || []).length, 0)} tokens with history`);
    if (ev.datosDesde) parts.push(`recorded ${dateShort(ev.datosDesde)} → ${dateShort(ev.datosHasta)}`);
    if (ev.validacionDesde) parts.push(`validation from ${dateShort(ev.validacionDesde)}`);
  } else parts.push('evolution not running');
  parts.push(`data ${dateShort(d.cuando)} UTC`);
  setText($('footMeta'), parts.join(' · '));
}

/* ── the agent file (modal) ────────────────────────────── */
function filterLines(f) {
  const out = [];
  out.push(`age between ${num(f.edadMinMin, 0)} and ${num(f.edadMaxMin, 0)} min`);
  out.push(`liquidity ≥ ${compactUsd(f.liqMin)}`);
  out.push(`market cap ${compactUsd(f.mcapMin)} – ${compactUsd(f.mcapMax)}`);
  if (f.holdersMin > 0) out.push(`≥ ${num(f.holdersMin, 0)} holders`);
  if (f.organicoMin > 0) out.push(`organic score ≥ ${num(f.organicoMin, 0)}`);
  if (f.top10Max < 100) out.push(`top 10 holders ≤ ${num(f.top10Max, 0)}%`);
  if (f.requiereSegura) out.push('safety check passed (no mint or freeze authority, no transfer fee, no hook, not rugged)');
  if (f.lpLockedMin > 0) out.push(`LP locked or burned ≥ ${num(f.lpLockedMin, 0)}%`);
  if (f.devMintsMax < 200) out.push(`dev has minted ≤ ${num(f.devMintsMax, 0)} tokens before`);
  if (f.snipersMax < 30) out.push(`≤ ${num(f.snipersMax, 0)} snipers in the first 2 seconds`);
  if (f.pad && f.pad !== 'cualquiera') out.push(`launchpad: ${padLabel(f.pad)}`);
  if (f.soloGraduados) out.push('graduated only (bonding curve finished)');
  if (f.soloConMarketing) out.push('paid marketing seen');
  // the dev, X, re-entry and the weather genes (absent on old genomes: nothing is shown)
  if (f.devGraduo) out.push(`dev graduated a token before (and minted at most ${num(f.devMintsGraduoMax, 0)})`);
  if (f.devCompraMax != null && f.devCompraMax < 10) out.push(`dev bought ≤ ${num(f.devCompraMax, 1)}% of the supply`);
  if (f.devVendioMax != null && f.devVendioMax < 100) out.push(`dev has sold ≤ ${num(f.devVendioMax, 0)}% of its bag`);
  if (f.requiereTuit) out.push('mentioned on X by a watched account');
  if (f.reentrar === false) out.push('never re-enters a token it already traded');
  else if (f.reentrar && f.enfriamientoMin) out.push(`re-entry allowed after a ${num(f.enfriamientoMin, 0)} min cooldown`);
  if (f.horasActivo) out.push(`hours window: only trades ${String(f.horaDesde ?? 0).padStart(2, '0')}:00–${String(f.horaHasta ?? 23).padStart(2, '0')}:59 UTC`);
  if (f.pulsoMin > 0) out.push(`pulse: only when the trench births ≥ ${num(f.pulsoMin, 0)} tokens a minute`);
  if (f.solCaidaMax > 0) out.push(`SOL filter: stays out if SOL fell more than ${num(f.solCaidaMax, 1)}% in the last hour`);
  return out;
}
function exitLines(s) {
  const out = [];
  if (s.escalonado) out.push(`scaling out: sells ${num(s.pctVenta, 0)}% of the bag every ×${num(s.cadaX, 2)}, keeps a ${num(s.moonbag, 0)}% moonbag${s.stopABreakeven ? ' · the stop moves to breakeven after the first slice' : ''}`);
  out.push(`take profit at ×${num(s.objetivoX, 2)}`, `stop at −${num(s.stopPct, 0)}%`, s.trailingPct ? `trailing stop ${num(s.trailingPct, 0)}% below the high once up 10%` : 'no trailing stop', `at most ${num(s.maxMin, 0)} min inside`);
  if (s.sinSubida) out.push(`no pump, no stay: out if it has not reached ×${num(s.sinSubidaX, 2)} within ${num(s.sinSubidaMin, 0)} min`);
  if (s.preGraduacion) out.push(`sells a slice at ${compactUsd(s.preGradMcap)} mcap before graduation (pump.fun only)`);
  if (s.salirSiDevVende) out.push('leaves the moment the dev sells');
  if (s.salirSiListosVenden) out.push('leaves when the watched wallets that were buying stop (after 10 min)');
  return out;
}
function convictionBlock(c) {
  if (!c) return '';
  if (!c.activa) return `<div class="gblock wide"><b>Conviction</b><span>off — every trade is the desk's standard size</span></div>`;
  return `<div class="gblock wide conv"><b>Conviction · ALL-IN</b><span>goes <b class="dis-label" style="display:inline">×${num(c.mult, 1)}</b> the usual size, capped at ${num(c.topePct, 0)}% of equity, when ${c.requiereTuit ? 'a watched X account posts it and ' : ''}5-min volume is ≥ ${compactUsd(c.vol5)} with ≥ ${num(c.netos5, 0)} net buyers</span></div>`;
}
function genomeBlocks(g) {
  if (!g) return '<div class="notice">Genome not available in this view.</div>';
  if (!g.filtros || !g.disparo) {
    // an old Hyperliquid genome (snapshot from the closed academy): show it raw but readable
    return `<div class="genome"><div class="gblock wide"><b>Old academy genome</b><span>${esc(JSON.stringify(g).slice(0, 400))}</span></div></div>`;
  }
  const f = g.filtros, d = g.disparo, s = g.salida || {};
  const dis = DISPARO[d.tipo];
  return `<div class="genome">` +
    `<div class="gblock wide"><b>What it looks at</b><ul>${filterLines(f).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` +
    `<div class="gblock"><b>When it buys</b><span class="dis-label">${esc(disparoLabel(d.tipo))}</span><span> — ${esc(dis ? dis.what(d) : d.tipo)}</span></div>` +
    `<div class="gblock"><b>How it exits</b><ul>${exitLines(s).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` +
    convictionBlock(g.conviccion) +
    `</div>`;
}
/* the desk's own hours: trades, P&L and rugs by hour of the day (UTC) */
function hourOfDayBars(porHora) {
  const keys = Object.keys(porHora || {});
  if (!keys.length) return `<div class="notice">No closed trade recorded by hour yet.</div>`;
  const W = Math.max(320, Math.round(($('modalBox')?.clientWidth || 800) - 52)), H = 120, L = 40, R = 6, T = 12, B = 30;
  let hi = 0, tot = 0, nOps = 0, nRugs = 0;
  for (let h = 0; h < 24; h++) { const v = porHora[h] || porHora[String(h)]; if (v) { hi = Math.max(hi, Math.abs(v.pnl || 0)); tot += v.pnl || 0; nOps += v.n || 0; nRugs += v.rugs || 0; } }
  if (hi <= 0) hi = 1;
  const y0 = T + (H - T - B) / 2, scale = (H - T - B) / 2 / hi, slot = (W - L - R) / 24, bw = slot * 0.66;
  const cur = new Date().getUTCHours();
  let out = `<line class="grid" x1="${L}" x2="${W - R}" y1="${y0.toFixed(1)}" y2="${y0.toFixed(1)}"/>`;
  out += `<text class="axis" x="${L - 4}" y="${T + 4}" text-anchor="end">${money(hi)}</text><text class="axis" x="${L - 4}" y="${(y0 + 3).toFixed(1)}" text-anchor="end">$0</text><text class="axis" x="${L - 4}" y="${H - B}" text-anchor="end">${money(-hi)}</text>`;
  let best = null, worst = null;
  for (let h = 0; h < 24; h++) {
    const v = porHora[h] || porHora[String(h)];
    const x = L + slot * h + (slot - bw) / 2;
    if (h === cur) out += `<rect x="${(x - 2).toFixed(1)}" y="${T - 4}" width="${(bw + 4).toFixed(1)}" height="${H - T - B + 8}" rx="3" fill="none" stroke="#5b8cff" stroke-width="1" stroke-dasharray="3 2"/>`;
    if (h % 3 === 0) out += `<text class="axis" x="${(x + bw / 2).toFixed(1)}" y="${H - 16}" text-anchor="middle">${String(h).padStart(2, '0')}h</text>`;
    if (!v) continue;
    if (!best || v.pnl > best.pnl) best = { h, ...v };
    if (!worst || v.pnl < worst.pnl) worst = { h, ...v };
    const hh = Math.abs(v.pnl || 0) * scale;
    out += `<rect x="${x.toFixed(1)}" y="${(v.pnl >= 0 ? y0 - hh : y0).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, hh).toFixed(1)}" rx="1.5" fill="${v.pnl > 0 ? '#3fbf7f' : v.pnl < 0 ? '#e05260' : '#6b7684'}"><title>${String(h).padStart(2, '0')}:00 UTC · ${esc(money(v.pnl))} · ${v.n} trades · ${v.ganadas || 0} won · ${v.rugs || 0} rugs</title></rect>`;
    if (v.rugs) out += `<text class="axis" x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="#e05260">☠${v.rugs}</text>`;
  }
  return `<div class="hours-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${out}</svg></div>` +
    `<div class="loading" style="margin-top:6px">${nOps} closed trade${nOps === 1 ? '' : 's'} across ${keys.length} hour${keys.length === 1 ? '' : 's'} of the day · ${money(tot)} · ${nRugs} rug${nRugs === 1 ? '' : 's'}` +
    (best && best.pnl > 0 ? ` · best hour <b class="pos">${String(best.h).padStart(2, '0')}:00</b> (${money(best.pnl)})` : '') + (worst && worst.pnl < 0 && worst.h !== best?.h ? ` · worst <b class="neg">${String(worst.h).padStart(2, '0')}:00</b> (${money(worst.pnl)})` : '') + ` · UTC, dashed box = this hour</div>`;
}
/* lessons: every time the desk adopted the exits and filters of a better descendant, and the verdict on it */
function lessonsHTML(a) {
  const ep = a.epocas || [];
  if (!ep.length) return '';
  const ops = a.operaciones || [];
  const items = ep.slice().reverse().map((e) => {
    const since = ops.filter((o) => o.tOut >= e.desde).length;
    let verdict, c;
    if (e.revertida) { verdict = `unlearned — ${money(e.ahoraPO)} per trade after vs ${money(e.antesPO)} before while the office held: back to its old self`; c = 'bad'; }
    else if (typeof e.juzgada === 'number') {
      const fell = e.ahoraPO < e.antesPO - Math.abs(e.antesPO) * 0.3;
      if (fell && e.oficinaCae) { verdict = `it was the hour — down to ${money(e.ahoraPO)} per trade from ${money(e.antesPO)}, but so was the whole office: it keeps the lesson`; c = 'warn'; }
      else { verdict = `confirmed — ${money(e.ahoraPO)} per trade after vs ${money(e.antesPO)} before`; c = 'ok'; }
    } else if (typeof e.juzgada === 'string') { verdict = e.juzgada === 'sin historial previo' ? 'not judged: fewer than 5 trades before the lesson to compare with' : e.juzgada; c = 'dim'; }
    else { verdict = since >= 10 ? `pending — ${since} trades since; the office judges it on its next round` : `pending — ${since} of the 10 trades needed to judge it`; c = 'dim'; }
    return `<li class="lesson"><div class="ln"><span class="pill ${c}">${c === 'ok' ? 'confirmed' : c === 'bad' ? 'unlearned' : c === 'warn' ? 'it was the hour' : 'pending'}</span> learned from ${e.deId ? `<a href="#" data-open="${esc(e.deId)}">${esc(e.de || e.deId)}</a>` : esc(e.de || '?')} · ${esc(dateShort(e.desde))} UTC · after trade #${e.opsAntes ?? '?'}</div><div class="lv">${verdict}</div></li>`;
  }).join('');
  return `<div><h4>Lessons</h4><ul class="lessons">${items}</ul><div class="loading" style="margin-top:4px">A desk adopts the exits and filters of a descendant that validates better with no more rugs (it keeps its trigger, name, balance and history). After 10 trades the office compares the P&L per trade before and after; if only this desk fell, it unlearns.</div></div>`;
}
function metricsTable(tr, va) {
  const trench = (tr && 'muertos' in tr) || (va && 'muertos' in va);
  const rows = [
    ['Net', (m) => `<span class="${cls(m.netoPct)}">${pct(m.netoPct, 1)}</span>`],
    ['Max drawdown', (m) => num(m.maxDDPct, 1) + '%'],
    ['Trades', (m) => m.operaciones ?? '—'],
    ['Win rate', (m) => num(m.aciertoPct, 1) + '%'],
    ['Profit factor', (m) => num(m.factor, 2)],
    ['Avg trade', (m) => pct(m.mediaPct, 1)],
  ];
  if (trench) rows.push(['Rugs (to zero)', (m) => m.muertos ? `<span class="skull">${m.muertos}</span>` : '0'], ['Avg minutes inside', (m) => num(m.minutosMedia, 0)], ['Best exit', (m) => m.mejorX ? '×' + num(m.mejorX, 2) : '—']);
  else rows.push(['Liquidations', (m) => m.liquidaciones ?? 0], ['Candles', (m) => num(m.velas, 0)]);
  rows.push(['Score', (m) => `<b class="${cls(m.puntuacion)}">${num(m.puntuacion, 1)}</b>`]);
  const t = tr || {}, v = va || {};
  let html = `<table class="metrics"><thead><tr><th></th><th>training</th><th>validation</th></tr></thead><tbody>` +
    rows.map(([k, f]) => `<tr><td>${k}</td><td>${f(t)}</td><td>${f(v)}</td></tr>`).join('') + `</tbody></table>`;
  if (tr && va) {
    const overfit = (t.puntuacion > 20 && v.puntuacion < t.puntuacion / 3) || (t.netoPct > 20 && v.netoPct < t.netoPct / 4);
    if (overfit) html += `<div class="overfit">Looks overfitted: it did far better on the tokens it trained on (${num(t.puntuacion, 0)}) than on the ones it never saw (${num(v.puntuacion, 0)}). Trust the validation column.</div>`;
    else if (v.puntuacion > 0 && t.puntuacion > 0) html += `<div class="overfit" style="color:var(--safe);border-color:rgba(63,191,127,.45);background:rgba(63,191,127,.08)">Training and validation agree: it kept working on tokens it never saw.</div>`;
    else if ((v.operaciones ?? 0) < 5) html += `<div class="overfit" style="color:var(--text-dim);border-color:var(--line);background:transparent">Only ${v.operaciones ?? 0} validation trade${v.operaciones === 1 ? '' : 's'}: too few to trust either column. The score docks 10 points below 5 trades.</div>`;
  }
  return html;
}
function opsTable(ops) {
  if (!ops || !ops.length) return `<div class="notice">No trades yet at this desk.</div>`;
  const allIn = ops.filter((o) => o.conviccion).length, sliced = ops.filter((o) => o.parciales > 0).length;
  const note = (o) => (o.conviccion ? `<span class="pill conv">all-in</span>` : '') + (o.parciales > 0 ? `<span class="pill dim" title="partial sales before the close">${o.parciales} slice${o.parciales > 1 ? 's' : ''}</span>` : '');
  return `<div class="ops-wrap"><table class="ops"><thead><tr><th>token</th><th>in</th><th>out</th><th>P&amp;L</th><th>%</th><th title="highest multiple seen while inside">high</th><th>why</th><th>min</th><th>trigger</th><th></th><th>closed</th></tr></thead><tbody>` +
    ops.slice(0, 40).map((o) => `<tr><td><a href="#" data-token="${esc(o.mint)}">${esc(o.simbolo || shortAddr(o.mint))}</a></td><td>${price(o.entrada)}</td><td>${o.motivo === 'muerto' ? '0' : price(o.salida)}</td><td class="${cls(o.pnl)}">${money(o.pnl)}</td><td class="${cls(o.pct)}">${pct(o.pct, 0)}</td><td class="${o.maxX >= 2 ? 'pos' : ''}">${o.maxX ? '×' + num(o.maxX, 2) : '—'}</td><td>${motivoHTML(o.motivo)}</td><td>${num(o.min, 0)}</td><td>${esc(disparoLabel(o.disparo))}</td><td>${note(o)}</td><td>${dateShort(o.tOut)}</td></tr>`).join('') +
    `</tbody></table></div>` +
    (allIn || sliced ? `<div class="loading" style="margin-top:4px">${allIn ? `${allIn} all-in trade${allIn === 1 ? '' : 's'} (conviction size)` : ''}${allIn && sliced ? ' · ' : ''}${sliced ? `${sliced} with partial sales on the way up` : ''} · high = the best multiple it saw while inside</div>` : '');
}

let agentCache = new Map();
async function agentInfo(id) {
  const m = stateMap();
  let a = m.get(id);
  if (a && (a.kind === 'desk' || a.kind === 'fired' || a.kind === 'agent')) return a;
  if (agentCache.has(id)) return agentCache.get(id) || a || null;
  if (S.live && S.api) {
    try {
      const full = await fetchJSON(S.api + '/estado/agente/' + encodeURIComponent(id), {}, 5000);
      // the trench engine answers {genealogia, sala, puesto, despedido}: flatten to one agent
      const flat = full.puesto ? { ...full.puesto, kind: 'full' } : full.sala ? { kind: 'full', id, ...full.sala.g, g: full.sala.g, fit: full.sala.fit, entreno: full.sala.entreno, validacion: full.sala.validacion, descripcion: full.sala.descripcion } : full.despedido ? { kind: 'fired', ...full.despedido } : full.genealogia ? { kind: 'full', id, ...full.genealogia } : (full.id ? { kind: 'full', ...full } : null);
      agentCache.set(id, flat); return flat;
    }
    catch (e) { agentCache.set(id, null); }
  }
  return a || null;
}
function nodeHTML(a, id, you = false) {
  if (!a) return `<span class="tnode unknown">${avatarSVG(id)}<span class="tn">${esc(id)}</span><span class="tg">unknown — gone from the hall</span></span>`;
  const gen = a.generacion ?? a.gen;
  return `<span class="tnode${you ? ' you' : ''}" data-open="${esc(a.id || id)}">${avatarSVG(a.id || id)}<span class="tn">${esc(a.nombre || id)}</span><span class="tg">g${gen ?? '?'} ${esc(originLabel(a.origen))}</span></span>`;
}
async function treeHTML(a, depth) {
  const gen = S.data?.academia?.genealogia || {};
  const parents = a?.padres || a?.g?.padres || gen[a?.id]?.padres || [];
  if (!parents.length || depth <= 0) return '';
  const items = [];
  for (const pid of parents) {
    let p = await agentInfo(pid);
    if (!p && gen[pid]) p = { id: pid, ...gen[pid] };
    const sub = p ? await treeHTML(p, depth - 1) : '';
    items.push(`<li>${nodeHTML(p, pid)}${sub}</li>`);
  }
  return `<ul>${items.join('')}</ul>`;
}

async function openAgent(id) {
  const modal = $('modal'), box = $('modalBox');
  modal.hidden = false; setTimeout(() => modal.classList.add('show'), 10);
  box.innerHTML = `<div class="modal-head"><div><h3>Loading…</h3></div><button class="modal-close" type="button" data-close>×</button></div><div class="loading">Fetching the file of ${esc(id)}</div>`;
  const a = await agentInfo(id);
  if (!a) { box.querySelector('.loading').textContent = 'Not found (not in the hall, not at a desk, not fired; and the engine is not live to ask).'; box.querySelector('h3').textContent = id; return; }
  const g = a.g || null;
  const gen = a.generacion ?? a.gen;
  const where = a.kind === 'desk' ? `<span class="pill ok">desk ${a.puesto}</span>` : a.kind === 'fired' ? `<span class="pill bad">fired</span>` : `<span class="pill dim">in the hall</span>`;
  const estado = a.estado ? estadoPill(a.estado) : '';
  const tipo = g?.disparo?.tipo;
  let html = `<div class="modal-head">${avatarSVG(a.id)}<div style="min-width:0"><h3>${esc(a.nombre)}</h3><div class="mh-sub"><span>${esc(a.id)}</span><span>· gen ${gen ?? '?'}</span><span>· ${esc(originLabel(a.origen))}</span>${tipo ? `<span class="pill pad">${esc(disparoLabel(tipo))}</span>` : ''}${where}${estado}</div></div><button class="modal-close" type="button" data-close>×</button></div>`;
  html += `<div class="modal-body">`;
  const sizeNote = a.kind === 'desk' && a.importe != null ? ` · trades $${num(a.importe, 0)} per token${a.aprendido ? ` · learned ${a.aprendido} time${a.aprendido > 1 ? 's' : ''} from the hall` : ''}` : '';
  html += `<div><h4>Strategy</h4><div class="strategy">${esc(a.descripcion || '—')}</div>${a.motivo || sizeNote ? `<div class="loading" style="margin-top:4px">${esc(a.motivo || '')}${esc(sizeNote)}</div>` : ''}</div>`;
  html += lessonsHTML(a);
  html += fichaExtraHTML(a, S.data, (pid) => { const m = stateMap().get(pid); return m?.nombre || S.data?.academia?.genealogia?.[pid]?.nombre || null; });
  if (a.kind === 'desk') {
    const inPos = Object.values(a.posiciones || {}).reduce((x, q) => x + (q.importe || 0) + (q.pnlAbierto || 0), 0);
    const equity = (a.saldo || 0) + inPos;
    const pnlPct = a.saldoInicial ? (equity - a.saldoInicial) / a.saldoInicial * 100 : 0;
    const rugs = (a.operaciones || []).filter((o) => o.motivo === 'muerto').length;
    html += `<div><h4>At the desk</h4><div class="office-summary" style="margin:0">` +
      `<div class="stat"><div class="k">equity</div><div class="v">${money(equity)}<small> · ${money(a.saldo)} free</small></div></div>` +
      `<div class="stat"><div class="k">P&amp;L</div><div class="v ${cls(pnlPct)}">${pct(pnlPct)}</div></div>` +
      `<div class="stat"><div class="k">peak</div><div class="v">${money(a.pico)}</div></div>` +
      `<div class="stat"><div class="k">max drawdown</div><div class="v">${num(a.maxDDPct, 1)}%${rugs ? `<small> · <span class="skull">${rugs} rug${rugs > 1 ? 's' : ''}</span></small>` : ''}</div></div></div>` +
      `<div style="margin-top:8px">${sparkline(a.curva)}</div>` +
      `<div class="loading" style="margin-top:4px">hired ${dateShort(a.contratado)} UTC${a.estado === 'observacion' ? ` · probation day ${a.diasObservacion || 0}${a.diasSinGanar ? ` · ${a.diasSinGanar} day${a.diasSinGanar > 1 ? 's' : ''} without profit` : ''}` : ''}</div>` +
      (Object.keys(a.posiciones || {}).length ? `<div class="desk-pos" style="margin-top:8px">${positionRows(a, true)}</div>` : `<div class="desk-wait">Nothing open · scanning ${liveTokens() != null ? num(liveTokens(), 0) : '?'} live tokens · last buy ${(a.operaciones || [])[0] ? esc(agoShort(a.operaciones[0].tIn)) : 'none yet'}</div>`) + `</div>`;
  }
  if (a.porHora && Object.keys(a.porHora).length) html += `<div><h4>By hour of the day</h4>${hourOfDayBars(a.porHora)}</div>`;
  if (a.kind === 'fired') {
    html += `<div><h4>Dismissal</h4><div class="rd" style="font:12.5px/1.5 var(--mono);color:var(--text-dim)">net <span class="${cls(a.netoPct)}">${pct(a.netoPct)}</span> · max DD ${num(a.maxDDPct, 1)}% · ${a.operaciones ?? 0} trades · hired ${dateShort(a.contratado)} · fired ${dateShort(a.despedido)}</div></div>`;
  }
  html += `<div><h4>Strategy, block by block</h4>${genomeBlocks(g)}${(a.cambios || g?.cambios || []).length ? `<h4 style="margin-top:10px">Changes from its parents</h4><ul class="changes">${(a.cambios || g.cambios).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</div>`;
  html += `<div><h4>Training vs validation</h4>${metricsTable(a.entreno, a.validacion)}</div>`;
  if (a.veredictos && a.veredictos.length) html += `<div><h4>Council verdicts</h4><ul class="verdicts">${a.veredictos.slice().sort((x, y) => (y.t || 0) - (x.t || 0)).map(verdictHTML).join('')}</ul></div>`;
  if (a.kind === 'desk' || Array.isArray(a.operaciones)) html += `<div><h4>Trades</h4>${opsTable(a.operaciones)}</div>`;
  html += `<div><h4>Family tree</h4><div class="tree" id="tree"><div class="loading">tracing the parents…</div></div></div>`;
  html += `</div>`;
  box.innerHTML = html;
  const tree = await treeHTML(a, 3);
  const treeEl = $('tree');
  if (treeEl) treeEl.innerHTML = `<ul><li>${nodeHTML(a, a.id, true)}${tree || '<ul><li><span class="tnode unknown"><span class="tg">born at random — no parents</span></span></li></ul>'}</li></ul>`;
}
function closeModal() {
  const modal = $('modal'); modal.classList.remove('show');
  setTimeout(() => { if (!modal.classList.contains('show')) modal.hidden = true; }, 200);
}

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ── render everything ─────────────────────────────────── */
function render() {
  renderHeader();
  updateOficina(S.data, S.live);
  if (!S.data) {
    setHTML($('officeSummary'), '', 'officeSummary');
    setHTML($('desks'), `<div class="notice" style="grid-column:1/-1">Nothing to show: no engine is answering and there is no snapshot at academia/estado.json.</div>`, 'desksEmpty');
    return;
  }
  renderOffice();
  renderHours();
  renderFame();
  renderTrench();
  renderHall();
  renderHistory();
  renderFeed();
  renderCouncil();
  renderOthers();
  renderFooter();
}

/* ── wiring ────────────────────────────────────────────── */
function init() {
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-token], [data-open], [data-close], .desk[data-id], [data-req]');
    if (!t) return;
    if (t.hasAttribute('data-close')) { closeModal(); return; }
    if (t.dataset.req) { decideRequest(t.dataset.req, t.dataset.act); return; }
    if (t.dataset.token) { ev.preventDefault(); ev.stopPropagation(); openToken(t.dataset.token); return; }
    const id = t.dataset.open || t.dataset.id;
    if (!id) return;
    ev.preventDefault();
    openAgent(id);
  });
  $('modal').addEventListener('click', (ev) => { if (ev.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeModal(); });
  $('hallCanvas').addEventListener('click', hallClick);
  initOficina({ canvas: $('floorCanvas'), wrap: $('floorWrap'), openAgent, toast });
  $('holdCouncil').addEventListener('click', holdCouncil);
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderHistory(); if (S.data) renderHours(); if (S.data?.evolucion) drawHall(S.data.evolucion.poblacion || [], new Set((S.data.academia?.puestos || []).filter((p) => p.agente).map((p) => p.agente.id)), S.prevPop || new Set()); }, 150); });
  renderClock(); setInterval(renderClock, 1000);
  load();
  setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - S.fetchedAt > REFRESH_MS) load(); });
  // relative "data … ago" in the header ticks between fetches
  setInterval(() => { if (S.data) renderHeader(); }, 5000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
