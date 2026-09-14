/* ── V4, HOOKS DE ARGUSPAD Y PUENTES: el pegamento con el motor de rutas ──
 *
 * (14-sep-2026) Hasta hoy el panel de comprar y vender solo sabia de pools V3
 * contra USDC (QuoterV2 + SwapRouter02). Una moneda sin esa pool -- ARCX10, que
 * es de Arguspad y vive en una V4 con hook, o BARC, V4 contra USDC nativo --
 * salia con "has no pool against USDC on this factory — nothing to trade", y
 * el dueño no la podia comprar desde aqui.
 *
 * ESTO NO ES OTRO ENRUTADOR. El que enruta es rutas.js, copiado BYTE A BYTE de
 * arcmagnate/demo/router/rutas.js (el mismo md5 que cusp-web/assets/js/rutas.js).
 * Si hay que cambiar como se enruta, se cambia alli y se vuelve a copiar; aqui
 * no se toca. Este fichero solo hace lo que el motor no hace:
 *   - buscar las pools candidatas SIN API (la de Cusp no acepta este origen):
 *     la factoria V3 contra USDC y los puentes, las V4 sin hook en las parejas
 *     (fee, tickSpacing) que de verdad hay en Arc, y el lanzamiento de Arguspad
 *     leido del propio Portal. Todo eso es una LISTA DE CANDIDATAS: el motor
 *     vuelve a validar cada pool en cadena (hash de la PoolKey, slot0, y la
 *     prueba entera del hook con politicaHooks "arguspad");
 *   - quitar la comision, comprobarlo en el calldata, y firmar con la cartera
 *     que le den (la rapida o una del cluster, con el proveedor rotativo).
 *
 * LA COMISION, Y POR QUE NO SE PUEDE "APAGAR".
 * El motor cobra un 1% en todas las rutas: COMISION_BIPS = 100 es una constante
 * y ni cotizar() ni construirSwap() tienen opcion para quitarla. Lo que SI tiene
 * es `carteraComision`, a quien va ese 1%. Esta herramienta es del dueño y no
 * cobra nada, asi que esa cartera es MSG_SENDER (0x...01): el UniversalRouter la
 * traduce a quien firma (Dispatcher.map en UR 2.1.1), y el 1% vuelve a la MISMA
 * cartera en la MISMA transaccion. La cartera de la plataforma no ve nada.
 * Lo que eso cambia, medido en tools/probar-motor.mjs:
 *   - comprar $1 manda $1 y el router devuelve $0,01 al momento: se opera con
 *     $0,99, y el coste que se apunta es ese;
 *   - vender recibe TODO en dos transferencias (el 1% y el resto). El minimo
 *     del SWEEP va sobre el 99%, que es lo mismo que el minimo sobre el total;
 *   - la guarda del 35% cuenta ese 1% como perdida: es un punto mas estricta.
 * Y antes de firmar se lee el propio calldata (comprobarDestinos): todo lo que
 * paga el router tiene que ir a quien firma o quedarse en el router hasta el
 * siguiente paso. Si un rutas.js futuro ignorase la opcion, no se firma.
 *
 * Sin DOM y sin imports: app.js le pasa ethers, Rutas y el proveedor, y la
 * prueba de Node usa exactamente este mismo fichero. */

const NATIVO = "0x0000000000000000000000000000000000000000";
const USDC = "0x3600000000000000000000000000000000000000";
const MSG_SENDER = "0x0000000000000000000000000000000000000001";
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";

/* COMO SE PAGA UNA COMPRA: con msg.value. En Arc el nativo ES el USDC (el mismo
 * saldo que 0x3600 en 6 decimales) y el router gasta como ERC-20 lo que le llega
 * asi. Es UNA firma y cero aprobaciones, que en una cartera del cluster es gas
 * que no se paga. Vender necesita Permit2 siempre (el motor lo fuerza). */
const MODO_COMPRA = "valor";

