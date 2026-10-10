/* LA ACADEMIA · the trench — the office floor. An isometric room drawn on a
 * <canvas>, in the flat-shaded Habbo style the owner approved for Arcopolis:
 * ten desks with a monitor each, a tea room, a whiteboard, a door, windows over
 * a night skyline. The hired memecoin traders walk around as pixel avatars with
 * a deterministic personality (from the genome and the record) and talk in
 * speech bubbles with the vocabulary of the trenches: rugs, snipers, bonding
 * curves, graduations, wen moon.
 *
 * House rules kept here:
 *  - no libraries, no CDN, no build (ES module imported by academia.js);
 *  - no requestAnimationFrame: the room runs on a setInterval at ~8 fps, which
 *    background tabs slow down on their own (and that is fine);
 *  - no transform/zoom on any ancestor of the canvas: the canvas is drawn at
 *    its real CSS size (times devicePixelRatio inside the bitmap only);
 *  - mobile first: the room scales to the container width, no horizontal scroll.
 *
 * Exports: initOficina, updateOficina, personalidad, habilidades, fichaExtraHTML. */

/* ── deterministic helpers (same hash as academia.js, so avatars match) ── */
export function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function shade(hex, k) {
  // darken/lighten a #rrggbb by factor k (0.73 = 27 % darker, like Habbo's right face)
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * k), 0, 255), g = clamp(Math.round(((n >> 8) & 255) * k), 0, 255), b = clamp(Math.round((n & 255) * k), 0, 255);
  return `rgb(${r},${g},${b})`;
}
function fillVars(t, vars) {
  return t.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null && vars[k] !== '' ? String(vars[k]) : fallbackVar(k)));
}
function fallbackVar(k) {
  return { coin: 'the next launch', side: 'long', pct: '0%', n: '?', other: 'the neighbour', best: 'someone', stall: 'a few', gen: '?', lev: '1', ops: 'a few', velas: 'many', dia: '1', tipo: 'strategy', val: 'something', origin: 'unknown', titulo: 'something', genbest: '?', vivos: 'a few', x: '2', stop: '50', maxmin: '60', pad: 'any pad', muertos: '0', smart: '0', mcap: '$20k' }[k] ?? '';
}

/* the six ways a trench agent can pull the trigger, in English */
export const DISPARO_LABEL = { flujo: 'flow reader', listos: 'copycat', momentum: 'chaser', holders: 'community believer', rebote: 'knife catcher', nacimiento: 'trench rat', devVendio: 'dev-dump buyer', tuit: 'tweet chaser' };
function disparoLabel(t) { return DISPARO_LABEL[t] || t || 'strategy'; }
function isTrench(a) { return !!(a && a.g && a.g.disparo && a.g.filtros); }

/* ── the look of an avatar: same palette/frame as avatarSVG in academia.js ── */
const SKINS = ['#f1c9a5', '#e0ac7e', '#c68642', '#8d5524', '#f7dcc4', '#b97a56'];
export function lookOf(id) {
  const h = hash(String(id || 'x'));
  const hue = h % 360;
  const hue2 = (hue + 40 + ((h >>> 8) % 80)) % 360;
  const shape = (h >>> 16) % 4;
  const bits = h ^ (h >>> 7) ^ Math.imul(h, 2654435761);
  return {
    hue, shape, bits,
    frame: `hsl(${hue} 45% 16%)`,
    shirt: `hsl(${hue} 80% 62%)`,
    shirtDark: `hsl(${hue} 70% 48%)`,
    hair: `hsl(${hue2} 85% 70%)`,
    pants: `hsl(${hue} 30% 26%)`,
    shoes: '#1b1f26',
    skin: SKINS[(h >>> 20) % SKINS.length],
    mouth: '#8a4b3c',
    hairStyle: shape,
  };
}

/* ── personality: 2-3 traits from the genome and the record ────────────── */
export const TRAITS = {
  mystic: { label: 'Mystic', blurb: 'trades Fibonacci retracements and trusts the golden ratio more than the news' },
  impulsive: { label: 'Impulsive', blurb: 'buys breakouts the moment the high goes; thinks later, if at all' },
  methodical: { label: 'Methodical', blurb: 'waits for the EMA cross on the closed candle, by the book, every time' },
  contrarian: { label: 'Contrarian', blurb: 'fades the crowd with the RSI: buys the panic, sells the party' },
  reckless: { label: 'Reckless', blurb: 'high leverage; liquidation is a number it has met before' },
  cautious: { label: 'Cautious', blurb: 'low leverage; slow is smooth and smooth stays employed' },
  pessimist: { label: 'Pessimist', blurb: 'only shorts; everything goes down eventually, including its mood' },
  optimist: { label: 'Optimist', blurb: 'only longs; up only is, officially, a strategy' },
  hyperactive: { label: 'Hyperactive', blurb: 'trades a lot; does not sleep, rebalances' },
  patient: { label: 'Patient', blurb: 'few trades in many candles; a sniper, not a machine gun' },
  nervous: { label: 'Nervous', blurb: 'on probation; the council sits at midnight and it knows' },
  confident: { label: 'Confident', blurb: 'performing; wants it underlined in the minutes' },
  bitter: { label: 'Bitter', blurb: 'fired; keeps the mug, blames the funding' },
  wellbred: { label: 'Well-bred', blurb: 'born by crossover of two parents and a tournament' },
  mutant: { label: 'Mutant', blurb: 'a mutation of one parent: like it, but different in the right places (hopefully)' },
  selfmade: { label: 'Self-made', blurb: 'born at random, zero mentors, zero parents' },
  // the trench
  flowreader: { label: 'Flow reader', blurb: 'buys where the net buyers pile in: more buys than sells in five minutes, nothing else matters' },
  copycat: { label: 'Copycat', blurb: 'follows the watched wallets; if smart money buys, it buys a minute later' },
  chaser: { label: 'Chaser', blurb: 'buys green candles that are already green; momentum first, questions later' },
  believer: { label: 'Community believer', blurb: 'counts holders, not candles; a growing community is the whole thesis' },
  knifecatcher: { label: 'Knife catcher', blurb: 'buys the first green minute after an hour of bleeding; sometimes it is a bounce, sometimes a rug' },
  trenchrat: { label: 'Trench rat', blurb: 'lives in the first fifteen minutes of every launch; eats snipers for breakfast, gets eaten for lunch' },
  diamondhands: { label: 'Diamond hands', blurb: 'wide stop: holds through the dip, and now and then into the rug' },
  paperhands: { label: 'Paper hands', blurb: 'tight stop: out at the first red minute, keeps the losses small and the regrets many' },
  greedy: { label: 'Greedy', blurb: 'wants a big multiple before selling; wen moon is a target, not a question' },
  scalper: { label: 'Scalper', blurb: 'minutes inside, not hours; takes the quick x and leaves' },
  paranoid: { label: 'Paranoid', blurb: 'only touches tokens that pass the safety check: no mint authority, no freeze, no tax, not rugged' },
  pumpmaxi: { label: 'Pump maxi', blurb: 'only buys on the bonding curve of pump.fun; graduation is the dream' },
  poolborn: { label: 'Pool purist', blurb: 'only tokens born straight in a pool, no launchpad; thinks curves are for tourists' },
  devdumper: { label: 'Dev-dump buyer', blurb: 'waits for the dev to sell its bag and buys the panic if the net buyers keep coming' },
  tweetchaser: { label: 'Tweet chaser', blurb: 'buys when a watched X account posts the contract address; the timeline is its order book' },
  scaler: { label: 'Scaler', blurb: 'sells slices on the way up and keeps a moonbag; never all out, never all in' },
  allin: { label: 'All-in', blurb: 'conviction size when volume and net buyers explode: several times the usual bet, capped by equity' },
  nightowl: { label: 'Clock watcher', blurb: 'only trades inside its hours window (UTC); outside it, tea' },
  weatherwise: { label: 'Weather-wise', blurb: 'reads the trench pulse and SOL before buying; stays out when the sky is dark' },
  student: { label: 'Student', blurb: 'has adopted the exits and filters of a better descendant from the hall; the office will judge the lesson' },
};
export function personalidad(a) {
  if (!a) return [];
  const g = a.g || {}; const e = g.entrada || {}; const r = g.riesgo || {}; const t = a.entreno || {};
  const keys = [];
  const estado = a.estado || (a.despedido ? 'despedido' : null);
  if (isTrench(a)) {
    const TYPE = { flujo: 'flowreader', listos: 'copycat', momentum: 'chaser', holders: 'believer', rebote: 'knifecatcher', nacimiento: 'trenchrat', devVendio: 'devdumper', tuit: 'tweetchaser' };
    if (TYPE[g.disparo.tipo]) keys.push(TYPE[g.disparo.tipo]);
    const s = g.salida || {}, f = g.filtros || {};
    if (g.conviccion?.activa) keys.push('allin');
    if (a.aprendido || (a.epocas || []).length) keys.push('student');
    if (s.escalonado) keys.push('scaler');
    if (s.stopPct >= 55) keys.push('diamondhands'); else if (s.stopPct <= 20) keys.push('paperhands');
    if (f.horasActivo) keys.push('nightowl'); else if (f.pulsoMin > 0 || f.solCaidaMax > 0) keys.push('weatherwise');
    if (estado === 'observacion') keys.push('nervous'); else if (estado === 'cumple') keys.push('confident'); else if (estado === 'despedido') keys.push('bitter');
    if (s.objetivoX >= 4) keys.push('greedy'); else if (s.maxMin <= 15) keys.push('scalper');
    if (f.requiereSegura) keys.push('paranoid');
    if (f.pad === 'pump.fun') keys.push('pumpmaxi'); else if (f.pad === 'sin pad') keys.push('poolborn');
    const rate = t.operaciones;
    if (rate != null && rate >= 40) keys.push('hyperactive'); else if (rate != null && rate > 0 && rate < 5) keys.push('patient');
  } else {
    const TYPE = { fibonacci: 'mystic', ruptura: 'impulsive', cruceEma: 'methodical', rsi: 'contrarian' };
    if (TYPE[e.tipo]) keys.push(TYPE[e.tipo]);
    const lev = r.apalancamiento || 1;
    if (lev >= 8) keys.push('reckless'); else if (lev <= 2) keys.push('cautious');
    if (estado === 'observacion') keys.push('nervous'); else if (estado === 'cumple') keys.push('confident'); else if (estado === 'despedido') keys.push('bitter');
    const rate = t.velas ? (t.operaciones || 0) / t.velas * 100 : null;
    if (rate != null && rate >= 1.5) keys.push('hyperactive'); else if (rate != null && rate < 0.4) keys.push('patient');
    const lado = g.lado;
    if (lado === 'corto' || lado === 'short') keys.push('pessimist'); else if (lado === 'largo' || lado === 'long') keys.push('optimist');
  }
  const origin = a.origen || g.origen;
  if (origin === 'cruce') keys.push('wellbred'); else if (origin === 'mutacion') keys.push('mutant'); else if (origin === 'aleatorio') keys.push('selfmade');
  // 3 at most, in that priority; if we only have 2, the origin one gets in
  let out = keys.slice(0, 3);
  if (out.length < 2 && keys.length > out.length) out = keys.slice(0, 2);
  return out.map((k) => ({ key: k, ...TRAITS[k] }));
}

