/* ===========================================================================
   EL PASO 6 EN UNISWAP V4, CON LA FABRICA DE BASEY  (18-sep-2026)

   El dueño: "si calcamos el contrato de openlaunch y lo verificamos gmgn deberia
   de reconocerlo ... exactamente lo mismo como lo tenemos pero lanzando v4".

   BaseyLaunchFactoryV4 (contratos-v4/src) hace en UNA transaccion lo que en V3
   eran cuatro firmas: despliega el token (el MISMO bytecode ya verificado: la
   fabrica compara el hash de su codigo de creacion con dos fijados al
   desplegarla), abre la pool V4 USDC/token sin hook, acuña el muro, manda el
   resto del supply al lanzador y hace la compra inicial. Si el muro va
   bloqueado, lo acuña directamente al LaunchLocker, que es copia literal del de
   openlaunch.lol: no tiene NINGUNA funcion para sacar la liquidez, y collect()
   solo reparte comisiones (el 100 % al lanzador).

   Lo que firma el lanzador: aprobar la USDC exacta de la compra a la fabrica, y
   launch(). Nada mas.

   LA USDC ES SIEMPRE currency0: la cara ERC20 (0x3600…, 6 decimales) y el token
   por encima de ella, que es lo que busca findSalt(). Asi el precio de la pool es
   "tokens por USDC" y un tick MAS ALTO es un token MAS BARATO: comprar (USDC
   entra) baja el tick y lo mete en el muro, que esta por debajo del de salida.

   El codigo compilado vive en fabrica-v4-codigo.js, que lo GENERA
   tools/compilar-v4.mjs: no se toca a mano.
   =========================================================================== */
import { CREACION_FABRICA, CODIGO_TOKEN, CODIGO_EDITABLE, HASH_TOKEN, HASH_EDITABLE,
         ABI_FABRICA, ABI_LOCKER } from "./fabrica-v4-codigo.js?v=1";

export { ABI_FABRICA, ABI_LOCKER, HASH_TOKEN, HASH_EDITABLE };

/* LA FABRICA, UNA SOLA VEZ Y PARA TODOS LOS LANZAMIENTOS. Vacia hasta que el
   dueño la despliegue desde la pagina; entonces se escribe aqui (y se verifica
   con su locker en los tres exploradores). Mientras este vacia, la pagina usa la
   que este navegador haya desplegado (ver fabricaGuardada). */
export const FABRICA_V4 = "";

export const USDC_ERC20 = "0x3600000000000000000000000000000000000000";
export const V4_ARC = {
  poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  positionManager: "0x6049c9a0e26405c0985f9e3685c87d0ae917f82b",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};
export const TICK_SPACING = 200;
const MIN_USABLE = -887200, MAX_USABLE = 887200;   // TickMath.min/maxUsableTick(200)

/* ── el despliegue, una vez ─────────────────────────────────────────────── */
export function argsFabrica() {
  return [V4_ARC.poolManager, V4_ARC.positionManager, V4_ARC.permit2, USDC_ERC20, HASH_TOKEN, HASH_EDITABLE];
}
export function datosDespliegue() {
  const args = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "address", "bytes32", "bytes32"], argsFabrica());
  return CREACION_FABRICA + args.slice(2);
}

/* Una fabrica solo se usa si contesta LO QUE ESTA PAGINA ESPERA: los dos hashes
   del token, la USDC y la V4 de Arc. Una direccion equivocada pegada o guardada
   no puede llevarse un lanzamiento a otra parte. `leer(dir, abi, fn, args)` es el
   callRead de la pagina. */
export async function fabricaValida(dir, leer) {
  if (!dir || !ethers.isAddress(dir)) return false;
  try {
    const [t] = await leer(dir, ABI_FABRICA, "tokenCodeHash");
    const [e] = await leer(dir, ABI_FABRICA, "editableCodeHash");
    const [u] = await leer(dir, ABI_FABRICA, "usdc");
    const [pm] = await leer(dir, ABI_FABRICA, "poolManager");
    const [posm] = await leer(dir, ABI_FABRICA, "positionManager");
    return t === HASH_TOKEN && e === HASH_EDITABLE &&
      String(u).toLowerCase() === USDC_ERC20 &&
      String(pm).toLowerCase() === V4_ARC.poolManager &&
      String(posm).toLowerCase() === V4_ARC.positionManager;
  } catch { return false; }
}

/* ── el precio y el muro, en ticks ─────────────────────────────────────── */

/* tick = log_1.0001(tokens crudos por USDC cruda). Mas caro el token, tick mas bajo. */
export function tickDePrecio(usdPorToken, decToken = 18, decUsdc = 6) {
  if (!(usdPorToken > 0) || !isFinite(usdPorToken)) throw new Error("the opening price is not a positive number");
  return Math.log((1 / usdPorToken) * 10 ** (decToken - decUsdc)) / Math.log(1.0001);
}
const alEspaciadoAbajo = (t) => Math.floor(t / TICK_SPACING) * TICK_SPACING;
/* Y al reves: el $ por token de un tick. Es lo que pinta la tabla en V4, para que
   el muro que se ve sea el que se firma (con los bordes ya al espaciado). */