/* LAS PAREJAS (fee, tickSpacing) DE LAS V4 SIN HOOK QUE SE PRUEBAN.
 * No hay registro en cadena de las PoolKeys V4 (el evento Initialize sirve si
 * sabes el bloque, y getLogs no pasa de 10.000). Asi que se prueban las que HAY:
 * medido el 14-sep en la tabla `pools` del indexer, en solo lectura, las V4
 * contra USDC nativo o ERC-20 sin hook, de mas a menos pools:
 *   nativo 2500/25 (50), nativo 10000/200 (39), erc20 10000/200 (26),
 *   nativo 10000/60 (15), nativo 30000/60 (10), y una cola de 1 a 5.
 * Van todas las de la cola salvo la serie 3001..3017/60 (una prueba de alguien)
 * y las de tickSpacing nulo. Una pool fuera de esta lista NO se encuentra: es
 * el limite de buscar sin API, y se dice en motivoSinRuta. */
export const PAREJAS_V4_SIN_HOOK = [
  [2500, 25], [10000, 200], [10000, 60], [30000, 60], [500000, 200], [250000, 200],
  [30000, 600], [750000, 1], [450000, 200], [100000, 200], [990000, 200], [2500, 60],
  [100, 1], [10000, 50], [100000, 60], [250000, 100], [30000, 1], [0, 60],
  [300000, 200], [150000, 200], [3000, 60], [700000, 200], [20000, 60], [20000, 200],
  [270000, 60], [500000, 60], [500, 10],
];
/* Las de Arguspad (hook con bits 0x2044), misma medicion: erc20 10000/200 (256),
 * 0/200 (8), 0/1 (3), 3000/60 (1) y nativo 0/1 (1). Aqui no se lee nada por
 * pareja: el hook dice su poolId() y la pareja se resuelve con el hash. */
export const PAREJAS_ARGUSPAD = [[10000, 200], [0, 200], [0, 1], [3000, 60]];

/* Las monedas de los puentes, para pintar la ruta. Lo demas sale acortado. */
const SIMBOLOS = {
  [USDC]: "USDC",
  [NATIVO]: "USDC",
  "0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b": "CRCL",
  "0x2164bb17a2d38c1b5170e987b2c0416df1efc752": "LONG",
  "0x6505506540dc99f7366316b10e9cf1a584cbd42a": "NVDA",
};

const ABI_AGGREGATE3 = "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)";
const ABI_SLOT0 = "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)";
const ABI_LAUNCHES = "function launches(address) view returns (bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32)";
const ABI_POOLID = "function poolId() view returns (bytes32)";

const min = (a) => String(a).toLowerCase();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── EL MOTOR, SIN COMISION ─────────────────────────────────────────────── */

export function crearMotorPropio(ethers, Rutas, provider) {
  if (!Rutas || typeof Rutas.crearMotor !== "function") {
    throw new Error("the route engine (rutas.js) did not load — reload the page");
  }
  if (!Rutas.CONSTANTES || min(Rutas.CONSTANTES.MSG_SENDER) !== MSG_SENDER) {
    throw new Error("the route engine does not use the router's MSG_SENDER constant: refusing to trade");
  }
  const m = Rutas.crearMotor(ethers, provider, { politicaHooks: "arguspad", carteraComision: MSG_SENDER });
  /* Si el motor no cogiera la cartera, el 1% iria a la de la plataforma. */
  if (min(m.carteraComision) !== MSG_SENDER) {
    throw new Error("the route engine did not take the no-fee setting, so it would pay a platform wallet: refusing to trade");
  }
  /* Un rutas.js anterior a la 1.1.0 ignora politicaHooks SIN error y dejaria
   * pasar cualquier hook. */
  if (typeof m.verificarHookArguspad !== "function" || typeof m.impuestosHook !== "function") {
    throw new Error("the route engine is too old to prove Arguspad hooks: refusing to trade");
  }
  return m;
}

/* ── LAS CANDIDATAS ─────────────────────────────────────────────────────── */

/* Un aggregate3 con allowFailure: cada subllamada trae su resultado o su
 * fallo. Un revert del conjunto no se repite; lo demas (un nodo que no
 * contesta) si, dos veces. */