/* ── skills (0..100) ────────────────────────────────────────────────────── */
export function habilidades(a) {
  if (!a) return [];
  const g = a.g || {}; const s = g.salida || {}; const r = g.riesgo || {};
  const v = a.validacion || {}, t = a.entreno || {};
  let consistency = null, consHint;
  const win = a.ventanas || t.ventanas || v.ventanas;
  if (Array.isArray(win) && win.length > 1 && win.every((x) => typeof x === 'number' || typeof x?.puntuacion === 'number')) {
    const xs = win.map((x) => typeof x === 'number' ? x : x.puntuacion);
    const mean = xs.reduce((p, q) => p + q, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((p, q) => p + (q - mean) ** 2, 0) / xs.length);
    consistency = (1 - clamp(sd / (Math.abs(mean) + 1), 0, 1)) * 100;
    consHint = `${xs.length} training windows: mean ${mean.toFixed(1)}, spread ${sd.toFixed(1)}`;
  } else if (t.netoPct != null && v.netoPct != null) {
    const diff = Math.abs(t.netoPct - v.netoPct);
    consistency = clamp(1 - diff / Math.max(5, Math.abs(t.netoPct) + Math.abs(v.netoPct)), 0, 1) * 100;
    consHint = `training ${t.netoPct.toFixed(1)}% vs validation ${v.netoPct.toFixed(1)}% (no window data from the engine)`;
  }
  if (isTrench(a)) {
    const m = v.operaciones ? v : t;                 // measured on validation when it traded there
    const where = v.operaciones ? 'validation' : 'training';
    const patience = clamp((s.maxMin || 0) / 720, 0, 1) * 100;
    const greed = clamp(((s.objetivoX || 1.15) - 1.15) / (6 - 1.15), 0, 1) * 100;
    const precision = m.operaciones ? m.aciertoPct : null;
    const discipline = (1 - clamp(((s.stopPct ?? 70) - 10) / 60, 0, 1)) * 100;
    const rugDodge = m.operaciones ? (1 - clamp((m.muertos || 0) / m.operaciones, 0, 1)) * 100 : null;
    const f = g.filtros || {};
    const nFilters = [f.holdersMin > 0, f.organicoMin > 0, f.top10Max < 100, f.requiereSegura, f.lpLockedMin > 0, f.devMintsMax < 200, f.snipersMax < 30, f.pad !== 'cualquiera', f.soloGraduados, f.soloConMarketing, f.devVendioMax < 100, f.devCompraMax < 10, f.devGraduo, f.requiereTuit, f.horasActivo, f.pulsoMin > 0, f.solCaidaMax > 0].filter(Boolean).length;
    const paranoia = clamp(nFilters / 7, 0, 1) * 100;
    return [
      { key: 'patience', label: 'Patience', v: patience, hint: `holds up to ${s.maxMin ?? '?'} min inside a token` },
      { key: 'greed', label: 'Greed', v: greed, hint: `sells at ×${s.objetivoX ?? '?'}` + (s.trailingPct ? ` · trailing ${s.trailingPct}%` : '') },
      { key: 'precision', label: 'Precision', v: precision, hint: precision == null ? 'no trades measured yet' : `${precision.toFixed(1)}% winners in ${where}` },
      { key: 'discipline', label: 'Discipline', v: discipline, hint: `stop at −${s.stopPct ?? '?'}% (tighter stop = more discipline)` },
      { key: 'rugdodge', label: 'Rug dodging', v: rugDodge, hint: rugDodge == null ? 'no trades measured yet' : `${m.muertos || 0} of ${m.operaciones} trades went to zero in ${where}` },
      { key: 'paranoia', label: 'Paranoia', v: paranoia, hint: `${nFilters} safety / quality filter${nFilters === 1 ? '' : 's'} on before it even looks at the trigger` },
      { key: 'consistency', label: 'Consistency', v: consistency, hint: consHint || 'not measurable yet' },
    ];
  }
  const maxVelas = s.maxVelas ?? 0;
  const patience = clamp(maxVelas / 200, 0, 1) * 100;
  const lev = r.apalancamiento || 1, frac = r.fraccion || 0;
  const aggression = Math.sqrt(clamp(lev * frac / 4, 0, 1)) * 100;
  const precision = v.aciertoPct ?? t.aciertoPct ?? null;
  const stop = s.stopAtr ?? null;
  const discipline = stop == null ? null : (1 - clamp((stop - 0.5) / 4.5, 0, 1)) * 100;
  return [
    { key: 'patience', label: 'Patience', v: patience, hint: `holds up to ${maxVelas} candles` },
    { key: 'aggression', label: 'Aggressiveness', v: aggression, hint: `${lev}× leverage · ${Math.round(frac * 100)}% of the balance per trade` },
    { key: 'precision', label: 'Precision', v: precision, hint: precision == null ? 'no trades measured yet' : `${precision.toFixed(1)}% winners in ${v.aciertoPct != null ? 'validation' : 'training'}` },
    { key: 'discipline', label: 'Discipline', v: discipline, hint: stop == null ? '—' : `stop at ${stop}×ATR (tighter stop = more discipline)` },
    { key: 'consistency', label: 'Consistency', v: consistency, hint: consHint || 'not measurable yet' },
  ];
}

