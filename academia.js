/* LA ACADEMIA — front for the engine at http://localhost:4340 (contract in
 * academia/CONTRATO-WEB.md). Live from the owner's PC when the engine answers
 * within 3 s; otherwise the published snapshot academia/estado.json.
 *
 * House rules kept here: no page reloads (DOM is patched in place, each block
 * only re-rendered when its signature changes, so nothing flickers), no
 * requestAnimationFrame for entrances (background tabs freeze it; CSS
 * transitions and setTimeout instead), no transforms on chart ancestors. */

import { initOficina, updateOficina, fichaExtraHTML, nextCandleClose, agoShort } from './academia-oficina.js?v=3';

// 10-oct: the Hyperliquid engine took over port 4360 (the trench is out). Same origin when the engine serves this page,
// then an engine on this PC (ssh tunnel), then the public one behind cloudflared.
// ?sala=gtrade -> the gTrade room (forex up to 1000x, 5 desks of $100) on port 4370
const SALA = new URLSearchParams(location.search).get('sala') === 'gtrade' ? 'gtrade' : 'hl';
const ENGINES = SALA === 'gtrade'
  ? [...new Set([location.port === '4370' ? location.origin : null, 'http://localhost:4370'].filter(Boolean))]
  : [...new Set([/^(localhost|127\.0\.0\.1|trinchera\.oligarc\.xyz)$/.test(location.hostname) && location.port !== '4370' ? location.origin : null, 'http://localhost:4360', 'https://trinchera.oligarc.xyz'].filter(Boolean))];
let API = ENGINES[0];
const SNAPSHOT = SALA === 'gtrade' ? 'academia/estado-gtrade.json' : 'academia/estado.json';
const REFRESH_MS = 15000;
const TIMEOUT_MS = 3000;