async function agregar(ethers, provider, llamadas, blockTag) {
  const i = new ethers.Interface([ABI_AGGREGATE3]);
  const tx = { to: MULTICALL3, data: i.encodeFunctionData("aggregate3", [llamadas]) };
  if (blockTag !== undefined && blockTag !== null) tx.blockTag = blockTag;
  let ultimo;
  for (let n = 0; n < 3; n++) {
    try {
      const raw = await provider.call(tx);
      return i.decodeFunctionResult("aggregate3", raw)[0];
    } catch (e) {
      if (e && e.code === "CALL_EXCEPTION") throw e;
      ultimo = e;
      await esperar(300 * (n + 1));
    }
  }
  throw ultimo;
}
function decodificar(r, iface, fn) {
  if (!r || !r.success || !r.returnData || r.returnData === "0x") return null;
  try { return iface.decodeFunctionResult(fn, r.returnData); } catch { return null; }
}
/* Una palabra de 32 bytes que es una direccion, o null. */
function palabraDireccion(w) {
  const h = min(w);
  return /^0x0{24}[0-9a-f]{40}$/.test(h) ? "0x" + h.slice(26) : null;
}
const ordenar = (a, b) => (a < b ? [a, b] : [b, a]);

export async function poolsCandidatas({ ethers, Rutas, motor, provider, token, blockTag }) {
  const t = min(token);
  const D = Rutas.DIRECCIONES;
  const cod = motor.codificadores;
  const iS0 = new ethers.Interface([ABI_SLOT0]);
  const iLan = new ethers.Interface([ABI_LAUNCHES]);
  const iPid = new ethers.Interface([ABI_POOLID]);

  /* V4 sin hook: el id se calcula aqui y se pregunta su slot0 a StateView.
   * Una pool que no existe devuelve ceros, no revierte. */
  const claves = [];
  for (const [fee, ts] of PAREJAS_V4_SIN_HOOK) {
    for (const q of [NATIVO, USDC]) {
      const [c0, c1] = ordenar(q, t);
      const k = { currency0: c0, currency1: c1, fee, tickSpacing: ts, hooks: NATIVO };
      claves.push({ ...k, id: cod.poolIdV4(k) });
    }
  }
  const portales = (Rutas.PORTALES_ARGUSPAD || []).map(min);
  const llamadas = claves.map((k) => ({ target: D.V4_STATE_VIEW, allowFailure: true, callData: iS0.encodeFunctionData("getSlot0", [k.id]) }))
    .concat(portales.map((p) => ({ target: p, allowFailure: true, callData: iLan.encodeFunctionData("launches", [t]) })));
  const r = await agregar(ethers, provider, llamadas, blockTag);

  const pools = [];
  claves.forEach((k, j) => {
    const x = decodificar(r[j], iS0, "getSlot0");
    if (x && BigInt(x[0]) !== 0n) {
      pools.push({ version: "v4", poolAddress: k.id, token0: k.currency0, token1: k.currency1, fee: k.fee, tickSpacing: k.tickSpacing, hooks: NATIVO });
    }
  });

  /* ARGUSPAD: el Portal dice el hook (palabra 4) y la moneda de cotizacion
   * (palabra 10, cero = nativo); el hook dice su poolId(), y la pareja
   * (fee, tickSpacing) es la que da ese hash. La prueba de verdad -- portal(),
   * token(), poolId(), splitter y el registro del Portal -- la hace el motor. */
  const lanzados = [];
  portales.forEach((p, j) => {
    const x = decodificar(r[claves.length + j], iLan, "launches");
    if (!x) return;
    const hook = palabraDireccion(x[4]);
    if (!hook || hook === NATIVO) return;
    const quote = palabraDireccion(x[10]) || NATIVO;
    lanzados.push({ hook, quote });
  });
  if (lanzados.length) {
    const r2 = await agregar(ethers, provider,
      lanzados.map((l) => ({ target: l.hook, allowFailure: true, callData: iPid.encodeFunctionData("poolId", []) })), blockTag);
    lanzados.forEach((l, j) => {
      const x = decodificar(r2[j], iPid, "poolId");
      if (!x) return;
      const id = min(x[0]);
      const [c0, c1] = ordenar(l.quote, t);
      for (const [fee, ts] of PAREJAS_ARGUSPAD.concat(PAREJAS_V4_SIN_HOOK)) {
        const k = { currency0: c0, currency1: c1, fee, tickSpacing: ts, hooks: l.hook };
        if (cod.poolIdV4(k) === id) {
          pools.push({ version: "v4", poolAddress: id, token0: c0, token1: c1, fee, tickSpacing: ts, hooks: l.hook });
          break;
        }
      }
    });
  }

  /* V3: la factoria, contra USDC y contra los puentes de long.supply (CRCL,
   * LONG, NVDA). Las pools de los puentes las pone el motor. */
  for (const p of await motor.buscarPoolsV3({ token: t, blockTag })) pools.push(p);
  return pools;
}