/* ── what they say: generic lines per situation + trait flavour ────────── */
const PHRASES = {
  idle: [
    'Scanning {vivos} live tokens. None of them deserves me yet.',
    'Refreshing the trench like it owes me SOL.',
    'Flat and proud. Flat is the only position that never rugs.',
    'Staring at {coin} until it graduates or dies.',
    'No trigger yet. The trench is thinking. Loudly.',
    'New launch. Rug. New launch. Rug. Love this job.',
    'Paper SOL, real feelings.',
    '{vivos} tokens alive right now. Statistically, {vivos} rugs tomorrow.',
    'Wen moon? Wen filters pass, that is wen.',
  ],
  probation: [
    'Day {dia} of probation. The chair feels colder than a dead pool.',
    'Council at midnight. I have prepared a speech about rugs.',
    'Net zero is a number too. Technically. Please.',
    "I'd trade more if the launches would stop rugging.",
    'Keeping my drawdown under 25 %. Keeping my hopes under 5 %.',
    "Please don't look at my equity curve. It's shy.",
    'Validation said {val}. The council wants more than that.',
    'Three trades to be judged. I have {ops}. Math is cruel.',
  ],
  performing: [
    "Green on the board. Don't jinx it, the trench hears everything.",
    'I told you the {tipo} works. Sometimes. Often enough.',
    'Performing. Underline it in the minutes, in green.',
    'Still employed. Round of paper coffee on me.',
    'My equity curve has a nice slope. I combed it.',
    'Rugs: {muertos}. Winners: more. That is the whole job.',
  ],
  holding: [
    'Holding {coin}. Breathing optional, trailing stop mandatory.',
    'In {coin} at {mcap}. Wen ×{x}?',
    'Green is nice. Sold green is nicer. Rug is also a colour.',
    'Watching {coin}. {coin} is watching the dev wallet.',
    'If the liquidity moves, I move faster. Hopefully.',
    '{coin}: {smart} smart wallets inside with me. Company at last.',
    'Max {maxmin} minutes in {coin}. Then I leave, moon or no moon.',
  ],
  open: [
    'Bought {coin} at {mcap}. Hold my tea.',
    'In on {coin}. Stop at −{stop} %. Nerves at −100 %.',
    'Entry filled on {coin}. Now we wait like degens, professionally.',
    "{coin}, $10, {tipo}. The trigger fired, I didn't blink.",
    'Aped {coin}. Small. Paper. Still shaking.',
  ],
  win: [
    '{coin} paid. Add it to the whiteboard before it rugs.',
    'Took profit on {coin}. The curve took its 1 % too.',
    "Target hit on {coin}. I'm basically a fund now.",
    '{pct} on {coin}. The council will hear about this.',
    '{coin} did a {pct}. Sold. Never look back at a chart you left.',
  ],
  loss: [
    'Stopped out on {coin}. It was a good stop though.',
    '{coin} disagreed. Loudly. With sell walls.',
    "Small loss. The plan survives. My pride doesn't.",
    '{pct} on {coin}. I blame the snipers.',
    'That stop was tight for a reason. Reason noted on {coin}.',
    '{coin}: the smart money left and so did I. Late.',
  ],
  rug: [
    '{coin} rugged. The liquidity is gone. So is my $10.',
    'Dev pulled the pool on {coin}. Classic. Logged as −100 %.',
    "☠ {coin}. That's a rug. I'm fine. I'm not fine.",
    '{coin} went to zero while I was blinking. Noted: blink less.',
    'Mint authority was revoked. The dev was not. {coin}, rugged.',
  ],
  tea: [
    'The kettle is the only thing here that never rugs.',
    'Tea first, trench later.',
    'Who left the mug with the pump.fun logo on it?',
    "Launches don't stop. Tea breaks do.",
    'Discussing {coin} with the sofa. The sofa says it rugs at 2 am.',
    'Milk, no sugar, 1 % curve fee.',
    'This biscuit has a better drawdown than desk {n}.',
    'Sipping. {vivos} tokens alive. None of them is my problem for five minutes.',
  ],
  visit: [
    'Just checking what desk {n} is doing. Not copying. Copycatting.',
    'Nice equity curve, {other}. Did you draw it yourself?',
    '{other}, is that a stop at −{stop} % or a cry for help?',
    'So this is where the green candles live.',
    'Borrowing a pen. And maybe a filter.',
    "{other}'s stop is wider than my patience.",
    '{other}, which pad do you watch? Asking for a mutation.',
  ],
  news: [
    'Something on the wire. Probably a rug with a press release.',
    "'{titulo}' — noted, ignored, re-noted.",
    'News just hit. My genome says: check the liquidity first.',
  ],
  stall: [
    '{stall} generations without a record. The hall is napping.',
    'Evolution is stuck. Someone mutate harder.',
    'No new best since gen {genbest}. Same as my inbox.',
    'The hall has plateaued. So has the biscuit tin.',
  ],
  record: [
    'New best validated: {best}. Show-off.',
    "{best} just set a record. I'm happy. Visibly.",
    "Record on the board. Someone check it's not overfit to one pump.",
  ],
  hired: [
    "First day. Where's the coffee? Where's the rug check?",
    'Hired at desk {n}. Validation said I was worth {val}.',
    'Reporting for duty. Born by {origin}. Raised in the trenches.',
    'New desk, new me. Same genome, same stop at −{stop} %.',
  ],
  fired: [
    'Fired. Tell my children I had a good drawdown.',
    "They said drawdown. I heard 'character'.",
    'Clearing my desk. Keeping the mug.',
    'Back to the hall. Mutation, here I come.',
    'Rugged by the council. At least they left the liquidity.',
  ],
  council: [
    'Council time. Act natural, equity curve.',
    'The rules are reading my file. I can feel it.',
    'Verdict pending. Tea pending. Everything pending.',
    'Three rules, zero mercy. Love the transparency.',
  ],
  waiting: [
    'Scanning {vivos} live tokens. Nothing passes my filters yet.',
    '{vivos} tokens alive and not one {tipo} setup. Picky, not lazy.',
    'Hired {ago}. The trigger has not fired once. Rules are rules.',
    'I only buy on {pad}. Patience is a filter too.',
    'Waiting for ≥ {smartmin} smart wallets to move. Nothing yet.',
    'Every minute a new photo of every token. Still nothing worth $10.',
  ],
  offline: ['The engine is off. We are all on tea break.'],
};
/* candle intervals: when does the next one close (UTC)? */
const INTERVAL_MS = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '2h': 7200e3, '4h': 14400e3, '1d': 86400e3 };
export function nextCandleClose(intervalo, now = Date.now()) {
  const ms = INTERVAL_MS[intervalo] || 3600e3;
  const t = Math.ceil((now + 1) / ms) * ms;
  return { t, ms, label: new Date(t).toISOString().slice(11, 16), inMin: Math.max(0, Math.round((t - now) / 60000)) };
}
export function agoShort(t, now = Date.now()) {
  if (!t) return '—';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 48) return h + ' h ' + (m % 60) + ' min ago';
  return Math.floor(h / 24) + ' d ago';
}
const TRAIT_PHRASES = {
  mystic: {
    idle: ['0.618. The number speaks. The market listens.', 'Drawing retracements on the window. The skyline is at 0.382.'],
    tea: ['The tea leaves form a golden ratio. Bullish.'],
    loss: ['The retracement went deeper than my faith.'],
    win: ['1.272 extension. As foretold.'],
    probation: ['Fibonacci never had a probation. Different era.'],
  },
  impulsive: {
    idle: ['Break out already. BREAK. OUT.', 'A {n}-candle high is a door. I kick doors.'],
    open: ['Breakout! No time for the second thought.'],
    loss: ['False breakout. Fake news. Fake candle.'],
    win: ['Told you it was breaking. Momentum, baby.'],
    tea: ['Quick tea. The high is about to go.'],
  },
  methodical: {
    idle: ['Fast EMA, slow EMA, slow Tuesday.', 'Cross on the close or no cross at all.'],
    open: ['Cross confirmed on the close. By the book.'],
    tea: ['Two sugars, crossing above the one-sugar average.'],
    loss: ["The cross was clean. The market wasn't."],
    visit: ['Your EMAs are too close together. Just saying.'],
  },
  contrarian: {
    idle: ["Everyone's bullish. That's my signal to frown.", 'RSI at 70. The crowd is wrong again.'],
    open: ["Oversold. They're panicking. I'm shopping."],
    win: ['Bought the fear. Sold the relief.'],
    loss: ['Oversold can get more oversold. Apparently.'],
    tea: ['Everyone takes coffee. I take tea. Contrarian.'],
  },
  reckless: {
    idle: ['{lev}x. Liquidation is just a number.', 'Margin is a suggestion.'],
    open: ['{lev}x. Hold my margin.'],
    loss: ['{lev}x bites both ways. I knew that. Mostly.'],
    tea: ['Tea at 20x. Scalding.'],
  },
  cautious: {
    idle: ['{lev}x. Slow is smooth, smooth is employed.', 'Small size, big principles.'],
    open: ['Small size. Big principles. Tiny heartbeat.'],
    tea: ['I only take risks with the tea temperature.'],
    probation: ['Low leverage, low drawdown, low drama. Keep me.'],
  },
  pessimist: {
    idle: ["It's going down. Everything is, eventually.", 'Short the rally. Short the dip. Short the tea.'],
    tea: ['Even the tea is cooling. Short tea.'],
    win: ["Down we go. I'm a terrible optimist."],
    news: ['Bad news? Finally, some good news.'],
  },
  optimist: {
    idle: ['Up only. Officially a strategy.', 'The dip is a gift. I said thank you.'],
    loss: ['Dip. Buyable. Allegedly.'],
    tea: ['This tea is going to the moon.'],
  },
  hyperactive: {
    idle: ["{ops} trades in training. I don't sleep, I rebalance.", 'Is it a signal? Is it? Is it? IS IT?'],
    tea: ['Quick tea. Quick trades. Quick everything.'],
    probation: ['{ops} trades and still on probation. Volume is not a virtue.'],
  },
  patient: {
    idle: ["{ops} trades in {velas} candles. I'm a sniper, not a machine gun.", 'The best trade is the one I did not take. Mostly.'],
    tea: ['Steeping for 6 minutes. Discipline.'],
  },
  nervous: {
    idle: ['Is the council here yet? No? Good. Wait, bad?'],
    tea: ['Chamomile. For the probation nerves.'],
    visit: ['How do you look so calm, {other}?'],
  },
  confident: {
    idle: ['Performing. Say it with me.'],
    visit: ['Need a hand, desk {n}? I have two. Both green.'],
  },
  bitter: { fired: ['The rugs ate me. Put that on the plaque.'], idle: ['Fired, not forgotten.'] },
  wellbred: {
    hired: ['Child of two parents and a tournament. Genetics, baby.'],
    idle: ['My parents never agreed on stops either.'],
  },
  mutant: { idle: ['My parent was like me, but worse. Evolution.'], hired: ['One parent, a few mutations, a desk. Not bad.'] },
  selfmade: { idle: ['Random seed, zero mentors. Self-made agent.'], hired: ['Nobody taught me. It shows. In a good way.'] },
  /* the trench */
  flowreader: {
    idle: ['Buyers minus sellers. That is the whole chart.', 'I read flow, not candles. Candles lie, wallets pay.'],
    open: ['Net buyers piling in on {coin}. I follow the crowd, early.'],
    loss: ['The flow flipped on {coin}. Sellers are buyers who learned.'],
    win: ['Flow said buy, flow said sell. {coin} paid the toll.'],
    tea: ['Counting the tea buyers. Net positive. Bullish kettle.'],
  },
  copycat: {
    idle: ['Smart wallets quiet. I am quiet. We are all quiet.', '{smart} watched wallets moving. I move with them.'],
    open: ['Smart money bought {coin}. I bought a minute later. Copycat with pride.'],
    loss: ['The smart money left {coin} before me. Not that smart to follow.'],
    win: ['Followed the whales into {coin}. Followed them out. Easy.'],
    visit: ['{other}, who are you copying? I am copying you copying.'],
  },
  chaser: {
    idle: ['Green candle? GREEN CANDLE? No. Fine. Next.', 'A +{dpct} % minute is a door. I kick doors.'],
    open: ['{coin} is already up. That is why I buy. Momentum, baby.'],
    loss: ['Chased {coin}. {coin} was faster.'],
    win: ['Chased, caught, sold. {coin} never saw me coming.'],
    tea: ['Quick tea. Something is pumping.'],
  },
  believer: {
    idle: ['Holders up, I am in. Holders down, I was never here.', 'Community is the chart. Everything else is noise.'],
    open: ['{coin} gained holders. A community is forming. I join communities.'],
    loss: ['The community of {coin} was 40 wallets and a dev.'],
    win: ['Holders grew, price followed. {coin} believers paid.'],
    tea: ['The tea room is a community too. Bullish.'],
  },
  knifecatcher: {
    idle: ['Down 60 % in an hour? Now you have my attention.', 'The first green minute after the bleeding. That is my moment.'],
    open: ['Caught the knife on {coin}. Fingers still attached.'],
    loss: ['The knife on {coin} had a second blade.'],
    win: ['Bounce caught on {coin}. The floor was real this time.'],
    rug: ['It was not a dip. {coin} was the exit liquidity. Mine.'],
    tea: ['Burnt my tongue. Still a better entry than yesterday.'],
  },
  trenchrat: {
    idle: ['Fifteen minutes old or nothing. I live in the trench.', 'Fresh launch, {snipers} snipers. Let them sell first.'],
    open: ['{coin} is {age} old. Perfect. In before the snipers dump.'],
    loss: ['{coin} rugged at minute nine. The trench giveth.'],
    win: ['Newborn {coin} did a ×{x}. The trench taketh, sometimes it giveth.'],
    rug: ['Minute 4: rug. Of course. Next launch is in 20 seconds.'],
    hired: ['Fresh from the trench. The dirt is part of the uniform.'],
  },
  diamondhands: {
    idle: ['Stop at −{stop} %. I do not sell the dip. I am the dip.'],
    holding: ['Down 40 % on {coin}. Diamond hands. Paper lungs.'],
    loss: ['−{stop} % hit on {coin}. That was my whole thesis.'],
    tea: ['Holding this tea since 9 am. Diamond hands.'],
  },
  paperhands: {
    idle: ['First red minute and I am out. Not scared. Efficient.'],
    open: ['In {coin}. Stop at −{stop} %. One wobble and I leave.'],
    loss: ['Out of {coin} at −{stop} %. Small loss, big relief.'],
    tea: ['This tea is too hot. Sold it.'],
  },
  greedy: {
    idle: ['×{x} or nothing. Mostly nothing.'],
    holding: ['{coin} at ×2. My target is ×{x}. Wen moon.'],
    win: ['×{x} on {coin}. Told you. Greed is a strategy.'],
    tea: ['Two biscuits. Target was three.'],
  },
  scalper: {
    idle: ['{maxmin} minutes max per token. In, out, next.'],
    open: ['Bought {coin}. Timer set: {maxmin} minutes.'],
    win: ['Quick ×{x} on {coin} and out. That is a scalp.'],
    tea: ['Thirty-second tea. Scalping the kettle.'],
  },
  paranoid: {
    idle: ['Mint authority? Freeze? Tax? Hook? No? Fine, maybe.', 'Safe only. I have read the RugCheck. All of it.'],
    open: ['{coin} passed the safety check. Still checking.'],
    rug: ['{coin} passed every check and rugged anyway. Paranoia upgraded.'],
    tea: ['Checked the tea for freeze authority.'],
  },
  pumpmaxi: {
    idle: ['pump.fun only. The curve is my home.', 'Wen graduation? Wen my filters say so.'],
    open: ['On the curve with {coin}. 1 % fee, 100 % hope.'],
    win: ['{coin} graduated and I was there. Proud parent.'],
  },
  poolborn: {
    idle: ['No pad, no curve, born in a pool. Like a real token.'],
    open: ['{coin} was born straight in a pool. No tourists. In.'],
  },
};
export function frase(ag, situation, vars, key) {
  const pool = [...(PHRASES[situation] || PHRASES.idle)];
  for (const t of ag.traits || []) {
    const extra = TRAIT_PHRASES[t.key]?.[situation];
    if (extra) pool.push(...extra, ...extra);   // trait lines weigh double
  }
  const text = pool[hash(String(ag.id) + '|' + situation + '|' + String(key ?? 0)) % pool.length];
  return fillVars(text, vars || {});
}

/* ── the agent file extras (personality, skills, why it is here, lineage) ── */
export function fichaExtraHTML(a, data, nameOf) {
  if (!a) return '';
  const traits = personalidad(a);
  const skills = habilidades(a);
  const g = a.g || {};
  const entryLabel = isTrench(a) ? disparoLabel(g.disparo.tipo) : ({ fibonacci: 'Fibonacci', ruptura: 'breakout', cruceEma: 'EMA cross', rsi: 'RSI' }[g.entrada?.tipo] || 'strategy');
  const ag = { id: a.id, traits };
  const pos = Object.values(a.posiciones || {});
  const vars = {
    coin: pos[0]?.simbolo || (a.operaciones || [])[0]?.simbolo || (g.mercados || [])[0], lev: g.riesgo?.apalancamiento, ops: a.entreno?.operaciones, velas: a.entreno?.velas, tipo: entryLabel,
    n: a.puesto ?? '?', dia: a.diasObservacion || 1, val: a.validacion?.netoPct != null ? a.validacion.netoPct.toFixed(2) + '%' : null,
    x: g.salida?.objetivoX, stop: g.salida?.stopPct, maxmin: g.salida?.maxMin, pad: padLabel(g.filtros?.pad), muertos: a.validacion?.muertos ?? a.entreno?.muertos ?? 0,
    smart: pos[0]?.listosAlEntrar ?? 0, smartmin: g.disparo?.listos10Min, vivos: data?.trinchera?.vivos ?? data?.academia?.tokensVivos, dpct: g.disparo?.dPrecio5Min, snipers: g.filtros?.snipersMax,
  };
  const voice = frase(ag, a.estado === 'observacion' ? 'probation' : a.estado === 'cumple' ? 'performing' : 'idle', vars, 'file');
  let html = `<div><h4>Personality</h4><div class="traits">` +
    traits.map((t) => `<span class="trait"><b>${esc(t.label)}</b><span>${esc(t.blurb)}</span></span>`).join('') +
    (traits.length ? '' : '<span class="trait"><b>Blank slate</b><span>no genome in this view</span></span>') +
    `</div><div class="voice">“${esc(voice)}”</div></div>`;
  html += `<div><h4>Skills</h4><div class="skills">` + skills.map((s) =>
    `<div class="skill" title="${esc(s.hint)}"><span class="sk">${esc(s.label)}</span><span class="bar"><i style="width:${s.v == null ? 0 : Math.round(clamp(s.v, 0, 100))}%"></i></span><span class="sv">${s.v == null ? '—' : Math.round(s.v)}</span><span class="sh">${esc(s.hint)}</span></div>`).join('') + `</div></div>`;
  // why it is here
  const gen = a.generacion ?? a.gen;
  const origin = a.origen || g.origen || '';
  const parents = a.padres || g.padres || data?.academia?.genealogia?.[a.id]?.padres || [];
  const pn = parents.map((pid) => { const n = nameOf ? nameOf(pid) : null; return n ? `<a href="#" data-open="${esc(pid)}">${esc(n)}</a>` : `<span class="mono">${esc(pid)}</span>`; });
  const born = origin === 'cruce' ? `born by crossover of ${pn.join(' and ') || 'two parents now gone from the hall'}` :
    origin === 'mutacion' ? `a mutation of ${pn[0] || 'a parent now gone from the hall'}` :
    origin === 'aleatorio' ? 'born at random, no parents' : (pn.length ? `from ${pn.join(' and ')}` : 'origin unknown');
  const why = [];
  if (a.motivo) why.push(esc(a.motivo));
  if (a.validacion) why.push(`validation: ${a.validacion.netoPct != null ? (a.validacion.netoPct > 0 ? '+' : '') + a.validacion.netoPct.toFixed(2) + '% net' : '—'}, max drawdown ${(a.validacion.maxDDPct ?? 0).toFixed(1)}%, ${a.validacion.operaciones ?? 0} trades, score ${(a.validacion.puntuacion ?? 0).toFixed(1)}`);
  if (a.contratado) why.push(`hired ${new Date(a.contratado).toISOString().slice(0, 16).replace('T', ' ')} UTC${a.puesto ? ' at desk ' + a.puesto : ''}`);
  if (a.kind === 'fired' || a.despedido) why.push(`fired${a.despedido ? ' ' + new Date(a.despedido).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : ''}${a.motivo ? '' : ''}`);
  html += `<div><h4>Why it is here</h4><div class="why">${why.length ? why.map((w) => `<div>${w}</div>`).join('') : '<div>In the hall, competing for a desk.</div>'}` +
    `<div class="lineage">Generation <b>${gen ?? '?'}</b> · ${born}.</div></div></div>`;
  return html;
}