export function precioDeTick(tick, decToken = 18, decUsdc = 6) {
  return 10 ** (decToken - decUsdc) / 1.0001 ** tick;
}

/* El tick de salida NO tiene que ir al espaciado (V4 abre a cualquier precio), asi
   que la pool abre al precio del plan con un error de un tick (0,01 %). Los bordes
   del muro SI, y los dos se redondean hacia abajo: el de arriba queda por debajo
   del de salida (el muro no pide USDC) y el de abajo cubre algo mas de lo pedido. */
export function ticksV4(precio, desde, hasta) {
  const startTick = Math.round(tickDePrecio(precio));
  const wallUpper = alEspaciadoAbajo(tickDePrecio(precio * desde));
  const wallLower = alEspaciadoAbajo(tickDePrecio(precio * hasta));
  if (!(desde >= 1) || !(hasta > desde)) throw new Error("the wall must go from at least 1× the price to above that");
  if (wallUpper > startTick || wallLower >= wallUpper) throw new Error("the wall does not fit below the opening price");
  if (wallLower < MIN_USABLE || startTick > MAX_USABLE) throw new Error("that price is outside what a Uniswap pool can hold");
  return { startTick, wallLower, wallUpper };
}

/* ── lo que firma el lanzador ──────────────────────────────────────────── */

export function codigoDelToken(editable) { return editable ? CODIGO_EDITABLE : CODIGO_TOKEN; }

/* Los argumentos del constructor, codificados como los codifica launch(). */
export function argsTokenCodificados(argsToken) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "string", "uint256", "string", "string", "string"], argsToken);
}

/* Los LaunchParams de launch(), con sus nombres. `argsToken` es argsDelToken(PLAN). */
export function paramsV4({ editable, argsToken, salt, lpFee, ticks, wallTokens, lock, buyUsdc, minTokensOut }) {
  const [name, symbol, wholeSupply, metadataJSON, logo, description] = argsToken;
  return {
    tokenInitCode: codigoDelToken(editable),
    name, symbol, wholeSupply, metadataJSON, logo, description,
    salt,
    lpFee,
    startTick: ticks.startTick, wallLower: ticks.wallLower, wallUpper: ticks.wallUpper,
    wallTokens,
    lockWall: !!lock,
    recipients: [],            // vacio = el 100 % de las comisiones al lanzador
    buyUsdc,
    minTokensOut,
  };
}

/* Una sal al azar para empezar; findSalt() (una eth_call) da la primera derivada
   cuyo token queda por encima de la USDC y sigue libre. */
export function salBase() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return ethers.hexlify(b);
}

/* Lo que dejo el lanzamiento, leido del recibo: el evento Launched de la fabrica. */
export function leerLanzado(rec, fabrica) {
  const iface = new ethers.Interface(ABI_FABRICA);
  for (const l of (rec && rec.logs) || []) {
    if (String(l.address).toLowerCase() !== String(fabrica).toLowerCase()) continue;
    try {
      const ev = iface.parseLog(l);
      if (ev && ev.name === "Launched") {
        return { token: ev.args.token, tokenId: ev.args.tokenId, locked: ev.args.locked, tokensBought: ev.args.tokensBought };
      }
    } catch { /* otro evento */ }
  }
  return null;
}

/* El motivo de un revert de la fabrica o del locker, en palabras. */
const MOTIVOS = {
  UnknownTokenCode: "the token code is not the verified BaseyToken — this page and the factory disagree",
  BadFee: "the pool fee is above 3%",
  BadTicks: "the wall or the opening price is out of range",
  BadWall: "the wall holds no tokens or more than the supply",
  SaltUsed: "that token address is already taken — run again",
  QuoteOrdering: "the token would sort below USDC — run again",
  DeployFailed: "the token could not be deployed",
  NoLiquidity: "the wall is too small to hold any liquidity",
  Slippage: "the first buy would get fewer tokens than expected",
  NotOurLaunch: "that position is not the wall of a token launched with this factory",
  NotPositionOwner: "that position is not in this wallet",
  WallNotIntact: "liquidity was taken out of this wall, so it can no longer be locked as a whole wall",
  NoSaltFound: "no free token address found — run again",
  TransferFailed: "a transfer failed",
  AlreadyRegistered: "this token already has a locked position",
};
/* El nombre del error (o null), mirando donde lo deja ethers segun por donde vino. */
export function nombreErrorV4(e) {
  if (e && e.revert && e.revert.name) return e.revert.name;
  const datos = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
  if (typeof datos === "string" && datos.startsWith("0x") && datos.length >= 10) {
    for (const abi of [ABI_FABRICA, ABI_LOCKER]) {
      try {
        const err = new ethers.Interface(abi).parseError(datos);
        if (err) return err.name;
      } catch { /* no es de este */ }
    }
  }
  return null;
}
export function motivoV4(e) {
  const n = nombreErrorV4(e);
  return n ? (MOTIVOS[n] || n) : null;
}