const S = {
  data: null,          // last /estado
  live: false,         // engine answered
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
function money(n) { return n == null ? '—' : '$' + num(n, 2); }
function pct(n, d = 2, sign = true) {
  if (n == null || !isFinite(n)) return '—';
  const s = sign && n > 0 ? '+' : '';
  return s + num(n, d) + '%';
}
function cls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat'; }
function price(p) {
  if (p == null) return '—';
  if (p >= 1000) return num(p, 0);
  if (p >= 1) return num(p, 2);
  if (p >= 0.01) return num(p, 4);
  return num(p, 6);
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
function dur(ms) {
  if (ms == null || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
function hms(t) {
  const d = new Date(t);
  return d.toISOString().slice(11, 16) + ' UTC';
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
    let data = null, live = false;
    // two tries at the engine (it restarts now and then), then the snapshot
    for (const base of ENGINES) { // first engine that answers wins (and keeps serving the actions)
      try { data = await fetchJSON(base + '/estado', {}, 4000); live = true; API = base; break; }
      catch (e) { /* next engine */ }
    }
    if (!data) { try { data = await fetchJSON(SNAPSHOT, {}, 8000); } catch (e2) { data = null; } }
    if (data) {
      S.data = data; S.live = live; S.fetchedAt = Date.now(); S.failures = 0;
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

/* ── header ────────────────────────────────────────────── */
function renderHeader() {
  const d = S.data; const st = $('status');
  const now = Date.now();
  if (!d) {
    st.innerHTML = `<span class="dot dead"></span><span>engine offline and no snapshot</span>`;
    setHTML($('ticker'), `<span class="empty">no prices — the engine is not reachable and academia/estado.json is missing</span>`, 'ticker');
    return;
  }
  const age = now - (d.cuando || S.fetchedAt);
  if (S.live) {
    st.innerHTML = `<span class="dot live"></span><span>live from your PC · data ${esc(ago(d.cuando, now))}</span>`;
  } else {
    const min = Math.max(0, Math.round(age / 60000));
    st.innerHTML = `<span class="dot snap"></span><span>snapshot from ${min} min ago</span>`;
  }
  // prices of the markets the desks use (fall back to the evolution coins)
  const coins = new Set();
  for (const p of d.academia?.puestos || []) if (p.agente) for (const c of p.agente.g?.mercados || []) coins.add(c);
  const fallback = !coins.size;
  if (fallback) for (const c of (d.evolucion?.coins || ['BTC', 'ETH', 'HYPE', 'SOL']).slice(0, 8)) coins.add(c);
  const pr = d.precios || {};
  let html = '';
  for (const c of coins) if (pr[c] != null) html += `<span><b>${esc(c)}</b>${price(pr[c])}</span>`;
  if (!html) html = `<span class="empty">no prices yet</span>`;
  else if (fallback) html = `<span class="empty">no desk yet · top markets:</span>` + html;
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

function sideLabel(lado) {
  return lado === 'largo' || lado === 'long' ? 'long' : lado === 'corto' || lado === 'short' ? 'short' : lado === 'ambos' ? 'long & short' : String(lado || '');
}
function estadoLabel(e) {
  return e === 'cumple' ? 'performing' : e === 'observacion' ? 'probation' : e === 'despedido' ? 'fired' : (e || '—');
}
function estadoPill(e) {
  const c = e === 'cumple' ? 'ok' : e === 'observacion' ? 'warn' : e === 'despedido' ? 'bad' : 'dim';
  return `<span class="pill ${c}">${esc(estadoLabel(e))}</span>`;
}

function positionRows(ag, precios, full = false) {
  const pos = ag.posiciones || {};
  const keys = Object.keys(pos);
  if (!keys.length) return '';
  let html = '';
  for (const coin of keys) {
    const p = pos[coin];
    const px = precios?.[coin];
    const long = p.lado === 'largo' || p.lado === 'long';
    let toStop = null, toTarget = null;
    if (px && p.stop) toStop = Math.abs((px - p.stop) / px * 100);
    if (px && p.objetivo) toTarget = Math.abs((p.objetivo - px) / px * 100);
    const lev = ag.g?.riesgo?.apalancamiento;
    const pnl = p.pnlAbierto;
    html += `<div class="pos-row"><b>${esc(coin)}</b><span class="side ${long ? 'long' : 'short'}">${long ? 'LONG' : 'SHORT'}</span>` +
      (lev ? `<span>${lev}×</span>` : '') +
      `<span class="${cls(pnl)}">${pnl != null ? money(pnl) : ''}</span>` +
      `<span title="distance to stop">stop ${toStop != null ? num(toStop, 2) + '%' : '—'}</span>` +
      `<span title="distance to target">tgt ${toTarget != null ? num(toTarget, 2) + '%' : '—'}</span>` +
      (full ? `<span>in ${price(p.entrada)} · stop ${price(p.stop)} · tgt ${price(p.objetivo)} · liq ${price(p.liq)}${p.trailingMovido ? ' · trailing moved' : ''}</span>` : '') +
      `</div>`;
  }
  return html;
}

function deskHTML(p, precios) {
  if (!p.agente) {
    return `<div class="desk-n">desk ${p.n}</div><div class="desk-vacant">` +
      `<svg class="chair-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4h12v8H6zM5 12h14v3H5zM7 15v5M17 15v5"/></svg>` +
      `<span class="pill dim">vacant</span><span>waiting for the first validated candidates</span></div>`;
  }
  const a = p.agente;
  const pnlPct = a.saldoInicial ? (a.saldo - a.saldoInicial) / a.saldoInicial * 100 : 0;
  const ops = (a.operaciones || []).slice(0, 3);
  let trades = '';
  if (ops.length) {
    trades = `<div class="desk-trades">` + ops.map((o) =>
      `<div class="trade-row"><span><b>${esc(o.coin)}</b> ${sideLabel(o.lado).slice(0, 5)}</span><span class="${cls(o.pnl)}">${pct(o.pct)}</span></div>`).join('') + `</div>`;
  } else {
    trades = `<div class="desk-empty">no trades yet</div>`;
  }
  const posHtml = positionRows(a, precios);
  // why it is not trading yet: desks only act on candle closes of their interval
  let waiting = '';
  if (!Object.keys(a.posiciones || {}).length) {
    const nc = nextCandleClose(a.g?.intervalo);
    const seen = a.vistas ?? a.velasVistas ?? null;
    const lastSig = a.ultimaSenal || a.ultimaSeñal || null;
    const lastCandle = a.ultimaVela || null;
    waiting = `<div class="desk-wait">Hired ${esc(agoShort(a.contratado))} · waits for the next ${esc(a.g?.intervalo || '1h')} candle close (${nc.label} UTC, in ${nc.inMin} min)` +
      (lastCandle ? ` · last candle seen ${esc(dateShort(lastCandle))}` : '') +
      (seen != null ? ` · ${num(seen, 0)} candles checked` : '') +
      ` · last signal check: ${lastSig ? esc(dateShort(lastSig)) : (a.operaciones || []).length ? 'fired ' + (a.operaciones || []).length + ' time(s)' : 'none fired'}</div>`;
  }
  return `<div class="desk-n">desk ${p.n}</div>` +
    `<div class="desk-head">${avatarSVG(a.id)}<div style="min-width:0"><div class="desk-name">${esc(a.nombre)}</div><div class="desk-strategy">${esc(a.descripcion || '')}</div></div></div>` +
    `<div class="desk-money"><span class="bal">${money(a.saldo)}</span><span class="pnl ${cls(pnlPct)}">${pct(pnlPct)}</span></div>` +
    `<div class="desk-badge">${estadoPill(a.estado)}<span class="pill dim">DD ${num(a.maxDDPct, 1)}%</span>${a.estado === 'observacion' && a.diasObservacion ? `<span class="pill warn">day ${a.diasObservacion}</span>` : ''}</div>` +
    sparkline(a.curva) +
    (posHtml ? `<div class="desk-pos">${posHtml}</div>` : '') +
    waiting +
    trades;
}

function renderOffice() {
  const d = S.data; const wrap = $('desks');
  const puestos = d?.academia?.puestos || Array.from({ length: 10 }, (_, i) => ({ n: i + 1, agente: null }));
  const precios = d?.precios || {};
  // summary
  const hired = puestos.filter((p) => p.agente);
  const bal = hired.reduce((s, p) => s + (p.agente.saldo || 0), 0);
  const ini = hired.reduce((s, p) => s + (p.agente.saldoInicial || 0), 0);
  const pnl = bal - ini;
  const open = hired.reduce((s, p) => s + Object.keys(p.agente.posiciones || {}).length, 0);
  const perf = hired.filter((p) => p.agente.estado === 'cumple').length;
  const prob = hired.filter((p) => p.agente.estado === 'observacion').length;
  setHTML($('officeSummary'),
    `<div class="stat"><div class="k">hired</div><div class="v">${hired.length}<small> / ${puestos.length}</small></div></div>` +
    `<div class="stat"><div class="k">balance (paper)</div><div class="v">${money(bal)}</div></div>` +
    `<div class="stat"><div class="k">P&amp;L</div><div class="v ${cls(pnl)}">${money(pnl)}<small> ${ini ? pct(pnl / ini * 100) : ''}</small></div></div>` +
    `<div class="stat"><div class="k">open · performing · probation</div><div class="v">${open}<small> · </small><span class="pos">${perf}</span><small> · </small><span style="color:var(--caution)">${prob}</span></div></div>`,
    'officeSummary');
  setText($('officeSub'), `${hired.length} of ${puestos.length} desks taken · $${num(d?.academia?.saldoPuesto ?? 100, 0)} per desk`);

  // one element per desk, patched only when its own signature changes
  if (wrap.children.length !== puestos.length) {
    wrap.innerHTML = puestos.map((p) => `<button class="desk vacant" type="button" data-n="${p.n}"></button>`).join('');
  }
  puestos.forEach((p, i) => {
    const el = wrap.children[i];
    const a = p.agente;
    const sig = JSON.stringify([a?.id, a?.estado, a?.saldo, a?.maxDDPct, a?.diasObservacion, a?.posiciones, (a?.operaciones || []).slice(0, 3), (a?.curva || []).length, (a?.curva || []).slice(-1), (a?.g?.mercados || []).map((c) => precios[c]), Math.floor(Date.now() / 60000)]);
    if (S.sig['desk' + p.n] === sig) return;
    S.sig['desk' + p.n] = sig;
    el.className = 'desk' + (a ? '' : ' vacant');
    el.dataset.estado = a?.estado || '';
    el.dataset.id = a?.id || '';
    el.innerHTML = deskHTML(p, precios);
  });
}

/* ── newsroom (eventos: news, Polymarket moves, OI shifts, market opens) ── */
const NEWS_ICON = {
  tree: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  polymarket: '<svg viewBox="0 0 24 24"><path d="M3 17l5-6 4 3 5-7 4 4"/><path d="M3 21h18"/></svg>',
  hyperliquid: '<svg viewBox="0 0 24 24"><path d="M4 12h3l2-6 3 12 3-9 2 3h3"/></svg>',
  calendario: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
};
function compactUsd(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + num(n / 1e9, 2) + 'B';
  if (a >= 1e6) return '$' + num(n / 1e6, 1) + 'M';
  if (a >= 1e3) return '$' + num(n / 1e3, 0) + 'k';
  return '$' + num(n, 0);
}
function newsItemHTML(e, now) {
  let title = '', detail = '';
  if (e.tipo === 'noticia') {
    title = e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.titulo || 'news')}</a>` : esc(e.titulo || 'news');
    const coins = Array.isArray(e.monedas) && e.monedas.length ? e.monedas.join(' ') : '';
    detail = [e.origen ? 'via ' + esc(e.origen) : '', coins ? esc(coins) : '', e.ret != null ? 'lag ' + num(e.ret / 1000, 1) + 's' : ''].filter(Boolean).join(' · ');
  } else if (e.tipo === 'salto') {
    const up = (e.ahora ?? 0) >= (e.antes ?? 0);
    title = esc(e.mercado || 'Polymarket market');
    detail = `<span class="${up ? 'pos' : 'neg'}">${num((e.antes ?? 0) * 100, 0)}% → ${num((e.ahora ?? 0) * 100, 0)}%</span>` + (e.volumen24h ? ` · 24h vol ${compactUsd(e.volumen24h)}` : '');
  } else if (e.tipo === 'oi') {
    title = `${esc(e.coin)} open interest ${(e.pct ?? 0) >= 0 ? 'up' : 'down'}`;
    detail = `<span class="${cls(e.pct)}">${pct(e.pct, 1)}</span> · ${compactUsd(e.antes)} → ${compactUsd(e.ahora)}`;
  } else if (e.tipo === 'apertura') {
    title = `${esc(e.bolsa || 'market')} opens`;
    detail = 'exchange session start';
  } else {
    title = esc(e.titulo || e.tipo || 'event');
  }
  return `<li class="news-item" data-k="${esc(e.t + ':' + e.tipo + ':' + (e.id || e.coin || e.bolsa || ''))}"><span class="ni ${esc(e.fuente || '')}">${NEWS_ICON[e.fuente] || NEWS_ICON.tree}</span><div class="nt">${title}${detail ? `<div class="nd">${detail}</div>` : ''}</div><span class="na">${esc(ago(e.t, now))}</span></li>`;
}
function renderNewsroom() {
  const d = S.data; const ev = d?.eventos;
  const now = Date.now();
  if (!ev) {
    setHTML($('newsCounters'), `<div class="notice" style="grid-column:1/-1">The newsroom is not wired yet: this engine does not send <code>eventos</code>.</div>`, 'newsCounters');
    setHTML($('newsList'), '', 'newsList'); setHTML($('funding'), '', 'funding'); setText($('fundingWhen'), ''); setText($('newsSub'), 'no event feed');
    return;
  }
  const h = ev.hoy || {};
  setHTML($('newsCounters'),
    `<div class="stat"><div class="k">news today</div><div class="v">${h.noticias ?? 0}</div></div>` +
    `<div class="stat"><div class="k">Polymarket moves</div><div class="v">${h.polymarket ?? 0}</div></div>` +
    `<div class="stat"><div class="k">OI shifts</div><div class="v">${h.oi ?? 0}</div></div>` +
    `<div class="stat"><div class="k">market opens</div><div class="v">${h.aperturas ?? 0}</div></div>` +
    `<div class="stat"><div class="k">ticks recorded today</div><div class="v">${num(ev.ticksHoy ?? 0, 0)}<small> · ${h.fotos ?? 0} snapshots</small></div></div>`,
    'newsCounters');
  setText($('newsSub'), `${h.noticias ?? 0} news · ${h.polymarket ?? 0} Polymarket moves · ${h.oi ?? 0} OI shifts · ${num(ev.ticksHoy ?? 0, 0)} ticks recorded today`);
  const items = (ev.ultimos || []).slice(0, 60);
  const sig = items.map((e) => e.t + e.tipo + (e.id || e.coin || '')).join('|');
  if (S.sig.newsList !== sig) {
    const seen = S.newsSeen || new Set(); const first = !S.newsSeen;
    S.sig.newsList = sig;
    $('newsList').innerHTML = items.length ? items.map((e) => newsItemHTML(e, now)).join('') : `<li class="notice">Listening… nothing yet today.</li>`;
    for (const li of $('newsList').children) if (!first && li.dataset.k && !seen.has(li.dataset.k)) li.classList.add('new');
    S.newsSeen = new Set(items.map((e) => e.t + ':' + e.tipo + ':' + (e.id || e.coin || e.bolsa || '')));
    setTimeout(() => { for (const el of $('newsList').querySelectorAll('.news-item.new')) el.classList.remove('new'); }, 1500);
  } else {
    const els = $('newsList').querySelectorAll('.na');
    els.forEach((el, i) => { if (items[i]) setText(el, ago(items[i].t, now)); });
  }
  // funding and OI for the markets the desks trade (fallback: the biggest by OI)
  const foto = ev.ultimaFoto; const m = foto?.mercados || {};
  const coins = new Set();
  for (const p of d.academia?.puestos || []) if (p.agente) for (const c of p.agente.g?.mercados || []) coins.add(c);
  let list = [...coins].filter((c) => m[c]);
  let fallback = false;
  if (!list.length) { fallback = true; list = Object.keys(m).sort((a, b) => (m[b].oi || 0) - (m[a].oi || 0)).slice(0, 6); }
  const rows = list.map((c) => { const x = m[c]; const f8 = (x.f || 0) * 8 * 100; const fy = (x.f || 0) * 24 * 365 * 100;
    return `<tr><td>${esc(c)}</td><td>${price(x.px)}</td><td class="${f8 > 0 ? 'neg' : f8 < 0 ? 'pos' : 'flat'}" title="longs pay shorts when positive">${pct(f8, 4)}</td><td>${num(fy, 0)}%</td><td>${compactUsd(x.oi)}</td><td class="${cls(x.pr)}">${pct((x.pr || 0) * 100, 3)}</td></tr>`; }).join('');
  setHTML($('funding'), rows ? `<div class="ops-wrap"><table class="funding"><thead><tr><th>${fallback ? 'top OI' : 'desk mkt'}</th><th>price</th><th>funding / 8h</th><th>apr</th><th>open int.</th><th>premium</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    `<div class="loading" style="margin-top:6px">Funding is what longs pay shorts every hour (negative: shorts pay). A desk holding against the funding bleeds it.</div>`
    : `<div class="notice">No funding snapshot yet.</div>`, 'funding');
  setText($('fundingWhen'), foto?.t ? ago(foto.t, now) : '');
}

/* ── the hall ──────────────────────────────────────────── */
const TIPO_ORDER = ['15m', '1h', '4h'];
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
  if (tipo === 'cruceEma') ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (tipo === 'rsi') ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (tipo === 'ruptura') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.1, y + r * 0.85); ctx.lineTo(x - r * 1.1, y + r * 0.85); ctx.closePath(); }
  else { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.2, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r * 1.2, y); ctx.closePath(); }
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
  const stallCls = ev.estancado >= (ev.config?.estancadoTras || 15) ? 'bad' : ev.estancado >= (ev.config?.estancadoTras || 15) / 2 ? 'warn' : '';
  const div = last.diversidad;
  const divCls = div != null ? (div < 0.15 ? 'bad' : div < 0.3 ? 'warn' : 'ok') : '';
  setHTML(stats,
    `<div class="stat gen"><div class="k">generation</div><div class="v">${ev.generacion ?? 0}</div></div>` +
    `<div class="stat"><div class="k">stagnant for</div><div class="v ${stallCls}">${ev.estancado ?? 0}<small> gen</small></div></div>` +
    `<div class="stat"><div class="k">diversity</div><div class="v ${divCls}">${div != null ? num(div, 2) : '—'}</div></div>` +
    `<div class="stat"><div class="k">profitable in validation</div><div class="v">${last.rentablesVal ?? '—'}<small> / ${(ev.poblacion || []).length}</small></div></div>` +
    `<div class="stat"><div class="k">speed</div><div class="v">${msAvg != null ? num(msAvg, 0) : '—'}<small> ms / gen</small></div></div>` +
    `<div class="stat"><div class="k">running for</div><div class="v">${esc(running)}</div></div>` +
    `<div class="stat"><div class="k">best validated</div><div class="v ${cls(ev.mejorValidado?.validacion?.netoPct)}">${ev.mejorValidado ? pct(ev.mejorValidado.validacion?.netoPct, 1) : '—'}</div></div>`,
    'hallStats');
  const n = (ev.poblacion || []).length;
  setText($('hallSub'), `${n} chairs · ${ev.config?.elite ?? '?'} elite · mutation ${Math.round((ev.config?.pMutacion || 0) * 100)}% · crossover ${Math.round((ev.config?.pCruce || 0) * 100)}% · ${ev.config?.inmigrantes ?? 0} immigrants · validation ${Math.round((ev.config?.validacionPct || 0) * 100)}% of candles`);

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
    `<div class="cv"><span>val <b class="${cls(a.validacion?.netoPct)}">${pct(a.validacion?.netoPct, 1)}</b></span><span>${esc(a.g?.intervalo || '')} g${a.generacion}</span></div></button>`).join(''), 'cand');
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
  for (const iv of TIPO_ORDER) groups.set(iv, []);
  for (const p of pop) { if (!groups.has(p.intervalo)) groups.set(p.intervalo, []); groups.get(p.intervalo).push(p); }
  for (const g of groups.values()) g.sort((a, b) => (b.val ?? -999) - (a.val ?? -999) || (b.fit ?? 0) - (a.fit ?? 0));
  const fits = pop.map((p) => p.fit ?? 0).sort((a, b) => a - b);
  const fitLo = fits[0] ?? 0, fitHi = fits[fits.length - 1] ?? 1;

  // layout
  const layout = []; let y = padTop; const labels = [];
  for (const [iv, list] of groups) {
    if (!list.length && !TIPO_ORDER.includes(iv)) continue;
    labels.push({ y: y + 12, text: `${iv} · ${list.length}` });
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
  card.innerHTML = `<div class="cc-head">${avatarSVG(p.id)}<div style="min-width:0"><div class="cc-name">${esc(p.nombre)}</div><div class="cc-sub">gen ${p.gen} · ${esc(p.origen)} · ${esc(p.tipo)} · ${esc(p.intervalo)}</div></div></div>` +
    `<div class="cc-row"><span>markets</span><b>${esc((p.mercados || []).join(' '))}</b></div>` +
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
  contratacion: ['hire', 'HIRE'], despido: ['fire', 'FIRE'], apertura: ['open', 'OPEN'], ganancia: ['win', 'WIN'],
  perdida: ['loss', 'LOSS'], consejo: ['council', 'COUNCIL'], nacimiento: ['birth', 'BIRTH'], record: ['record', 'RECORD'],
  estancamiento: ['stall', 'STALL'], mutacion: ['mutation', 'MUTATE'], generacion: ['gen', 'GEN'],
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
    const [c, label] = FEED_TYPES[f.tipo] || ['gen', String(f.tipo || '').toUpperCase().slice(0, 7)];
    const key = f.t + ':' + f.tipo + ':' + (f.id || '');
    const fresh = !firstRender && !S.feedSeen.has(key);
    const text = f.id ? `<a href="#" data-open="${esc(f.id)}">${esc(f.texto)}</a>` : esc(f.texto);
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
  const consejos = a?.consejos || [];
  const last = consejos[consejos.length - 1];
  const r = a?.reglas || {};
  let body;
  if (!last) body = `<div class="notice">No council has sat yet. The first session is at 00:00 UTC, or press the button to hold it now.${a?.ultimoConsejo ? '' : ''}</div>`;
  else body = `<ul class="verdicts">${(last.veredictos || []).map(verdictHTML).join('') || '<li class="notice">The council sat but had nobody to judge.</li>'}</ul>`;
  setHTML($('councilBody'), body, 'council');
  setText($('councilWhen'), last ? `${dateShort(last.t)} UTC · ${(last.veredictos || []).length} verdicts · ${consejos.length} sessions so far` : (a?.ultimoConsejo ? 'last: ' + dateShort(a.ultimoConsejo) : 'none yet'));
  const minOps = r.minOperacionesParaJuzgar ?? 3;
  setHTML($('rules'),
    `<li><span class="pill ok">performing</span><span>Net result over the last 7 days above ${num(r.cumpleNetoPct ?? 0, 0)}% and max drawdown under ${num(r.cumpleDDPct ?? 15, 0)}%. Keeps the desk.</span></li>` +
    `<li><span class="pill warn">probation</span><span>Not yet positive, but drawdown under ${num(r.observacionDDPct ?? 10, 0)}% or fewer than ${minOps} trades (too little data to judge). At most ${r.observacionMaxDias ?? 3} days in a row.</span></li>` +
    `<li><span class="pill bad">fired</span><span>Drawdown over ${num(r.despidoDDPct ?? 15, 0)}%, or ${r.observacionMaxDias ?? 3} days in probation without improving, or 7-day net below ${num(r.despidoNeto7dPct ?? -5, 0)}%. The desk goes to a child of the best or to the best validated candidate in the hall.</span></li>` +
    `<li><span class="pill dim">how</span><span>Rules, not a model: cheap, reproducible and explainable. Every verdict and its reason is written to the agent's file.</span></li>`,
    'rules');
  const btn = $('holdCouncil');
  btn.disabled = !S.live;
  setText($('holdHint'), S.live ? 'Runs the daily verdicts right now (POST /consejo).' : 'Only available while the engine is live on your PC.');
}