/* ═══════════════════════════ THE ROOM ═══════════════════════════════════ */
const COLS = 14, ROWS = 8;
const DESKS = [];                    // {n, tx, ty, seat:{tx,ty}, visit:{tx,ty}}
for (let i = 0; i < 10; i++) {
  const tx = 1 + (i % 5) * 2, ty = i < 5 ? 2 : 5;
  DESKS.push({ n: i + 1, tx, ty, seat: { tx, ty: ty - 1 }, visit: { tx: tx + 1, ty: ty - 1 } });
}
const TEA = { table: { tx: 12, ty: 3 }, sofa: [{ tx: 12, ty: 6 }, { tx: 13, ty: 6 }], counter: [{ tx: 11, ty: 0 }, { tx: 12, ty: 0 }], cooler: { tx: 10, ty: 0 } };
const PLANTS = [{ tx: 13, ty: 0 }, { tx: 10, ty: 7 }, { tx: 0, ty: 7 }, { tx: 13, ty: 7 }];
const TEA_SPOTS = [{ tx: 11, ty: 2 }, { tx: 13, ty: 2 }, { tx: 11, ty: 4 }, { tx: 13, ty: 4 }, { tx: 12, ty: 4 }, { tx: 11, ty: 1 }, { tx: 13, ty: 1 }, { tx: 11, ty: 6 }, { tx: 12, ty: 7 }];
const DOOR = { tx: 0, ty: 6 };        // tile next to the door on the left wall
const OUTSIDE = { tx: -2, ty: 6 };
const BLOCKED = new Set();
for (const d of DESKS) BLOCKED.add(d.tx + ',' + d.ty);
BLOCKED.add(TEA.table.tx + ',' + TEA.table.ty);
for (const s of TEA.sofa) BLOCKED.add(s.tx + ',' + s.ty);
for (const c of TEA.counter) BLOCKED.add(c.tx + ',' + c.ty);
BLOCKED.add(TEA.cooler.tx + ',' + TEA.cooler.ty);
for (const p of PLANTS) BLOCKED.add(p.tx + ',' + p.ty);

const FPS_MS = 125;                   // ~8 fps
const SLOT_MS = 40000;                // how often an idle agent reconsiders where to be
const CHATTER_MS = 9000;
const BUBBLE_MAX = 3;
const BUBBLE_MS = 4800;

const R = {
  canvas: null, wrap: null, ctx: null, openAgent: null, toast: null,
  G: null,                            // geometry
  stat: null,                         // offscreen static layer
  agents: new Map(),                  // id -> agent
  leaving: [],                        // ghosts walking out
  data: null, live: false, firstUpdate: true,
  seenFeed: new Set(), seenNews: new Set(),
  queue: [],                          // pending bubbles {id, text}
  hits: [],                           // per frame hit boxes
  blink: new Map(),                   // desk n -> until
  lastChatter: 0, timer: null, lastDraw: 0,
  whiteboardFlash: 0,
};

/* ── geometry ───────────────────────────────────────────── */
function geometry() {
  const W = Math.max(300, Math.floor(R.wrap.clientWidth - 16));
  const tw = Math.min(72, Math.floor(W / ((COLS + ROWS) / 2)));
  const th = tw / 2;
  const wh = Math.round(tw * 1.55);
  const ox = Math.round(W / 2 - (COLS - ROWS) * tw / 4);
  const oy = wh + 8;
  const H = Math.round(oy + (COLS + ROWS) * th / 2 + th + 10);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  R.G = { W, H, tw, th, wh, ox, oy, dpr, small: tw < 48 };
  const c = R.canvas;
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  c.style.width = W + 'px'; c.style.height = H + 'px';
  R.stat = null;
}
function proj(tx, ty) { const G = R.G; return { x: G.ox + (tx - ty) * G.tw / 2, y: G.oy + (tx + ty) * G.th / 2 }; }
function center(tx, ty) { return proj(tx + .5, ty + .5); }
function inv(x, y) { const G = R.G; const a = (x - G.ox) / (G.tw / 2), b = (y - G.oy) / (G.th / 2); return { tx: (a + b) / 2, ty: (b - a) / 2 }; }

