/* PESTAÑA 9 · UN POOL DE $OLIG SOLO CON USDC, PARA QUE GMGN ENSEÑE SU IMAGEN Y SUS REDES (5-oct-2026).
   La idea es del dueño: el ARC oficial (0xA12C…788d) sale con icono en GMGN sin que nadie pueda comprarlo, y lo medimos el
   16-sep: tiene 5 pools V4 de terceros y NINGUNO lleva ARC dentro. Con el TEST vimos que GMGN lee tokenURI/logo cuando hay
   pool. Asi que: un pool V4 OLIG/USDC al 1 % (espaciado 200), SIN hook, con unos pocos USDC por DEBAJO del precio y cero
   OLIG. Nadie puede comprar OLIG (no hay OLIG en el pool); solo quien ya tiene OLIG podria venderle, y eso es la wallet del
   equipo. Lo firma cualquier wallet con USDC en Arc (no hace falta tener OLIG).
   - OLIG (0x1438…) va por DEBAJO de USDC (0x3600…), asi que currency0 = OLIG y currency1 = USDC: el precio del pool es USDC
     crudo por OLIG crudo = $/OLIG * 1e-12, y una posicion solo de currency1 (USDC) va por debajo del tick actual.
   - Si el pool ya existe (alguien lo abrio antes), no se inicializa: se añade el USDC por debajo de SU precio.
   - El pool oficial del lanzamiento llevara el hook de OligArc: es OTRO pool (otra clave), este no lo estorba. Los USDC de
     aqui se pueden sacar cuando se quiera con el NFT de la posicion, que queda en la wallet que firma.
   Solo arma las transacciones; las firma la wallet del navegador. */
import { V4, POSM_ABI, STATEVIEW_ABI, poolId, liquidityFor, encodeMint } from "./v4.js?v=1";
import { USDC_ERC20, TICK_SPACING } from "./fabrica-v4.js?v=3";

export const LP_FEE = 10000;
const MIN_TICK = -887272, MAX_TICK = 887272;
const abajo = (t) => Math.floor(t / TICK_SPACING) * TICK_SPACING;

/* tick del pool OLIG(currency0, 18 dec)/USDC(currency1, 6 dec) para un precio en $ por OLIG */
export function tickDeUsd(usdPorToken) {
  if (!(usdPorToken > 0) || !isFinite(usdPorToken)) throw new Error("the price is not a positive number");
  return Math.log(usdPorToken * 1e-12) / Math.log(1.0001);
}
export const usdDeTick = (tick) => 1.0001 ** tick * 1e12;

/* El plan. token < USDC obligatorio (es el caso de OLIG). sqrtActual = sqrtPriceX96 del pool si ya existe (0n si no).
   mcUsd = FDV de salida (solo si hay que abrirlo); usdc = USDC crudos (6 dec); hasta = el colchon baja hasta precio/hasta. */
export function planPoolSoloUsdc({ token, supply, mcUsd, usdc, owner, sqrtActual = 0n, hasta = 10, ahoraSeg }) {
  const E = globalThis.ethers;
  const tk = String(token).toLowerCase();
  if (!(tk < USDC_ERC20)) throw new Error("this tool is for a token that sorts below USDC (like OLIG)");
  if (!(usdc > 0n)) throw new Error("put some USDC in");
  const key = { currency0: tk, currency1: USDC_ERC20, fee: LP_FEE, tickSpacing: TICK_SPACING, hooks: E.ZeroAddress };
  let sq, tickActual, precio, abrir = false;
  if (sqrtActual > 0n) {
    sq = sqrtActual;
    const r = Number(sqrtActual) / 2 ** 96;
    tickActual = Math.floor(Math.log(r * r) / Math.log(1.0001));
    precio = usdDeTick(tickActual);
  } else {
    if (!(mcUsd > 0)) throw new Error("the starting market cap has to be a positive number");
    const enteros = Number(E.formatUnits(supply, 18));
    precio = mcUsd / enteros;
    tickActual = Math.round(tickDeUsd(precio));
    sq = BigInt(Math.floor(Math.pow(1.0001, tickActual / 2) * 2 ** 96));
    abrir = true;
  }
  const upper = abajo(tickActual);                                   // <= tick actual: la posicion es solo USDC
  const lower = abajo(Math.floor(tickDeUsd(precio / hasta)));
  if (!(lower < upper) || lower < MIN_TICK || upper > MAX_TICK) throw new Error("that price is outside what a Uniswap pool can hold");
  const raiz = Number(sq);
  const L = liquidityFor(raiz, lower, upper, 0n, (usdc * 999n) / 1000n); // 0,1 % de margen para el redondeo
  if (L <= 0n) throw new Error("that is too little USDC for a position");
  const posm = new E.Interface(POSM_ABI);
  const deadline = Math.floor(ahoraSeg || Date.now() / 1000) + 1800;
  const mint = encodeMint(key, lower, upper, L, 0n, usdc, owner);
  const llamadas = [];
  if (abrir) llamadas.push(posm.encodeFunctionData("initializePool", [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks], sq]));
  llamadas.push(posm.encodeFunctionData("modifyLiquidities", [mint, deadline]));
  return { key, id: poolId(key), abrir, precio, sq, tickActual, lower, upper, L, desde: usdDeTick(lower),
    multicall: posm.encodeFunctionData("multicall", [llamadas]) };
}

/* Sacar el USDC: DECREASE_LIQUIDITY (toda) + TAKE_PAIR(currency0, currency1, a quien). El NFT queda vacio en la wallet. */
export function planRetirar({ tokenId, liquidez, key, para, ahoraSeg }) {
  const E = globalThis.ethers, abi = E.AbiCoder.defaultAbiCoder();
  const unlock = abi.encode(["bytes", "bytes[]"], ["0x0111", [
    abi.encode(["uint256", "uint256", "uint128", "uint128", "bytes"], [tokenId, liquidez, 0n, 0n, "0x"]),
    abi.encode(["address", "address", "address"], [key.currency0, key.currency1, para]),
  ]]);
  const posm = new E.Interface(POSM_ABI);
  return posm.encodeFunctionData("modifyLiquidities", [unlock, Math.floor(ahoraSeg || Date.now() / 1000) + 1800]);
}

/* El numero de la posicion que acaba de crear un recibo: el Transfer (ERC-721) del PositionManager desde 0x0. */
export function posicionDelRecibo(rc) {
  const T = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  for (const l of (rc && rc.logs) || []) {
    if (String(l.address).toLowerCase() === V4.positionManager && l.topics && l.topics[0] === T && l.topics.length === 4 && /^0x0+$/.test(l.topics[1])) return BigInt(l.topics[3]);
  }
  return null;
}

/* sqrtPriceX96 de la pool en el StateView: 0 = no existe todavia. */
export async function sqrtDePool(id, lector) {
  const sv = new globalThis.ethers.Contract(V4.stateView, STATEVIEW_ABI, lector);
  const [sqrt] = await sv.getSlot0(id);
  return BigInt(sqrt);
}
export { V4 };