async function holdCouncil() {
  if (!S.live) return;
  if (!confirm('Hold the council now? It will judge every desk with the rules and may fire agents.')) return;
  const btn = $('holdCouncil'); btn.disabled = true;
  try {
    await fetchJSON(API + '/consejo', { method: 'POST' }, 20000);
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
  setHTML($('fired'), fired.length ? `<ul class="rows">` + fired.slice().reverse().map((f) =>
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
  }).join('') + `</ul>` : `<div class="notice">No requests. When a supervisor or the council needs another platform, a data source or a rule change, it will appear here for you to approve or reject.</div>`, 'requests');

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
  if (!html) html = `<div class="notice">No reports yet. Four supervisors (Data, Evolution, Risk, UI) will read the briefing and leave their findings here. They fight for their seat too.</div>`;
  setHTML($('supervisors'), html, 'sup');
}

async function decideRequest(id, act) {
  if (!S.live) return;
  const label = act === 'aprobar' ? 'Approve' : 'Reject';
  if (!confirm(`${label} request ${id}?`)) return;
  try {
    await fetchJSON(API + '/peticion/' + encodeURIComponent(id) + '/' + act, { method: 'POST' }, 10000);
    toast(`Request ${act === 'aprobar' ? 'approved' : 'rejected'}.`);
    await load();
  } catch (e) { toast('Failed: ' + e.message); }
}