/* Las rutas EJECUTABLES de una moneda, con lo descartado y por que. */
export async function descubrir({ ethers, Rutas, motor, provider, token, blockTag }) {
  const candidatas = await poolsCandidatas({ ethers, Rutas, motor, provider, token, blockTag });
  const d = await motor.descubrirRutas({ token: min(token), pools: candidatas, blockTag });
  return { token: min(token), rutas: d.rutas.filter((x) => x.ejecutable), descartes: d.descartes, candidatas };
}

export function motivoSinRuta(d) {
  const l = (d && d.descartes) || [];
  const hook = l.find((x) => /hook/i.test(String(x.error || "")));
  if (hook) return String(hook.error) + " This page will not trade through it.";
  if (l.length) return "its pools could not be checked on-chain (" + String(l[0].error).slice(0, 140) + "). Nothing to trade.";
  if (d && d.candidatas && d.candidatas.length) return "it has pools, but none of them leads to USDC. Nothing to trade.";
  return "no pool against USDC was found — not on the V3 factory (direct, or through CRCL, LONG or NVDA), " +
    "not among the V4 fee and tick-spacing pairs used on Arc, and not an Arguspad launch. Nothing to trade.";
}

/* ── COTIZAR Y PLANEAR ──────────────────────────────────────────────────── */

export async function mejorCotizacion({ motor, rutas, lado, cantidad, blockTag }) {
  const m = await motor.mejorRuta({ rutas, lado, cantidad, blockTag, modoPago: lado === "compra" ? MODO_COMPRA : undefined });
  if (!m.mejor) {
    const e0 = m.todas.find((x) => x.error);
    throw new Error("no route would quote this trade" + (e0 ? " (" + e0.error + ")" : "") + " — nothing was signed");
  }
  return m.mejor;
}

/* LO QUE PAGA EL ROUTER, LEIDO DEL CALLDATA ANTES DE FIRMAR.
 * construirSwap solo emite estos comandos; cualquier otro, o un destino que no
 * sea quien firma (o el propio router entre dos pasos), y no se firma:
 *   0x00 V3_SWAP_EXACT_IN       destino el router o quien firma
 *   0x02 PERMIT2_TRANSFER_FROM  destino el router
 *   0x04 SWEEP                  destino quien firma
 *   0x06 PAY_PORTION            destino quien firma -- ES LA COMISION
 *   0x10 V4_SWAP                SETTLE / SWAP_EXACT_IN(_SINGLE) / SETTLE_ALL /
 *                               TAKE al router o a quien firma / TAKE_ALL */