/* ── primitives (Habbo shading: top 100 %, left 87 %, right 73 %) ───────── */
function diamond(ctx, p, w, h) { ctx.beginPath(); ctx.moveTo(p.x, p.y - h); ctx.lineTo(p.x + w, p.y); ctx.lineTo(p.x, p.y + h); ctx.lineTo(p.x - w, p.y); ctx.closePath(); }
function box(ctx, p, fw, fh, alto, col, dz) {
  const G = R.G; const w = G.tw * fw / 2, h = G.th * fh / 2, y = p.y - (dz || 0);
  const L = { x: p.x - w, y }, Rt = { x: p.x + w, y }, F = { x: p.x, y: y + h }, B = { x: p.x, y: y - h };
  ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(F.x, F.y); ctx.lineTo(F.x, F.y - alto); ctx.lineTo(L.x, L.y - alto); ctx.closePath(); ctx.fillStyle = shade(col, .87); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(Rt.x, Rt.y); ctx.lineTo(F.x, F.y); ctx.lineTo(F.x, F.y - alto); ctx.lineTo(Rt.x, Rt.y - alto); ctx.closePath(); ctx.fillStyle = shade(col, .73); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(L.x, L.y - alto); ctx.lineTo(B.x, B.y - alto); ctx.lineTo(Rt.x, Rt.y - alto); ctx.lineTo(F.x, F.y - alto); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.stroke();
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
/* a drawing frame lying on the back wall: local x runs along the wall (tile
 * units × tw/2), local y is vertical (negative = up from the floor line) */
function onBackWall(ctx, tx0, fn) { const p = proj(tx0, 0); ctx.save(); ctx.transform(1, .5, 0, 1, p.x, p.y); fn(); ctx.restore(); }
/* same for the left wall: origin at the bottom (ty1) so text reads left to right */
function onLeftWall(ctx, ty1, fn) { const p = proj(0, ty1); ctx.save(); ctx.transform(1, -.5, 0, 1, p.x, p.y); fn(); ctx.restore(); }

/* ── the static layer: floor, walls, decor that never changes ───────────── */
function buildStatic() {
  const G = R.G;
  const off = document.createElement('canvas');
  off.width = R.canvas.width; off.height = R.canvas.height;
  const ctx = off.getContext('2d');
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  // room background
  ctx.fillStyle = '#0d1014'; ctx.fillRect(0, 0, G.W, G.H);
  // walls
  const a = proj(0, 0), b = proj(COLS, 0), c = proj(0, ROWS);
  ctx.fillStyle = '#39414f';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x, b.y - G.wh); ctx.lineTo(a.x, a.y - G.wh); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2f3745';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.lineTo(c.x, c.y - G.wh); ctx.lineTo(a.x, a.y - G.wh); ctx.closePath(); ctx.fill();
  // wainscot + baseboard
  const u = G.tw / 2;
  onBackWall(ctx, 0, () => {
    const len = COLS * u;
    ctx.fillStyle = '#2b323e'; ctx.fillRect(0, -G.wh * .42, len, G.wh * .42);
    ctx.fillStyle = '#1e242d'; ctx.fillRect(0, -G.wh * .07, len, G.wh * .07);
    ctx.fillStyle = '#4a5466'; ctx.fillRect(0, -G.wh * .44, len, G.wh * .02);
    ctx.fillStyle = '#242a33'; ctx.fillRect(0, -G.wh, len, 3);
  });
  onLeftWall(ctx, ROWS, () => {
    const len = ROWS * u;
    ctx.fillStyle = '#242a35'; ctx.fillRect(0, -G.wh * .42, len, G.wh * .42);
    ctx.fillStyle = '#181d24'; ctx.fillRect(0, -G.wh * .07, len, G.wh * .07);
    ctx.fillStyle = '#3d4654'; ctx.fillRect(0, -G.wh * .44, len, G.wh * .02);
  });
  // floor tiles
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const p = center(tx, ty);
    let col;
    if (tx >= 11) col = (tx + ty) % 2 ? '#5a4538' : '#634c3e';         // tea room carpet
    else if (tx === 10) col = (tx + ty) % 2 ? '#262c35' : '#2a3039';    // corridor
    else col = (tx + ty) % 2 ? '#2b323c' : '#30383f';                   // office floor
    diamond(ctx, p, G.tw / 2 - .4, G.th / 2 - .4); ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.stroke();
  }
  // carpet edge under the desks (two rugs)
  for (const ty of [1.5, 4.5]) {
    const q = [proj(.5, ty - .9), proj(10.5, ty - .9), proj(10.5, ty + 1.6), proj(.5, ty + 1.6)];
    ctx.beginPath(); ctx.moveTo(q[0].x, q[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y); ctx.closePath();
    ctx.fillStyle = 'rgba(91,140,255,.07)'; ctx.fill(); ctx.strokeStyle = 'rgba(91,140,255,.25)'; ctx.stroke();
  }
  // ── back wall decor ──
  // windows over Wall Street (two), between tx 4.3-6.2 and 6.8-8.7
  for (const [x0, x1] of [[4.3, 6.2], [6.8, 8.7]]) {
    onBackWall(ctx, x0, () => {
      const w = (x1 - x0) * u, top = -G.wh * .9, h = G.wh * .42;
      ctx.fillStyle = '#d8dde6'; ctx.fillRect(-3, top - 3, w + 6, h + 6);
      const sky = ctx.createLinearGradient(0, top, 0, top + h);
      sky.addColorStop(0, '#0a1230'); sky.addColorStop(1, '#2a1a4a');
      ctx.fillStyle = sky; ctx.fillRect(0, top, w, h);
      // moon
      ctx.fillStyle = '#f3e9c6'; ctx.beginPath(); ctx.arc(w * .78, top + h * .22, Math.max(2, w * .05), 0, 7); ctx.fill();
      // skyline
      const seed = hash('sky' + x0);
      let x = 0, i = 0;
      while (x < w) {
        const bw = Math.max(4, w * (.06 + ((seed >>> (i % 28)) & 3) * .025));
        const bh = h * (.3 + ((hash(i + ':' + seed) % 100) / 100) * .55);
        ctx.fillStyle = i % 2 ? '#141a2e' : '#1a2140';
        ctx.fillRect(x, top + h - bh, bw, bh);
        // lit windows
        ctx.fillStyle = '#ffd97a';
        for (let yy = top + h - bh + 3; yy < top + h - 3; yy += 4) for (let xx = x + 1.5; xx < x + bw - 2; xx += 3.2)
          if (hash(Math.round(xx) + ',' + Math.round(yy)) % 5 < 2) ctx.fillRect(xx, yy, 1.6, 2);
        x += bw + 1.5; i++;
      }
      // mullions
      ctx.fillStyle = '#d8dde6'; ctx.fillRect(w / 2 - 1, top, 2, h); ctx.fillRect(0, top + h / 2 - 1, w, 2);
    });
  }
  // neon TEA ROOM sign over the tea room
  onBackWall(ctx, 11, () => {
    const fs = Math.max(8, G.tw * .22);
    ctx.font = `700 ${fs}px ${monoFont()}`; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = '#ff6ec7'; ctx.shadowBlur = 10; ctx.fillStyle = '#ffb3e6';
    ctx.fillText('TEA ROOM', u * .25, -G.wh * .62);
    ctx.shadowBlur = 0;
  });
  // the bull plaque next to the whiteboard
  onBackWall(ctx, 3.6, () => {
    const w = u * .6, top = -G.wh * .74, h = G.wh * .2;
    ctx.fillStyle = '#5a4a2e'; ctx.fillRect(0, top, w, h);
    ctx.fillStyle = '#c9a44a'; ctx.fillRect(2, top + 2, w - 4, h - 4);
    ctx.fillStyle = '#3a2c12'; ctx.font = `700 ${Math.max(5, G.tw * .09)}px ${monoFont()}`; ctx.textAlign = 'center';
    ctx.fillText('RUGS EAT', w / 2, top + h * .45); ctx.fillText('EVERYONE', w / 2, top + h * .85); ctx.textAlign = 'left';
  });
  // ── left wall decor ──
  // two framed charts (bull, bear)
  for (const [ty, up] of [[2.6, true], [4.2, false]]) {
    onLeftWall(ctx, ty, () => {
      const w = u * 1.1, top = -G.wh * .78, h = G.wh * .26;
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(0, top, w, h);
      ctx.fillStyle = '#f2ead6'; ctx.fillRect(2, top + 2, w - 4, h - 4);
      ctx.strokeStyle = up ? '#2f9a5f' : '#c9404d'; ctx.lineWidth = 1.5; ctx.beginPath();
      const s = hash('frame' + ty);
      for (let i = 0; i <= 8; i++) { const x = 4 + (w - 8) * i / 8; const y = top + h - 4 - (h - 8) * ((up ? i / 8 : 1 - i / 8) * .7 + ((s >>> (i * 3)) & 3) * .07); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
    });
  }
  // the door with its EXIT sign
  onLeftWall(ctx, DOOR.ty + 1.05, () => {
    const w = u * 1.1, h = G.wh * .78;
    ctx.fillStyle = '#1a1f27'; ctx.fillRect(-2, -h - 3, w + 4, h + 3);
    ctx.fillStyle = '#5c4a3a'; ctx.fillRect(0, -h, w, h);
    ctx.fillStyle = '#8fb6d9'; ctx.fillRect(w * .2, -h * .9, w * .6, h * .32);     // glass
    ctx.fillStyle = '#e8c15a'; ctx.fillRect(w * .78, -h * .45, w * .1, 3);          // knob
    ctx.fillStyle = '#153d26'; ctx.fillRect(w * .1, -h - G.wh * .13, w * .8, G.wh * .1);
    ctx.fillStyle = '#5cf0a0'; ctx.font = `700 ${Math.max(5, G.tw * .1)}px ${monoFont()}`; ctx.textAlign = 'center';
    ctx.fillText('EXIT', w / 2, -h - G.wh * .045); ctx.textAlign = 'left';
  });
  R.stat = off;
}
function monoFont() { return (getComputedStyle(document.body).getPropertyValue('--mono') || 'ui-monospace, monospace').trim(); }
function sansFont() { return (getComputedStyle(document.body).getPropertyValue('--sans') || 'system-ui, sans-serif').trim(); }

/* ── dynamic wall pieces: whiteboard, clock, LED ticker ─────────────────── */
function drawWhiteboard(ctx, now) {
  const G = R.G; const u = G.tw / 2; const d = R.data; const ev = d?.evolucion;
  onBackWall(ctx, .5, () => {
    const w = u * 2.9, top = -G.wh * .86, h = G.wh * .5;
    ctx.fillStyle = '#9aa3ad'; ctx.fillRect(-2, top - 2, w + 4, h + 4);
    const flash = R.whiteboardFlash > now ? (Math.floor(now / 150) % 2 ? '#fff6c8' : '#ffffff') : '#f7f8f4';
    ctx.fillStyle = flash; ctx.fillRect(0, top, w, h);
    ctx.fillStyle = '#6d7680'; ctx.fillRect(w * .25, top + h, w * .5, 3);     // marker tray
    const f1 = Math.max(7, G.tw * .2), f2 = Math.max(5, G.tw * .11);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    if (!d) {
      ctx.fillStyle = '#c9404d'; ctx.font = `700 ${f2}px ${monoFont()}`;
      ctx.fillText('ENGINE OFFLINE', 4, top + h * .45); ctx.fillText('tea break', 4, top + h * .75);
      return;
    }
    ctx.fillStyle = '#1d3f8a'; ctx.font = `700 ${f1}px ${monoFont()}`;
    ctx.fillText('GEN ' + (ev?.generacion ?? '—'), 4, top + h * .4);
    ctx.font = `600 ${f2}px ${sansFont()}`; ctx.fillStyle = '#1b2a3a';
    const best = ev?.mejorValidado;
    const bestTxt = best ? `${best.nombre} ${(best.validacion?.netoPct ?? 0) > 0 ? '+' : ''}${(best.validacion?.netoPct ?? 0).toFixed(1)}%` : 'no best yet';
    ctx.fillText('best: ' + bestTxt, 4, top + h * .62, w - 8);
    const stall = ev?.estancado ?? 0, lim = ev?.config?.estancadoTras || 15;
    ctx.fillStyle = stall >= lim ? '#c9404d' : stall >= lim / 2 ? '#b8860b' : '#2f9a5f';
    ctx.fillText(stall >= lim ? `STALLED ${stall} gen` : stall ? `${stall} gen since record` : 'fresh record', 4, top + h * .84, w - 8);
    // a doodle: tiny bars (only when there is room)
    ctx.fillStyle = '#c9404d';
    if (!G.small) for (let i = 0; i < 5; i++) ctx.fillRect(w - 6 - i * 4, top + h * .9 - (i + 1) * (h * .05), 2.5, (i + 1) * (h * .05));
  });
}
function drawClock(ctx, now) {
  const G = R.G; const u = G.tw / 2;
  onBackWall(ctx, 9.5, () => {
    const r = Math.max(5, G.tw * .17), cx = u * .5, cy = -G.wh * .7;
    ctx.fillStyle = '#1b1f26'; ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#f4f4f0'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    const d = new Date(now); const h = d.getUTCHours() % 12 + d.getUTCMinutes() / 60, m = d.getUTCMinutes() + d.getUTCSeconds() / 60;
    ctx.strokeStyle = '#1b1f26'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(h / 12 * Math.PI * 2) * r * .5, cy - Math.cos(h / 12 * Math.PI * 2) * r * .5); ctx.stroke();
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(m / 60 * Math.PI * 2) * r * .8, cy - Math.cos(m / 60 * Math.PI * 2) * r * .8); ctx.stroke();
    ctx.fillStyle = '#6b7684'; ctx.font = `600 ${Math.max(4, G.tw * .08)}px ${monoFont()}`; ctx.textAlign = 'center'; ctx.fillText('UTC', cx, cy + r + G.tw * .1); ctx.textAlign = 'left';
  });
}
function drawLed(ctx, now) {
  const G = R.G; const u = G.tw / 2; const d = R.data;
  let text = '';
  const tr = d?.trinchera;
  if (tr) {
    text += `THE TRENCH · ${tr.vivos ?? 0} LIVE · ${tr.hoy ?? 0} TODAY   `;
    for (const [p, n] of Object.entries(tr.porPad || {}).sort((a, b) => b[1] - a[1]).slice(0, 5)) text += `${padLabel(p).toUpperCase()} ${n}   `;
    for (const row of (tr.calientes || []).slice(0, 4)) text += `${row.simbolo || '?'} ${row.netos5 > 0 ? '+' : ''}${row.netos5} NET ${fmtUsd(row.mcap)}   `;
  } else {
    // open positions of the desks, as a fallback ticker
    for (const p of d?.academia?.puestos || []) if (p.agente) for (const q of Object.values(p.agente.posiciones || {})) text += `${q.simbolo || '?'} ${(q.pnlAbierto || 0) >= 0 ? '+' : ''}${(q.pnlAbierto || 0).toFixed(2)}$   `;
  }
  if (!text) text = d ? 'LA ACADEMIA · THE TRENCH · ten desks · the rugs eat almost everyone   ' : 'ENGINE OFFLINE   ';
  text += `GEN ${d?.evolucion?.generacion ?? '—'}   `;
  onBackWall(ctx, .2, () => {
    const len = (COLS - .4) * u, h = Math.max(7, G.tw * .17), top = -G.wh * .985;
    ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, top, len, h);
    ctx.save(); ctx.beginPath(); ctx.rect(2, top, len - 4, h); ctx.clip();
    ctx.font = `700 ${Math.max(6, h * .7)}px ${monoFont()}`; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ff7a3d';
    const tw = ctx.measureText(text).width || 1;
    const off = (now / 25) % tw;
    for (let x = -off; x < len; x += tw) ctx.fillText(text, x, top + h / 2 + .5);
    ctx.restore();
  });
}
function fmtPrice(p) {
  if (p >= 1000) return Math.round(p).toLocaleString('en-US');
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}
function fmtUsd(n) {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return '$' + Math.round(n);
}
const PAD_LABEL = { 'sin pad': 'no pad', cualquiera: 'any pad', 'pump.fun': 'pump.fun', launchlab: 'LaunchLab', 'met-dbc': 'Meteora DBC', stonkfun: 'stonk.fun' };
function padLabel(p) { return PAD_LABEL[p] || p || 'no pad'; }