/* ── footer ────────────────────────────────────────────── */
function renderFooter() {
  const d = S.data; if (!d) { setText($('footMeta'), ''); return; }
  const ev = d.evolucion;
  const velas = ev?.velas ? Object.values(ev.velas).reduce((s, n) => s + n, 0) : 0;
  setText($('footMeta'), `engine v${d.motor?.version || '?'} · up since ${dateShort(d.motor?.arrancado)} UTC · ${ev ? (ev.coins || []).length + ' markets · ' + num(velas, 0) + ' candles' + (ev.validacionDesde ? ' · validation from ' + dateShort(ev.validacionDesde) : '') : 'evolution not running'} · data ${dateShort(d.cuando)} UTC`);
}

/* ── the agent file (modal) ────────────────────────────── */
function genomeBlocks(g) {
  if (!g) return '<div class="notice">Genome not available in this view.</div>';
  const e = g.entrada || {}, s = g.salida || {}, r = g.riesgo || {};
  let entry;
  switch (e.tipo) {
    case 'cruceEma': entry = `EMA cross ${e.emaRapida}/${e.emaLenta}`; break;
    case 'rsi': entry = `RSI(${e.rsiN}) below ${e.rsiBajo} to buy, above ${e.rsiAlto} to sell`; break;
    case 'ruptura': entry = `Breakout of the ${e.rupturaN}-candle high / low`; break;
    case 'fibonacci': entry = `Fibonacci ${e.fibNivel} retracement of the last ${e.fibN}-candle swing (±${e.fibTol}%)`; break;
    default: entry = esc(e.tipo || '?');
  }
  const filters = [];
  if (e.filtroTendencia) filters.push(`trend filter EMA ${e.tendEmaN}`);
  if (e.filtroVol) filters.push(`ATR(${e.atrN}) ≥ ${e.atrMinPct}%`);
  if (e.filtroVolumen) filters.push(`volume above its ${e.volN}-candle average`);
  const target = s.objetivo === 'fib' ? `target at Fibonacci extension ${s.fibExt}` : `target ${s.objetivoR}R`;
  return `<div class="genome">` +
    `<div class="gblock"><b>Markets</b>${esc((g.mercados || []).join(' · '))} <span>· ${esc(g.intervalo)} candles · ${esc(sideLabel(g.lado))}</span></div>` +
    `<div class="gblock"><b>Entry</b>${entry}<span>${filters.length ? ' · ' + filters.join(' · ') : ' · no filters'}</span></div>` +
    `<div class="gblock"><b>Exit</b>stop ${s.stopAtr}×ATR · ${target}<span> · trailing ${s.trailingAtr}×ATR · max ${s.maxVelas} candles</span></div>` +
    `<div class="gblock"><b>Risk</b>${r.apalancamiento}× leverage<span> · ${Math.round((r.fraccion || 0) * 100)}% of the balance per trade</span></div>` +
    `</div>`;
}
function metricsTable(tr, va) {
  const rows = [
    ['Net', (m) => `<span class="${cls(m.netoPct)}">${pct(m.netoPct, 1)}</span>`],
    ['Max drawdown', (m) => num(m.maxDDPct, 1) + '%'],
    ['Trades', (m) => m.operaciones ?? '—'],
    ['Win rate', (m) => num(m.aciertoPct, 1) + '%'],
    ['Profit factor', (m) => num(m.factor, 2)],
    ['Avg trade', (m) => pct(m.mediaPct, 2)],
    ['Liquidations', (m) => m.liquidaciones ?? 0],
    ['Candles', (m) => num(m.velas, 0)],
    ['Score', (m) => `<b class="${cls(m.puntuacion)}">${num(m.puntuacion, 1)}</b>`],
  ];
  const t = tr || {}, v = va || {};
  let html = `<table class="metrics"><thead><tr><th></th><th>training</th><th>validation</th></tr></thead><tbody>` +
    rows.map(([k, f]) => `<tr><td>${k}</td><td>${f(t)}</td><td>${f(v)}</td></tr>`).join('') + `</tbody></table>`;
  if (tr && va) {
    const overfit = (t.puntuacion > 20 && v.puntuacion < t.puntuacion / 3) || (t.netoPct > 20 && v.netoPct < t.netoPct / 4);
    if (overfit) html += `<div class="overfit">Looks overfitted: it did far better on the candles it trained on (${num(t.puntuacion, 0)}) than on the ones it never saw (${num(v.puntuacion, 0)}). Trust the validation column.</div>`;
    else if (v.puntuacion > 0 && t.puntuacion > 0) html += `<div class="overfit" style="color:var(--safe);border-color:rgba(63,191,127,.45);background:rgba(63,191,127,.08)">Training and validation agree: it kept working on candles it never saw.</div>`;
  }
  return html;
}
function opsTable(ops) {
  if (!ops || !ops.length) return `<div class="notice">No trades yet at this desk.</div>`;
  return `<div class="ops-wrap"><table class="ops"><thead><tr><th>coin</th><th>side</th><th>in</th><th>out</th><th>P&amp;L</th><th>%</th><th>why</th><th>closed</th></tr></thead><tbody>` +
    ops.slice(0, 40).map((o) => `<tr><td>${esc(o.coin)}</td><td class="side ${/corto|short/.test(o.lado) ? 'short' : 'long'}">${esc(sideLabel(o.lado))}</td><td>${price(o.entrada)}</td><td>${price(o.salida)}</td><td class="${cls(o.pnl)}">${money(o.pnl)}</td><td class="${cls(o.pct)}">${pct(o.pct)}</td><td>${esc(o.motivo || '')}</td><td>${dateShort(o.tOut)}</td></tr>`).join('') +
    `</tbody></table></div>`;
}