export function comprobarDestinos(ethers, Rutas, swap) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const no = (txt) => { throw new Error("the trade calldata " + txt + ": refusing to sign"); };
  if (min(swap.to) !== min(Rutas.DIRECCIONES.UNIVERSAL_ROUTER)) no("is not addressed to the Uniswap UniversalRouter");
  const cmds = ethers.getBytes(swap.comandos);
  if (cmds.length !== swap.inputs.length) no("has a command list that does not match its inputs");
  cmds.forEach((c, k) => {
    const inp = swap.inputs[k];
    if (c === 0x02 || c === 0x04 || c === 0x06) {
      const [, destino] = abi.decode(["address", "address", "uint256"], inp);
      const quiere = c === 0x02 ? ADDRESS_THIS : MSG_SENDER;
      if (min(destino) !== quiere) no((c === 0x06 ? "pays a fee to " : "sends funds to ") + destino);
    } else if (c === 0x00) {
      const [destino] = abi.decode(["address", "uint256", "uint256", "bytes", "bool", "uint256[]"], inp);
      if (min(destino) !== ADDRESS_THIS && min(destino) !== MSG_SENDER) no("swaps V3 output to " + destino);
    } else if (c === 0x10) {
      const [acciones, params] = abi.decode(["bytes", "bytes[]"], inp);
      const a = ethers.getBytes(acciones);
      if (a.length !== params.length) no("has a V4 action list that does not match its params");
      a.forEach((x, j) => {
        if (x === 0x0b || x === 0x0c || x === 0x06 || x === 0x07 || x === 0x0f) return;
        if (x === 0x0e) {
          const [, destino] = abi.decode(["address", "address", "uint256"], params[j]);
          if (min(destino) !== ADDRESS_THIS && min(destino) !== MSG_SENDER) no("takes V4 output to " + destino);
          return;
        }
        no("has an unexpected V4 action 0x" + x.toString(16));
      });
    } else {
      no("has an unexpected router command 0x" + c.toString(16));
    }
  });
  return true;
}

/* Cotizar (la mejor ruta, o `ruta` si se da), la guarda del 35%, las
 * aprobaciones que falten y el calldata. No firma nada: la prueba de Node lo
 * usa tal cual con blockTag, ahora y deadline fijos. */
export async function planificar({ ethers, Rutas, motor, rutas, ruta, lado, cantidad, slippageBps, usuario, blockTag, ahora, deadline, sinAprobaciones }) {
  const modoPago = lado === "compra" ? MODO_COMPRA : undefined;
  const cot = ruta
    ? await motor.cotizar({ ruta, lado, cantidad, blockTag, modoPago })
    : await mejorCotizacion({ motor, rutas, lado, cantidad, blockTag });
  const guarda = motor.guardaPerdida(cot);
  const aprobaciones = sinAprobaciones ? [] : await motor.aprobaciones({ cotizacion: cot, usuario, blockTag, ahora });
  const swap = motor.construirSwap({ cotizacion: cot, slippageBps, deadline });
  comprobarDestinos(ethers, Rutas, swap);
  return { cot, guarda, aprobaciones, swap, slippageBps };
}

/* ── LO QUE SE ENSEÑA ───────────────────────────────────────────────────── */

const pct = (bps) => (Number(bps) / 100).toFixed(Number(bps) % 100 ? 2 : 0) + "%";

export function textoRuta(ruta, lado, simbolo) {
  const nombre = (a) => SIMBOLOS[min(a)] || (min(a) === min(ruta.token) ? simbolo : a.slice(0, 6) + "…" + a.slice(-4));
  const monedas = [ruta.saltos[0].entra].concat(ruta.saltos.map((s) => s.sale));
  const pools = ruta.saltos.map((s) => s.version.toUpperCase() + " " + (s.pool.fee / 10000) + "%");
  if (lado === "venta") { monedas.reverse(); pools.reverse(); }
  const h = ruta.saltos.find((s) => s.pool.hook && s.pool.hook.ok);
  return monedas.map(nombre).join(" → ") + " · " + pools.join(" + ") +
    (ruta.nativo ? " · native USDC" : "") +
    (h ? " · Arguspad hook, buy tax " + pct(h.pool.hook.buyTaxBps) + " · sell tax " + pct(h.pool.hook.sellTaxBps) : "");
}

/* La linea del log, con la misma forma que la de V3: entra → sale (min, %). */
export function textoCotizacion(ethers, plan, lado, simbolo, decimales) {
  const c = plan.cot;
  const n = (x, d) => Number(ethers.formatUnits(x, d)).toLocaleString("es");
  const decUsdc = c.ruta.nativo ? 18 : 6;
  const slip = plan.slippageBps;
  /* Sobre el total: en una venta el SWEEP lleva el 99% de este minimo, que es
   * la misma condicion (el 1% que vuelve es proporcional). */
  const minimo = (c.sale * BigInt(10000 - slip)) / 10000n;
  const ruta = textoRuta(c.ruta, lado, simbolo);
  if (lado === "compra") {
    return n(c.cantidad, 6) + " → " + n(c.sale, decimales) + "  (min " + n(minimo, decimales) + ", " + slip / 100 + "%) · " +
      ruta + " · " + n(c.comision, c.value > 0n ? 18 : 6) + " of it comes straight back";
  }
  return n(c.cantidad, decimales) + " → " + n(c.sale, decUsdc) + "  (min " + n(minimo, decUsdc) + ", " + slip / 100 + "%) · " + ruta;
}