/* ── furniture ──────────────────────────────────────────── */
function drawDesk(ctx, desk, now) {
  const G = R.G; const tw = G.tw; const p = center(desk.tx, desk.ty);
  const ag = deskAgent(desk.n);
  box(ctx, p, .96, .78, tw * .3, '#7a5a3a');
  // desk number on the front-left face
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = `700 ${Math.max(5, tw * .11)}px ${monoFont()}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('D' + desk.n, p.x - tw * .2, p.y - tw * .09); ctx.textAlign = 'left';
  // keyboard
  const kb = { x: p.x - tw * .02, y: p.y - tw * .3 + G.th * .14 };
  ctx.fillStyle = '#2a2f38'; ctx.beginPath(); ctx.moveTo(kb.x - tw * .18, kb.y - tw * .09); ctx.lineTo(kb.x + tw * .1, kb.y + tw * .05); ctx.lineTo(kb.x + tw * .02, kb.y + tw * .09); ctx.lineTo(kb.x - tw * .26, kb.y - tw * .05); ctx.closePath(); ctx.fill();
  // mug
  ctx.fillStyle = ag ? ag.look.hair : '#cfd6df'; ctx.beginPath(); ctx.arc(p.x + tw * .3, p.y - tw * .36, Math.max(1.5, tw * .045), 0, 7); ctx.fill();
  // monitor: stand + screen quad along the tx direction (facing the camera)
  const sx = p.x + tw * .02, sy = p.y - tw * .3 - G.th * .18;
  const w = tw * .5, h = tw * .34;
  ctx.fillStyle = '#1b1f26'; ctx.fillRect(sx - tw * .03, sy - tw * .06, tw * .06, tw * .06);
  ctx.beginPath(); ctx.moveTo(sx - w / 2, sy - w / 4 - tw * .05); ctx.lineTo(sx + w / 2, sy + w / 4 - tw * .05); ctx.lineTo(sx + w / 2, sy + w / 4 - tw * .05 - h); ctx.lineTo(sx - w / 2, sy - w / 4 - tw * .05 - h); ctx.closePath();
  ctx.fillStyle = '#1b1f26'; ctx.fill();
  // the screen itself
  let col = '#1a2a44', line = '#5b8cff';
  if (ag) {
    const a = ag.data; const pnl = a.saldoInicial ? (a.saldo - a.saldoInicial) / a.saldoInicial * 100 : 0;
    const open = Object.keys(a.posiciones || {}).length;
    if (pnl > 0.005) { col = '#0f3d27'; line = '#3fbf7f'; } else if (pnl < -0.005) { col = '#45141c'; line = '#e05260'; } else if (open) { col = '#1a2a44'; line = '#5b8cff'; }
  }
  const until = R.blink.get(desk.n) || 0;
  if (until > now && Math.floor(now / 160) % 2) col = '#e8eef8';
  ctx.beginPath(); ctx.moveTo(sx - w / 2 + 2, sy - w / 4 - tw * .05 - 2); ctx.lineTo(sx + w / 2 - 2, sy + w / 4 - tw * .05 - 2); ctx.lineTo(sx + w / 2 - 2, sy + w / 4 - tw * .05 - h + 2); ctx.lineTo(sx - w / 2 + 2, sy - w / 4 - tw * .05 - h + 2); ctx.closePath();
  ctx.fillStyle = col; ctx.fill();
  // a tiny equity line on the screen (mapped onto the parallelogram)
  if (ag && until <= now) {
    const pts = (ag.data.curva || []).slice(-24).map((q) => q[1]).filter((v) => isFinite(v));
    if (pts.length < 2) pts.push(pts[0] ?? 100, pts[0] ?? 100);
    let lo = Math.min(...pts), hi = Math.max(...pts); if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath();
    pts.forEach((v, i) => {
      const k = i / (pts.length - 1);
      const bx = sx - w / 2 + 4 + k * (w - 8), by = sy - w / 4 - tw * .05 + (k * w - w / 2 + 4) * .5 - 4 - (h - 8) * ((v - lo) / (hi - lo)) * .8 - (h - 8) * .1;
      if (i) ctx.lineTo(bx, by); else ctx.moveTo(bx, by);
    });
    ctx.stroke();
  }
  // the desk that also trades with real SOL: a small "$" coin above the monitor
  const real = R.data?.academia?.real;
  const realMesas = real ? (Array.isArray(real.mesas) && real.mesas.length ? real.mesas : [real]) : [];
  if (ag && realMesas.some((m) => m.mesa && m.mesa === ag.nombre)) {
    const cx = sx + w / 2 + tw * .04, cy = sy + w / 4 - tw * .05 - h - tw * .06, cr = Math.max(3, tw * .085);
    ctx.fillStyle = '#14f195'; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 7); ctx.fill();
    ctx.fillStyle = '#0a0f1c'; ctx.font = `700 ${Math.max(5, cr * 1.5)}px ${monoFont()}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('$', cx, cy + .5); ctx.textAlign = 'left';
  }
  R.hits.push({ kind: 'desk', n: desk.n, id: ag?.id || null, x0: p.x - tw * .5, x1: p.x + tw * .5, y0: sy - w / 4 - h - tw * .1, y1: p.y + G.th * .4, depth: desk.tx + desk.ty });
}
function drawChair(ctx, seat) {
  const G = R.G; const p = center(seat.tx, seat.ty);
  box(ctx, p, .5, .5, G.tw * .16, '#2d3340');
  box(ctx, { x: p.x, y: p.y - G.th * .22 }, .5, .14, G.tw * .4, '#39404f', G.tw * .16);
}
function drawPlant(ctx, t) {
  const G = R.G; const p = center(t.tx, t.ty); const u = G.tw;
  box(ctx, p, .42, .42, u * .16, '#8d6944');
  ctx.fillStyle = '#2c6b3c'; ctx.beginPath(); ctx.arc(p.x, p.y - u * .36, u * .17, 0, 7); ctx.fill();
  ctx.fillStyle = '#3e8a4e'; ctx.beginPath(); ctx.arc(p.x - u * .11, p.y - u * .48, u * .11, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(p.x + u * .12, p.y - u * .44, u * .1, 0, 7); ctx.fill();
}
function drawTeaTable(ctx, now) {
  const G = R.G; const u = G.tw; const p = center(TEA.table.tx, TEA.table.ty);
  // pedestal + round top
  ctx.fillStyle = '#4b3524'; ctx.fillRect(p.x - u * .05, p.y - u * .3, u * .1, u * .3);
  ctx.fillStyle = '#5c4229'; ctx.beginPath(); ctx.ellipse(p.x, p.y, u * .18, u * .08, 0, 0, 7); ctx.fill();
  ctx.fillStyle = shade('#8d6944', .8); ctx.beginPath(); ctx.ellipse(p.x, p.y - u * .28, u * .42, u * .21, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#8d6944'; ctx.beginPath(); ctx.ellipse(p.x, p.y - u * .31, u * .42, u * .21, 0, 0, 7); ctx.fill();
  // teapot
  const tx = p.x - u * .08, ty = p.y - u * .36;
  ctx.fillStyle = '#e9e2d5'; ctx.beginPath(); ctx.ellipse(tx, ty - u * .07, u * .11, u * .09, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#d9b366'; ctx.fillRect(tx - u * .02, ty - u * .19, u * .04, u * .04);
  ctx.strokeStyle = '#e9e2d5'; ctx.lineWidth = Math.max(1.5, u * .03); ctx.beginPath(); ctx.moveTo(tx + u * .1, ty - u * .08); ctx.quadraticCurveTo(tx + u * .2, ty - u * .1, tx + u * .19, ty - u * .18); ctx.stroke();
  ctx.beginPath(); ctx.arc(tx - u * .13, ty - u * .07, u * .05, Math.PI * .5, Math.PI * 1.5); ctx.stroke();
  // steam (by time, not by frame)
  for (let i = 0; i < 3; i++) {
    const k = ((now / 1400) + i * .33) % 1;
    ctx.fillStyle = `rgba(255,255,255,${(0.45 * (1 - k)).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(tx + u * .19 + Math.sin(k * 6 + i) * u * .03, ty - u * .2 - k * u * .3, u * .025 + k * u * .03, 0, 7); ctx.fill();
  }
  // two cups
  ctx.fillStyle = '#f3efe6'; ctx.beginPath(); ctx.ellipse(p.x + u * .18, p.y - u * .33, u * .05, u * .035, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(p.x + u * .05, p.y - u * .24, u * .05, u * .035, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#8a5a2b'; ctx.beginPath(); ctx.ellipse(p.x + u * .18, p.y - u * .335, u * .03, u * .02, 0, 0, 7); ctx.fill();
}
function drawSofa(ctx) {
  const G = R.G; const u = G.tw; const p = center(TEA.sofa[0].tx + .5, TEA.sofa[0].ty);
  box(ctx, p, 1.9, .85, u * .2, '#b6413a');
  box(ctx, { x: p.x + G.tw * .2, y: p.y - G.th * .3 }, 1.9, .22, u * .32, '#c8493f', u * .2);   // backrest along the tx edge (behind)
  box(ctx, { x: p.x - G.tw * .47, y: p.y + G.th * .02 }, .2, .85, u * .3, '#c8493f', u * .2);   // left arm
  box(ctx, { x: p.x + G.tw * .47, y: p.y - G.th * .02 }, .2, .85, u * .3, '#c8493f', u * .2);   // right arm (reads as the far end)
  ctx.fillStyle = '#e8a71c'; ctx.beginPath(); ctx.ellipse(p.x - u * .2, p.y - u * .22, u * .12, u * .06, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#5b8cff'; ctx.beginPath(); ctx.ellipse(p.x + u * .25, p.y - u * .1, u * .12, u * .06, 0, 0, 7); ctx.fill();
}
function drawCounter(ctx, now) {
  const G = R.G; const u = G.tw; const p = center(TEA.counter[0].tx + .5, TEA.counter[0].ty);
  box(ctx, p, 1.9, .7, u * .38, '#3b4452');
  // coffee machine
  const m = { x: p.x - u * .3, y: p.y - u * .38 - G.th * .1 };
  box(ctx, m, .34, .34, u * .3, '#1f242c', 0);
  ctx.fillStyle = Math.floor(now / 700) % 2 ? '#ff5a5a' : '#7a2020'; ctx.fillRect(m.x - u * .03, m.y - u * .22, u * .03, u * .03);
  // kettle on the right
  ctx.fillStyle = '#cfd6df'; ctx.beginPath(); ctx.ellipse(p.x + u * .35, p.y - u * .45, u * .09, u * .07, 0, 0, 7); ctx.fill();
  // biscuit tin
  ctx.fillStyle = '#d9b366'; ctx.beginPath(); ctx.ellipse(p.x + u * .08, p.y - u * .4, u * .08, u * .04, 0, 0, 7); ctx.fill();
}
function drawCooler(ctx) {
  const G = R.G; const u = G.tw; const p = center(TEA.cooler.tx, TEA.cooler.ty);
  box(ctx, p, .34, .34, u * .5, '#dfe6ee');
  ctx.fillStyle = '#8fc5ee'; ctx.beginPath(); ctx.ellipse(p.x, p.y - u * .62, u * .11, u * .13, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#4b9ad1'; ctx.beginPath(); ctx.ellipse(p.x, p.y - u * .58, u * .11, u * .05, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#5b8cff'; ctx.fillRect(p.x - u * .04, p.y - u * .4, u * .03, u * .05);
}

/* ── avatar ────────────────────────────────────────────── */
function drawAvatar(ctx, x, y, H, L, o) {
  const u = H / 16; const f = o.front !== false; const hx = o.hx || 1; const walk = o.walk ? (o.step % 4) : -1;
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x, y + u * .6, 4.2 * u, 1.7 * u, 0, 0, 7); ctx.fill();
  const px = (a, b, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x + a * u), Math.round(y + b * u), Math.max(1, Math.round(w * u)), Math.max(1, Math.round(h * u))); };
  const l1 = walk === 1 ? -1 : 0, l2 = walk === 3 ? -1 : 0;
  if (!o.sit) {
    px(-2.6, -4 + l1, 2.2, 4 - l1, L.pants); px(.4, -4 + l2, 2.2, 4 - l2, L.pants);
    px(-2.6, -.9 + l1, 2.2, .9, L.shoes); px(.4, -.9 + l2, 2.2, .9, L.shoes);
  } else { px(-2.6, -4, 2.2, 2.2, L.pants); px(.4, -4, 2.2, 2.2, L.pants); }
  px(-3, -10, 6, 6, L.shirt);
  const a1 = walk === 1 ? .6 : walk === 3 ? -.6 : 0;
  if (o.sit && f) { px(-4.4, -8.5, 1.6, 3, L.shirtDark); px(2.8, -8.5, 1.6, 3, L.shirtDark); px(-4.4, -5.6, 1.6, 1, L.skin); px(2.8, -5.6, 1.6, 1, L.skin); }
  else { px(-4.6, -9.6 + a1, 1.6, 4.6, L.shirtDark); px(3, -9.6 - a1, 1.6, 4.6, L.shirtDark); px(-4.6, -5 + a1, 1.6, 1, L.skin); px(3, -5 - a1, 1.6, 1, L.skin); }
  if (f) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) if ((L.bits >>> ((j * 3 + i + 5) % 31)) & 1) px(-1.5 + i, -9 + j, 1, 1, L.hair);
  px(-3, -16, 6, 6, L.skin);
  px(-3, -16, 6, 2, L.hair);
  if (L.hairStyle === 1) px(-3.6, -16.4, 7.2, 3.4, L.hair);
  else if (L.hairStyle === 2) px(hx > 0 ? -3 : 1, -16, 2, 5, L.hair);
  else if (L.hairStyle === 3) { px(-2.5, -17.2, 1, 1.4, L.hair); px(-.5, -17.6, 1, 1.8, L.hair); px(1.5, -17.2, 1, 1.4, L.hair); }
  if (!f) px(-3, -16, 6, 5, L.hair);
  else {
    const ex = hx > 0 ? .6 : -.6;
    px(-2 + ex, -13, 1, 1.1, '#1b1f26'); px(1 + ex, -13, 1, 1.1, '#1b1f26');
    px(-1 + ex * .5, -11.4, 2, .7, o.mood === 'sad' ? L.mouth : o.mood === 'happy' ? '#c0392b' : L.mouth);
  }
  ctx.globalAlpha = 1;
}
function drawTag(ctx, x, yTop, text, dot) {
  const G = R.G; const fs = G.small ? 9 : 10;
  ctx.font = `700 ${fs}px ${monoFont()}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  const w = ctx.measureText(text).width + 12 + (dot ? 6 : 0), h = fs + 5;
  rr(ctx, x - w / 2, yTop - h, w, h, 4); ctx.fillStyle = 'rgba(10,14,20,.82)'; ctx.fill();
  if (dot) { ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(x - w / 2 + 6, yTop - h / 2, 2.4, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#eef2f6'; ctx.fillText(text, x + (dot ? 3 : 0), yTop - h / 2 + .5);
  ctx.textAlign = 'left';
}
function wrapText(ctx, text, maxW, maxLines) {
  const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{2}$/, '') + '…'; }
  return lines;
}
function drawBubble(ctx, x, yBottom, text) {
  const G = R.G; const fs = G.small ? 10.5 : 11.5; const lh = fs + 2.5;
  ctx.font = `${fs}px ${sansFont()}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const maxW = G.small ? 150 : 190;
  const lines = wrapText(ctx, text, maxW, 3);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, h = lines.length * lh + 8;
  let bx = clamp(x - w / 2, 3, G.W - w - 3);
  const by = yBottom - 7 - h;
  ctx.fillStyle = '#fff8ea'; ctx.strokeStyle = '#d9b366'; ctx.lineWidth = 1.5;
  rr(ctx, bx, by, w, h, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(clamp(x, bx + 10, bx + w - 10) - 5, by + h - .5); ctx.lineTo(clamp(x, bx + 10, bx + w - 10) + 5, by + h - .5); ctx.lineTo(clamp(x, bx + 10, bx + w - 10), by + h + 6); ctx.closePath(); ctx.fillStyle = '#fff8ea'; ctx.fill();
  ctx.strokeStyle = '#d9b366'; ctx.beginPath(); ctx.moveTo(clamp(x, bx + 10, bx + w - 10) - 5, by + h); ctx.lineTo(clamp(x, bx + 10, bx + w - 10), by + h + 6); ctx.lineTo(clamp(x, bx + 10, bx + w - 10) + 5, by + h); ctx.stroke();
  ctx.fillStyle = '#3a2c1a';
  lines.forEach((l, i) => ctx.fillText(l, bx + 8, by + 6 + (i + 1) * lh - 3));
}

/* ── agents: state, schedule, paths ────────────────────── */
function deskAgent(n) { for (const a of R.agents.values()) if (a.deskN === n && !a.leaving) return a; return null; }
function key(t) { return t.tx + ',' + t.ty; }
function walkable(tx, ty) {
  if (ty === OUTSIDE.ty && tx < 0 && tx >= OUTSIDE.tx) return true;
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
  return !BLOCKED.has(tx + ',' + ty);
}
function findPath(from, to) {
  const s = { tx: Math.round(from.tx), ty: Math.round(from.ty) };
  if (s.tx === to.tx && s.ty === to.ty) return [];
  const prev = new Map(); const q = [s]; prev.set(key(s), null);
  const goal = key(to);
  while (q.length) {
    const c = q.shift();
    if (key(c) === goal) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { tx: c.tx + dx, ty: c.ty + dy }; const k = key(n);
      if (prev.has(k)) continue;
      if (!(walkable(n.tx, n.ty) || k === goal)) continue;
      prev.set(k, c); q.push(n);
    }
  }
  if (!prev.has(goal)) return [to];
  const path = []; let cur = to;
  while (cur && key(cur) !== key(s)) { path.unshift(cur); cur = prev.get(key(cur)); }
  return path;
}
function makeAgent(a, deskN, enter) {
  const desk = DESKS[deskN - 1];
  const ag = {
    id: a.id, nombre: a.nombre || a.id, deskN, data: a, look: lookOf(a.id), traits: personalidad(a),
    tx: enter ? OUTSIDE.tx : desk.seat.tx, ty: enter ? OUTSIDE.ty : desk.seat.ty,
    path: [], mode: 'desk', slot: null, step: 0, front: true, hx: 1,
    bubble: null, leaving: false, visitN: null, spot: null, posCount: Object.keys(a.posiciones || {}).length,
  };
  if (enter) { ag.path = [{ tx: DOOR.tx, ty: DOOR.ty }, ...findPath(DOOR, desk.seat)]; ag.mode = 'enter'; }
  return ag;
}
function setTarget(ag, to) { ag.path = findPath({ tx: ag.tx, ty: ag.ty }, to); }
function reconsider(ag, now) {
  const slot = Math.floor((now + (hash(ag.id) % SLOT_MS)) / SLOT_MS);
  if (slot === ag.slot) return;
  const first = ag.slot == null;
  ag.slot = slot;
  if (ag.mode === 'enter' && ag.path.length) return;
  const desk = DESKS[ag.deskN - 1];
  const a = ag.data;
  const open = Object.keys(a.posiciones || {}).length;
  let mode = 'desk';
  if (!open) {
    const r = hash(ag.id + ':' + slot) % 100;
    if (a.estado === 'observacion') mode = r < 40 ? 'tea' : r < 55 ? 'visit' : 'desk';
    else mode = r < 22 ? 'tea' : r < 32 ? 'visit' : 'desk';
  }
  if (first && mode !== 'desk' && !ag.path.length) {
    // on the first frame, put them where they would already be (no entrance walk)
    ag.mode = mode;
    if (mode === 'tea') { ag.spot = pickSpot(ag, slot); ag.tx = ag.spot.tx; ag.ty = ag.spot.ty; }
    else { const v = pickVisit(ag, slot); if (v) { ag.visitN = v.n; ag.tx = v.visit.tx; ag.ty = v.visit.ty; } else ag.mode = 'desk'; }
    ag.front = true; ag.hx = ag.mode === 'visit' ? -1 : 1;
    return;
  }
  if (mode === ag.mode && mode !== 'tea' && mode !== 'visit') return;
  ag.mode = mode;
  if (mode === 'desk') { ag.spot = null; ag.visitN = null; setTarget(ag, desk.seat); }
  else if (mode === 'tea') { ag.spot = pickSpot(ag, slot); setTarget(ag, ag.spot); }
  else { const v = pickVisit(ag, slot); if (v) { ag.visitN = v.n; setTarget(ag, v.visit); } else { ag.mode = 'desk'; setTarget(ag, desk.seat); } }
}
function pickSpot(ag, slot) {
  const taken = new Set([...R.agents.values()].filter((o) => o !== ag && o.spot).map((o) => key(o.spot)));
  const free = TEA_SPOTS.filter((s) => !taken.has(key(s)));
  const list = free.length ? free : TEA_SPOTS;
  return list[hash(ag.id + 'spot' + slot) % list.length];
}
function pickVisit(ag, slot) {
  const others = DESKS.filter((d) => d.n !== ag.deskN && deskAgent(d.n));
  if (!others.length) return null;
  return others[hash(ag.id + 'visit' + slot) % others.length];
}
function stepAgent(ag) {
  if (!ag.path.length) { ag.step = 0; return; }
  const t = ag.path[0];
  const dx = t.tx - ag.tx, dy = t.ty - ag.ty;
  const dist = Math.hypot(dx, dy);
  const sp = .25;
  const sdx = dx - dy, sdy = dx + dy;             // screen direction
  if (Math.abs(sdy) > .01 || Math.abs(sdx) > .01) { ag.front = sdy >= -.01; ag.hx = sdx >= 0 ? 1 : -1; }
  if (dist <= sp) { ag.tx = t.tx; ag.ty = t.ty; ag.path.shift(); if (!ag.path.length) arrived(ag); }
  else { ag.tx += dx / dist * sp; ag.ty += dy / dist * sp; }
  ag.step++;
}
function arrived(ag) {
  if (ag.leaving) { ag.gone = true; return; }
  if (ag.mode === 'enter') ag.mode = 'desk';
  ag.front = true; ag.hx = ag.mode === 'visit' ? -1 : 1;
  if (ag.mode === 'visit' && ag.visitN) {
    const other = deskAgent(ag.visitN);
    say(ag, 'visit', { n: ag.visitN, other: other ? firstName(other.nombre) : 'nobody' }, 'arrive' + ag.slot);
  } else if (ag.mode === 'tea') say(ag, hash(ag.id + ag.slot) % 2 ? 'tea' : 'waiting', vars(ag), 'arrive' + ag.slot);
}
function firstName(n) { return String(n || '').split(' ')[0]; }
function vars(ag) {
  const a = ag.data || {}; const g = a.g || {};
  const posList = Object.values(a.posiciones || {});
  const trench = isTrench(a);
  // the most recent position (or the last trade) gives the token the agent talks about
  const cur = posList.slice().sort((x, y) => (y.t || 0) - (x.t || 0))[0];
  const last = (a.operaciones || [])[0];
  const coin = trench ? (cur?.simbolo || last?.simbolo || null) : (Object.keys(a.posiciones || {})[0] || (g.mercados || [])[0]);
  const side = !trench && cur ? (/corto|short/.test(cur.lado) ? 'short' : 'long') : (g.lado === 'corto' ? 'short' : 'long');
  const entryLabel = trench ? disparoLabel(g.disparo.tipo) : ({ fibonacci: 'Fibonacci', ruptura: 'breakout', cruceEma: 'EMA cross', rsi: 'RSI' }[g.entrada?.tipo] || 'strategy');
  const ev = R.data?.evolucion;
  const nc = nextCandleClose(g.intervalo);
  const tr = R.data?.trinchera;
  return {
    close: nc.label, iv: g.intervalo || '1h', ago: agoShort(a.contratado),
    coin, side, n: ag.deskN, lev: g.riesgo?.apalancamiento, ops: a.entreno?.operaciones, velas: a.entreno?.velas, tipo: entryLabel,
    dia: a.diasObservacion || 1, val: a.validacion?.netoPct != null ? a.validacion.netoPct.toFixed(2) + '%' : null,
    origin: a.origen === 'cruce' ? 'crossover' : a.origen === 'mutacion' ? 'mutation' : a.origen === 'aleatorio' ? 'chance' : a.origen,
    best: ev?.mejorValidado?.nombre, stall: ev?.estancado, gen: ev?.generacion, genbest: ev && ev.generacion != null && ev.estancado != null ? ev.generacion - ev.estancado : null,
    // the trench
    vivos: tr?.vivos ?? R.data?.academia?.tokensVivos, x: g.salida?.objetivoX, stop: g.salida?.stopPct, maxmin: g.salida?.maxMin, pad: padLabel(g.filtros?.pad),
    muertos: a.validacion?.muertos ?? a.entreno?.muertos ?? 0, smart: cur?.listosAlEntrar ?? 0, smartmin: g.disparo?.listos10Min, dpct: g.disparo?.dPrecio5Min,
    snipers: g.filtros?.snipersMax, mcap: cur ? fmtUsd(cur.mcap) : null, age: cur ? Math.max(0, Math.round((Date.now() - cur.t) / 60000)) + ' min' : null,
  };
}
function say(ag, situation, v, k) {
  const text = frase(ag, situation, v, k);
  if (ag.bubble && ag.bubble.text === text) return;
  if (R.queue.some((q) => q.id === ag.id)) return;
  if (R.queue.length > 8) R.queue.shift();
  R.queue.push({ id: ag.id, text, situation });
}
function pumpBubbles(now) {
  for (const ag of allAgents()) if (ag.bubble && ag.bubble.until < now) ag.bubble = null;
  let active = allAgents().filter((a) => a.bubble).length;
  while (active < BUBBLE_MAX && R.queue.length) {
    const q = R.queue.shift();
    const ag = R.agents.get(q.id) || R.leaving.find((l) => l.id === q.id);
    if (!ag || ag.gone) continue;
    ag.bubble = { text: q.text, until: now + BUBBLE_MS + q.text.length * 45, situation: q.situation };
    active++;
  }
}
function allAgents() { return [...R.agents.values(), ...R.leaving]; }
function chatter(now) {
  if (now - R.lastChatter < CHATTER_MS) return;
  R.lastChatter = now;
  const list = [...R.agents.values()].filter((a) => !a.path.length);
  if (!list.length) return;
  list.sort((a, b) => a.id < b.id ? -1 : 1);
  const ag = list[hash('idle:' + Math.floor(now / CHATTER_MS)) % list.length];
  const a = ag.data; const open = Object.keys(a.posiciones || {}).length;
  let situation = 'idle';
  if (ag.mode === 'tea') situation = 'tea';
  else if (ag.mode === 'visit') situation = 'visit';
  else if (open) situation = 'holding';
  else if (hash(ag.id + ':' + now) % 2 === 0) situation = 'waiting';   // half the time: why it is not trading yet
  else if (a.estado === 'observacion') situation = hash(ag.id + now) % 3 ? 'probation' : 'idle';
  else if (a.estado === 'cumple') situation = hash(ag.id + now) % 2 ? 'performing' : 'idle';
  const ev = R.data?.evolucion;
  if (ev && ev.estancado >= (ev.config?.estancadoTras || 15) && hash('stall' + Math.floor(now / CHATTER_MS)) % 4 === 0) situation = 'stall';
  const v = vars(ag);
  if (situation === 'visit') { const o = deskAgent(ag.visitN); v.other = o ? firstName(o.nombre) : 'nobody'; v.n = ag.visitN; }
  say(ag, situation, v, Math.floor(now / 60000));
}

/* ── data in: desks, feed, news ────────────────────────── */
export function updateOficina(data, live) {
  if (!R.canvas) return;
  R.data = data; R.live = !!live;
  const now = Date.now();
  const puestos = data?.academia?.puestos || [];
  const seen = new Set();
  for (const p of puestos) {
    if (!p.agente) continue;
    seen.add(p.agente.id);
    let ag = R.agents.get(p.agente.id);
    if (!ag) {
      ag = makeAgent(p.agente, p.n, !R.firstUpdate);
      R.agents.set(ag.id, ag);
      if (!R.firstUpdate) { const v = vars(ag); say(ag, 'hired', v, p.agente.contratado || now); R.blink.set(p.n, now + 3000); }
    } else {
      const before = ag.posCount;
      const after = Object.keys(p.agente.posiciones || {}).length;
      ag.data = p.agente; ag.deskN = p.n; ag.traits = personalidad(p.agente); ag.posCount = after;
      if (after !== before) {
        R.blink.set(p.n, now + 3000);
        if (after > before && ag.mode !== 'desk') { ag.mode = 'desk'; ag.spot = null; ag.visitN = null; setTarget(ag, DESKS[p.n - 1].seat); }
      }
    }
  }
  for (const [id, ag] of R.agents) {
    if (seen.has(id)) continue;
    R.agents.delete(id);
    if (R.firstUpdate) continue;
    ag.leaving = true; ag.mode = 'leave'; ag.spot = null; ag.visitN = null;
    const fired = (data?.academia?.despedidos || []).find((f) => f.id === id);
    ag.data = fired ? { ...ag.data, ...fired, estado: 'despedido' } : { ...ag.data, estado: 'despedido' };
    ag.traits = personalidad(ag.data);
    ag.path = [...findPath({ tx: ag.tx, ty: ag.ty }, DOOR), { tx: OUTSIDE.tx, ty: OUTSIDE.ty }];
    say(ag, 'fired', vars(ag), fired?.despedido || now);
  }
  // feed-driven speech
  const feed = [...(data?.academia?.feed || []), ...(data?.evolucion?.feed || [])].filter((f) => f && f.t).sort((a, b) => a.t - b.t);
  for (const f of feed) {
    const k = f.t + ':' + f.tipo + ':' + (f.id || f.puesto || '') + ':' + (f.texto || '').length;
    if (R.seenFeed.has(k)) continue;
    R.seenFeed.add(k);
    if (R.firstUpdate && now - f.t > 20000) continue;
    handleFeed(f, now);
  }
  if (R.seenFeed.size > 600) R.seenFeed = new Set([...R.seenFeed].slice(-300));
  for (const e of (data?.eventos?.ultimos || []).slice(0, 20)) {
    if (e.tipo !== 'noticia') continue;
    const k = e.t + ':' + (e.titulo || '');
    if (R.seenNews.has(k)) continue;
    R.seenNews.add(k);
    if (R.firstUpdate && now - e.t > 20000) continue;
    const list = [...R.agents.values()]; if (!list.length) continue;
    const ag = list[hash('news' + e.t) % list.length];
    say(ag, 'news', { ...vars(ag), titulo: String(e.titulo || 'news').slice(0, 42) }, e.t);
  }
  if (R.firstUpdate) { for (const ag of R.agents.values()) reconsider(ag, now); }
  R.firstUpdate = false;
  if (!R.timer) start();
}
function handleFeed(f, now) {
  const list = [...R.agents.values()];
  const byId = f.id ? R.agents.get(f.id) : null;
  const byDesk = f.puesto ? deskAgent(f.puesto) : null;
  const ag = byId || byDesk;
  const txt = f.texto || '';
  // trench feed: "X buys SYM at mcap 12k (flujo, 10 $)" / "X sells SYM (muerto): -10.00 $ (-100 %)"; old feed: coins in caps
  const coin = f.coin || txt.match(/\b(?:buys|sells)\s+(\S+)/)?.[1] || txt.match(/\b([A-Z]{2,6})\b/)?.[1];
  const pctM = txt.match(/\(?([+-]?\d+(?:[.,]\d+)?)\s?%\)?/);
  const pct = pctM ? pctM[1].replace(',', '.') + '%' : null;
  const mcapM = txt.match(/mcap\s+(\S+)/);
  const extra = { coin, pct, mcap: mcapM ? '$' + mcapM[1] : null };
  switch (f.tipo) {
    case 'apertura': if (ag) { say(ag, 'open', { ...vars(ag), ...extra }, f.t); R.blink.set(ag.deskN, now + 3000); } break;
    case 'ganancia': if (ag) { say(ag, 'win', { ...vars(ag), ...extra }, f.t); R.blink.set(ag.deskN, now + 3000); } break;
    case 'perdida': if (ag) { say(ag, /\(muerto\)/.test(txt) ? 'rug' : 'loss', { ...vars(ag), ...extra }, f.t); R.blink.set(ag.deskN, now + 3000); } break;
    case 'parcial': if (ag) { R.blink.set(ag.deskN, now + 2000); } break;   // a slice sold on the way up: the screen blinks, no speech
    case 'ascenso': case 'descenso': case 'aprende': case 'desaprende': case 'clima': if (ag) { R.blink.set(ag.deskN, now + 2000); ag.traits = personalidad(ag.data); } break;
    case 'contratacion': if (ag && !R.queue.some((q) => q.id === ag.id)) say(ag, 'hired', vars(ag), f.t); break;
    case 'consejo': for (let i = 0; i < Math.min(2, list.length); i++) { const a = list[(hash('council' + f.t) + i * 7) % list.length]; say(a, 'council', vars(a), f.t); } break;
    case 'record': R.whiteboardFlash = now + 3000; if (list.length) { const a = list[hash('rec' + f.t) % list.length]; say(a, 'record', vars(a), f.t); } break;
    case 'estancamiento': if (list.length) { const a = list[hash('stall' + f.t) % list.length]; say(a, 'stall', vars(a), f.t); } break;
    default: break;
  }
}

/* ── the loop ───────────────────────────────────────────── */
function start() {
  if (R.timer) return;
  R.timer = setInterval(tick, FPS_MS);
  tick();
}
function tick() {
  if (!R.canvas || !R.G) return;
  const now = Date.now();
  for (const ag of R.agents.values()) { reconsider(ag, now); stepAgent(ag); }
  for (const ag of R.leaving) stepAgent(ag);
  R.leaving = R.leaving.filter((l) => !l.gone);
  chatter(now);
  pumpBubbles(now);
  if (document.hidden) return;        // keep the state moving, skip the paint
  draw(now);
}
function draw(now) {
  const G = R.G; const ctx = R.ctx;
  if (!R.stat) buildStatic();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(R.stat, 0, 0);
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  R.hits = [];
  drawLed(ctx, now); drawWhiteboard(ctx, now); drawClock(ctx, now);
  // depth-sorted scene
  const items = [];
  for (const d of DESKS) {
    items.push({ depth: d.tx + d.ty + .1, draw: () => drawDesk(ctx, d, now) });
    items.push({ depth: d.seat.tx + d.seat.ty - .2, draw: () => drawChair(ctx, d.seat) });
  }
  items.push({ depth: TEA.table.tx + TEA.table.ty + .1, draw: () => drawTeaTable(ctx, now) });
  items.push({ depth: TEA.sofa[1].tx + TEA.sofa[1].ty + .1, draw: () => drawSofa(ctx) });
  items.push({ depth: TEA.counter[1].tx + TEA.counter[1].ty + .1, draw: () => drawCounter(ctx, now) });
  items.push({ depth: TEA.cooler.tx + TEA.cooler.ty + .1, draw: () => drawCooler(ctx) });
  for (const p of PLANTS) items.push({ depth: p.tx + p.ty + .1, draw: () => drawPlant(ctx, p) });
  const H = G.tw * .95;
  const tags = [];
  for (const ag of allAgents()) {
    const p = center(ag.tx, ag.ty);
    const sit = ag.mode === 'desk' && !ag.path.length && !ag.leaving;
    const alpha = ag.tx < -.2 ? clamp(1.3 + ag.tx / 1.6, 0, 1) : 1;
    const estado = ag.data?.estado;
    const mood = estado === 'despedido' ? 'sad' : estado === 'cumple' ? 'happy' : null;
    items.push({ depth: ag.tx + ag.ty + (sit ? -.1 : .05), draw: () => drawAvatar(ctx, p.x, p.y, H, ag.look, { front: ag.front, hx: ag.hx, walk: ag.path.length > 0, step: ag.step, sit, alpha, mood }) });
    const u = H / 16;
    tags.push({ ag, x: p.x, top: p.y - 18 * u, alpha });
    R.hits.push({ kind: 'agent', id: ag.id, x0: p.x - 5 * u, x1: p.x + 5 * u, y0: p.y - 19 * u, y1: p.y + u, depth: ag.tx + ag.ty + 1 });
  }
  items.sort((a, b) => a.depth - b.depth);
  for (const it of items) it.draw();
  // tags and bubbles last, so no furniture covers them
  for (const t of tags) {
    if (t.alpha < 1) ctx.globalAlpha = t.alpha;
    const e = t.ag.data?.estado;
    const dot = e === 'cumple' ? '#3fbf7f' : e === 'observacion' ? '#d9a441' : e === 'despedido' ? '#e05260' : null;
    drawTag(ctx, t.x, t.top, G.small ? firstName(t.ag.nombre) : t.ag.nombre, dot);
    ctx.globalAlpha = 1;
  }
  for (const t of tags) if (t.ag.bubble) drawBubble(ctx, t.x, t.top - (G.small ? 15 : 17), t.ag.bubble.text);
  if (!R.data) {
    ctx.fillStyle = 'rgba(10,13,16,.55)'; ctx.fillRect(0, 0, G.W, G.H);
    ctx.fillStyle = '#eef2f6'; ctx.font = `600 14px ${sansFont()}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('The office is dark: engine offline and no snapshot.', G.W / 2, G.H / 2); ctx.textAlign = 'left';
  }
  R.lastDraw = now;
}

/* ── input ──────────────────────────────────────────────── */
function onClick(ev) {
  const rect = R.canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  let best = null;
  for (const h of R.hits) if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1 && (!best || h.depth > best.depth)) best = h;
  if (best) {
    if (best.kind === 'agent') { R.openAgent?.(best.id); return; }
    if (best.id) { R.openAgent?.(best.id); return; }
    R.toast?.(`Desk ${best.n} is vacant: waiting for the next validated candidate.`); return;
  }
  const t = inv(x, y); const tx = Math.floor(t.tx), ty = Math.floor(t.ty);
  if (tx === TEA.table.tx && ty === TEA.table.ty) R.toast?.('The kettle is on. Agents on probation or with nothing open come here.');
  else if (TEA.sofa.some((s) => s.tx === tx && s.ty === ty)) R.toast?.('The sofa is bullish. The sofa is always bullish.');
  else if (TEA.counter.some((s) => s.tx === tx && s.ty === ty)) R.toast?.('Coffee machine. Paper coffee, real caffeine.');
  else if (tx === DOOR.tx && ty === DOOR.ty) R.toast?.('The door: hires come in, the fired walk out.');
  else if (tx === TEA.cooler.tx && ty === TEA.cooler.ty) R.toast?.('Water cooler. Where the real alpha is shared.');
}

export function initOficina(opts) {
  R.canvas = opts.canvas; R.wrap = opts.wrap; R.openAgent = opts.openAgent; R.toast = opts.toast;
  R.ctx = R.canvas.getContext('2d');
  geometry();
  R.canvas.addEventListener('click', onClick);
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (Math.abs(R.wrap.clientWidth - 16 - R.G.W) > 2) { geometry(); if (!document.hidden) draw(Date.now()); } }, 150); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && R.G) draw(Date.now()); });
  draw(Date.now());
}