let agentCache = new Map();
async function agentInfo(id) {
  const m = stateMap();
  let a = m.get(id);
  if (a && (a.kind === 'desk' || a.kind === 'fired' || a.kind === 'agent')) return a;
  if (agentCache.has(id)) return agentCache.get(id) || a || null;
  if (S.live) {
    try { const full = await fetchJSON(API + '/estado/agente/' + encodeURIComponent(id), {}, 5000); agentCache.set(id, full); return { kind: 'full', ...full }; }
    catch (e) { agentCache.set(id, null); }
  }
  return a || null;
}
function nodeHTML(a, id, you = false) {
  if (!a) return `<span class="tnode unknown">${avatarSVG(id)}<span class="tn">${esc(id)}</span><span class="tg">unknown — gone from the hall</span></span>`;
  const gen = a.generacion ?? a.gen;
  return `<span class="tnode${you ? ' you' : ''}" data-open="${esc(a.id || id)}">${avatarSVG(a.id || id)}<span class="tn">${esc(a.nombre || id)}</span><span class="tg">g${gen ?? '?'} ${esc(a.origen || '')}</span></span>`;
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
  const precios = S.data?.precios || {};
  let html = `<div class="modal-head">${avatarSVG(a.id)}<div style="min-width:0"><h3>${esc(a.nombre)}</h3><div class="mh-sub"><span>${esc(a.id)}</span><span>· gen ${gen ?? '?'}</span><span>· ${esc(a.origen || '')}</span>${where}${estado}</div></div><button class="modal-close" type="button" data-close>×</button></div>`;
  html += `<div class="modal-body">`;
  html += `<div><h4>Strategy</h4><div class="strategy">${esc(a.descripcion || '—')}</div>${a.motivo ? `<div class="loading" style="margin-top:4px">${esc(a.motivo)}</div>` : ''}</div>`;
  html += fichaExtraHTML(a, S.data, (pid) => { const m = stateMap().get(pid); return m?.nombre || S.data?.academia?.genealogia?.[pid]?.nombre || null; });
  if (a.kind === 'desk') {
    const pnlPct = a.saldoInicial ? (a.saldo - a.saldoInicial) / a.saldoInicial * 100 : 0;
    html += `<div><h4>At the desk</h4><div class="office-summary" style="margin:0">` +
      `<div class="stat"><div class="k">balance</div><div class="v">${money(a.saldo)}</div></div>` +
      `<div class="stat"><div class="k">P&amp;L</div><div class="v ${cls(pnlPct)}">${pct(pnlPct)}</div></div>` +
      `<div class="stat"><div class="k">peak</div><div class="v">${money(a.pico)}</div></div>` +
      `<div class="stat"><div class="k">max drawdown</div><div class="v">${num(a.maxDDPct, 1)}%</div></div></div>` +
      `<div style="margin-top:8px">${sparkline(a.curva)}</div>` +
      `<div class="loading" style="margin-top:4px">hired ${dateShort(a.contratado)} UTC${a.estado === 'observacion' ? ` · probation day ${a.diasObservacion || 0}` : ''}</div>` +
      (Object.keys(a.posiciones || {}).length ? `<div class="desk-pos" style="margin-top:8px">${positionRows(a, precios, true)}</div>` : '') + `</div>`;
  }
  if (a.kind === 'fired') {
    html += `<div><h4>Dismissal</h4><div class="rd" style="font:12.5px/1.5 var(--mono);color:var(--text-dim)">net <span class="${cls(a.netoPct)}">${pct(a.netoPct)}</span> · max DD ${num(a.maxDDPct, 1)}% · ${a.operaciones ?? 0} trades · hired ${dateShort(a.contratado)} · fired ${dateShort(a.despedido)}</div></div>`;
  }
  html += `<div><h4>Genome</h4>${genomeBlocks(g)}${(a.cambios || g?.cambios || []).length ? `<h4 style="margin-top:10px">Changes from its parents</h4><ul class="changes">${(a.cambios || g.cambios).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</div>`;
  html += `<div><h4>Training vs validation</h4>${metricsTable(a.entreno, a.validacion)}</div>`;
  if (a.veredictos && a.veredictos.length) html += `<div><h4>Council verdicts</h4><ul class="verdicts">${a.veredictos.slice().reverse().map(verdictHTML).join('')}</ul></div>`;
  if (a.kind === 'desk' || a.operaciones) html += `<div><h4>Trades</h4>${opsTable(a.operaciones)}</div>`;
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
    setHTML($('desks'), `<div class="notice" style="grid-column:1/-1">Nothing to show: the engine at localhost:4340 is not answering and there is no snapshot at academia/estado.json.</div>`, 'desksEmpty');
    return;
  }
  renderOffice();
  renderNewsroom();
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
    const t = ev.target.closest('[data-open], [data-close], .desk[data-id], [data-req]');
    if (!t) return;
    if (t.hasAttribute('data-close')) { closeModal(); return; }
    if (t.dataset.req) { decideRequest(t.dataset.req, t.dataset.act); return; }
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
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderHistory(); if (S.data?.evolucion) drawHall(S.data.evolucion.poblacion || [], new Set((S.data.academia?.puestos || []).filter((p) => p.agente).map((p) => p.agente.id)), S.prevPop || new Set()); }, 150); });
  renderClock(); setInterval(renderClock, 1000);
  load();
  setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - S.fetchedAt > REFRESH_MS) load(); });
  // relative "data … ago" in the header ticks between fetches
  setInterval(() => { if (S.data) renderHeader(); }, 5000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