/* Lo que de verdad sale de la cartera al comprar: la entrada menos el 1% que
 * vuelve. En USDC, como Number. */
export function usdcGastado(ethers, cot) {
  return Number(ethers.formatUnits(cot.entra - cot.comision, cot.value > 0n ? 18 : 6));
}
/* Lo que vuelve al vender: la salida ENTERA del router, porque el 1% tambien
 * vuelve a la misma cartera. */
export function usdcDeVenta(ethers, cot) {
  return Number(ethers.formatUnits(cot.sale, cot.ruta.nativo ? 18 : 6));
}

/* ── OPERAR ─────────────────────────────────────────────────────────────── */

/* Una operacion entera con UNA cartera: cotizar justo antes, la guarda,
 * aprobar lo que falte (el importe exacto, cada aprobacion simulada antes),
 * volver a cotizar si se aprobo, simular el calldata exacto desde la cartera y
 * firmar. `firmante` es un ethers.Wallet conectado al proveedor rotativo. */
export async function operar({ ethers, Rutas, motor, firmante, rutas, lado, cantidad, slippageBps, simbolo, decimales, avisar = () => {} }) {
  const usuario = firmante.address;
  let plan = await planificar({ ethers, Rutas, motor, rutas, lado, cantidad, slippageBps, usuario });
  avisar(textoCotizacion(ethers, plan, lado, simbolo, decimales));

  if (plan.swap.value > 0n) {
    const saldo = await firmante.provider.getBalance(usuario);
    if (saldo < plan.swap.value) {
      throw new Error("it holds $" + Number(ethers.formatUnits(saldo, 18)).toFixed(4) + " and this buy sends $" +
        Number(ethers.formatUnits(plan.swap.value, 18)).toFixed(4) + " plus gas — fund it first");
    }
  }

  const aprobadas = plan.aprobaciones.length;
  for (let k = 0; k < aprobadas; k++) {
    const a = plan.aprobaciones[k];
    const pfA = await motor.preflight({ from: usuario, tx: a });
    if (!pfA.ok) throw new Error("the approval would fail on-chain (" + pfA.error + ") — nothing was signed");
    avisar(a.tipo === "erc20-approve"
      ? "approving exactly this amount of " + simbolo + " for Permit2"
      : "letting the Uniswap router use exactly that, for 30 minutes");
    const txA = await firmante.sendTransaction({ to: a.to, data: a.data, value: 0n });
    await txA.wait();
  }
  /* Entre aprobar y firmar pasan segundos: el minimo sale del estado de ahora.
   * La cantidad no cambia, asi que lo aprobado sigue valiendo. */
  if (aprobadas) plan = await planificar({ ethers, Rutas, motor, ruta: plan.cot.ruta, lado, cantidad, slippageBps, usuario, sinAprobaciones: true });

  let pf = await motor.preflight({ from: usuario, tx: plan.swap });
  /* Un nodo que aun no ha visto la aprobacion recien minada dice que falta
   * permiso: se espera un poco, SOLO en ese caso. */
  for (let n = 0; !pf.ok && aprobadas && n < 3 && /Allowance|InsufficientToken|TRANSFER_FROM|STF/i.test(String(pf.error)); n++) {
    await esperar(1500);
    pf = await motor.preflight({ from: usuario, tx: plan.swap });
  }
  if (!pf.ok) throw new Error("the trade would fail on-chain (" + pf.error + ") — it was not signed");

  const tx = await firmante.sendTransaction({ to: plan.swap.to, data: plan.swap.data, value: plan.swap.value });
  const recibo = await tx.wait();
  return { plan, tx, recibo };
}
