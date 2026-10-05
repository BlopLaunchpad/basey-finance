/* PESTAÑA 9 · EL POOL UNISWAP V4 DE UN TOKEN QUE YA EXISTE (5-oct-2026).
   El dueño, con el TEST creado y GMGN sin su imagen: *"ponme en el 9 abajo del todo para armar la pool como lo haciamos en el
   otro, 0 en el suelo ... que empiece en 5k de MC"* y *"Uni v4 no v3"*. La fabrica V4 de basey solo abre pools de los tokens
   que despliega ella, asi que esto lo hace con las piezas de v4.js y la wallet del navegador:
     1. ERC20.approve(Permit2)  2. Permit2.approve(PositionManager)   (permit2Steps de v4.js, si hace falta)
     3. PositionManager.multicall([ initializePool(clave, precio), modifyLiquidities(MINT + SETTLE_PAIR) ])
   Pool USDC/token al 1 % (espaciado 200) y SIN hook, como los de basey; USDC es currency0 (el token tiene que ir por encima,
   la misma convencion que la fabrica); el muro solo lleva el token, desde el precio de salida hacia arriba (ticksV4 de
   fabrica-v4.js), y el suelo nada. La primera compra no cabe en la misma transaccion sin un contrato propio (en V4 el swap va
   por otro contrato): se hace despues, desde donde sea.
   Solo arma las transacciones; las firma la wallet del navegador. */
import { V4, POSM_ABI, STATEVIEW_ABI, poolId, liquidityFor, encodeMint } from "./v4.js?v=1";
import { ticksV4, USDC_ERC20, TICK_SPACING } from "./fabrica-v4.js?v=3";

export const LP_FEE = 10000;
const MIN_SQRT = 4295128739n, MAX_SQRT = 1461446703485210103287273052203988822378723970342n;

/* El plan entero, antes de firmar nada. mcUsd = capitalizacion de salida; hasta = cuantas veces el precio de salida
   cubre el muro por arriba (1000 = hasta mil veces la MC). */
export function planPoolV4({ token, decimals, supply, mcUsd, wallTokens, owner, hasta = 1000, ahoraSeg }) {
  const E = globalThis.ethers;
  const tk = String(token).toLowerCase();
  if (Number(decimals) !== 18) throw new Error("this pool tool expects an 18-decimal token");
  if (!(tk > USDC_ERC20)) throw new Error("this token sorts below USDC; this tool only opens pools with USDC as currency0");
  if (!(mcUsd > 0)) throw new Error("the market cap has to be a positive number");
  if (!(wallTokens > 0n)) throw new Error("the wallet holds none of this token");
  const enteros = Number(E.formatUnits(supply, 18));
  const precio = mcUsd / enteros;                       // USD por token
  const t = ticksV4(precio, 1, hasta);                  // startTick, wallLower, wallUpper (muro solo de token)
  const key = { currency0: USDC_ERC20, currency1: tk, fee: LP_FEE, tickSpacing: TICK_SPACING, hooks: E.ZeroAddress };
  const raiz = Math.pow(1.0001, t.startTick / 2) * 2 ** 96;
  const sq = BigInt(Math.floor(raiz));
  if (sq < MIN_SQRT || sq >= MAX_SQRT) throw new Error("that opening price is outside what a Uniswap pool can hold");
  // la liquidez con un 0,1 % de margen, y el maximo a pagar = todo el saldo: el redondeo nunca pide mas de lo que hay
  const L = liquidityFor(raiz, t.wallLower, t.wallUpper, 0n, (wallTokens * 999n) / 1000n);
  if (L <= 0n) throw new Error("the wall would hold no liquidity");
  const posm = new E.Interface(POSM_ABI);
  const deadline = Math.floor(ahoraSeg || Date.now() / 1000) + 1800;
  const mint = encodeMint(key, t.wallLower, t.wallUpper, L, 0n, wallTokens, owner);
  const llamadas = [
    posm.encodeFunctionData("initializePool", [[key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks], sq]),
    posm.encodeFunctionData("modifyLiquidities", [mint, deadline]),
  ];
  return { key, id: poolId(key), precio, ticks: t, sq, L, multicall: posm.encodeFunctionData("multicall", [llamadas]),
    precioArriba: 10 ** 12 / 1.0001 ** t.wallLower };
}

/* sqrtPriceX96 de la pool en el StateView: 0 = no existe todavia. */
export async function sqrtDePool(id, lector) {
  const sv = new globalThis.ethers.Contract(V4.stateView, STATEVIEW_ABI, lector);
  const [sqrt] = await sv.getSlot0(id);
  return BigInt(sqrt);
}
export { V4 };
