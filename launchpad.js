/* LANZAR EN NUESTRA PROPIA LANZADERA.
 *
 * ESTO ES EL PASO 8, NO EL 6. El 6 arma un token a medida --sus tramos de
 * liquidez, sus muros, su suelo--; aqui la economia la pone la Factory que
 * desplegamos el 10-sep y no se elige nada de eso. Estuvieron juntos un dia,
 * como dos pestanas del paso 6, y confundia: la tira los presentaba como la
 * misma decision con dos sabores. Son dos productos.
 *
 * LA LANZADERA
 *   0xaF3D9734b6270641237EDCc54a44Db77BDe0B0a4
 *   Es el MISMO bytecode que el CuspFactory v2 de mainnet, comprobado byte a
 *   byte el dia del despliegue: 0 diferencias contra el suyo, y contra el
 *   artefacto compilado solo los 70 bytes de los huecos `immutable`.
 *   Lo unico distinto es `platformWallet`, que vive en almacenamiento y no en
 *   el codigo -- por eso los dos contratos son identicos y aun asi cobran en
 *   sitios distintos.
 *
 * LO QUE NO SE PUEDE HACER, Y HAY QUE DECIRLO EN LA PANTALLA
 *   `setPlatformToken` (en el fuente, `setCuspToken`) es `onlyOwner`, y una
 *   cartera normal solo puede llamar a UNA funcion por transaccion. Asi que
 *   "crear el token y marcarlo en la misma transaccion" no es posible desde
 *   una wallet corriente. Son DOS FIRMAS y ahora tambien DOS BOTONES: uno
 *   lanza y el otro marca. Con un solo boton, si la segunda firma fallaba te
 *   quedabas sin saber si el token quedo puesto o no.
 *
 *   La alternativa seria que el dueño de la Factory fuera un contrato
 *   intermedio que llamara a las dos. Eso significa entregarle la propiedad de
 *   la lanzadera a un contrato, y no compensa por ahorrar una firma.
 *
 * EL METADATA VA EN CRUDO, SIN IPFS
 *   El contrato acepta hasta 60.000 bytes en `metadataURI` y guarda el JSON tal
 *   cual. Es el mismo formato que lee el indexer de Cusp
 *   ({description, twitter, telegram, website, image}), asi que una moneda
 *   lanzada aqui se puede leer con el lector que ya existe.
 */

const FACTORY = "0xaF3D9734b6270641237EDCc54a44Db77BDe0B0a4";
const USDC = "0x3600000000000000000000000000000000000000";

/* Solo lo que este modulo usa. Una ABI corta se lee, una larga se copia mal. */
const FACTORY_ABI = [
  "function launchWithSupply(string name_, string symbol_, string metadataURI_, uint256 supply_, uint16 creatorBurnBps_, address feeRecipient_, uint256 initialBuyPair, uint256 minTokensOut, uint256 deadline) returns (address token, address pool)",
  "function setCuspToken(address t)",
  "function platformWallet() view returns (address)",
  "function cuspToken() view returns (address)",
  "function owner() view returns (address)",
  "function launchCount() view returns (uint256)",
  "function launchesPaused() view returns (bool)",
  /* EL ORDEN ES (token, pool, creator) Y LOS TRES VAN INDEXADOS. La primera
     version de este fichero puso (token, creator, pool) con el pool sin
     indexar, copiado de memoria. Habria decodificado el creador como pool y no
     habria dado ningun error: solo una direccion equivocada en pantalla. */
  "event Launched(address indexed token, address indexed pool, address indexed creator)",
];

/* Para el approve de la compra atomica. */
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
];

/* Los limites son del contrato, no de esta pantalla: si aqui se dejara pasar
   algo que el contrato rechaza, el usuario lo descubriria al firmar. */
export const LIMITES = {
  nombreMax: 60,
  simboloMax: 20,
  metadataMax: 60000,
  burnBpsMax: 10000,
  supplyMax: 10n ** 36n,
  poolFee: 10000,          // 1%
  startMcapUsdc: 5000,     // donde abre
  cuspMcapUsdc: 50000,     // donde gradua
  reparto: { creador: 8000, plataforma: 2000 },
};

export const LANZADERA = FACTORY;

export function contrato(signerOProveedor) {
  return new ethers.Contract(FACTORY, FACTORY_ABI, signerOProveedor);
}

/* ES ESTA CARTERA LA DE LA PLATAFORMA?
   Se le pregunta al CONTRATO, no a una constante escrita aqui. Si algun dia se
   cambia `platformWallet` con su setter, esta pantalla se entera sola. Escribir
   la direccion a mano seria una segunda fuente de verdad, y en este repo eso
   siempre acaba divergiendo. */
export async function esLaPlataforma(cuenta, proveedor) {
  if (!cuenta) return false;
  try {
    const w = await contrato(proveedor).platformWallet();
    return String(w).toLowerCase() === String(cuenta).toLowerCase();
  } catch {
    return false;
  }
}

/* Y si ya hay token de plataforma, la casilla no debe salir: `setCuspToken`
   lleva `require(cuspToken == address(0))` y la segunda vez revierte. */
export async function yaHayTokenDePlataforma(proveedor) {
  try {
    const t = await contrato(proveedor).cuspToken();
    return !/^0x0+$/i.test(String(t));
  } catch {
    return false;
  }
}

/* EL DUENO NO ES LA WALLET DE PLATAFORMA, aunque hoy sean la misma
   direccion. `setCuspToken` es `onlyOwner`; `platformWallet` es solo quien
   cobra. Preguntar por la equivocada dejaria el boton de marcar habilitado
   para alguien que no puede llamarla, y saldria como un revert sin motivo. */
export async function esElDueno(cuenta, proveedor) {
  if (!cuenta) return false;
  try {
    const o = await contrato(proveedor).owner();
    return String(o).toLowerCase() === String(cuenta).toLowerCase();
  } catch {
    return false;
  }
}

/* TODO EL ESTADO DE UNA VEZ, para que la pantalla tenga UNA sola fuente y no
   cinco lecturas que puedan contradecirse. Si falla, falla entera: media
   verdad pintada es peor que decir que no se pudo leer. */
export async function estado(proveedor) {
  const c = contrato(proveedor);
  const [dueno, plataforma, token, cuantos, pausada] = await Promise.all([
    c.owner(), c.platformWallet(), c.cuspToken(), c.launchCount(), c.launchesPaused(),
  ]);
  return {
    dueno, plataforma, token, pausada,
    lanzamientos: Number(cuantos),
    tienePlataforma: !/^0x0+$/i.test(String(token)),
  };
}

/* El JSON que va dentro de `metadataURI`. Las claves son las que lee el indexer
   que ya existe; inventarse otras dejaria la moneda sin redes ni imagen en la
   ficha, sin ningun error visible. */
export function metadata({ description, website, twitter, telegram, image }) {
  const o = {};
  if (description) o.description = String(description).slice(0, 2000);
  if (website) o.website = String(website);
  if (twitter) o.twitter = String(twitter);
  if (telegram) o.telegram = String(telegram);
  if (image) o.image = String(image);
  const s = JSON.stringify(o);
  if (s.length > LIMITES.metadataMax) throw new Error("The metadata is over 60,000 characters.");
  return s;
}

/* Lo que el contrato rechazaria, dicho ANTES de firmar y en el idioma del
   usuario. Cada regla es un `require` del contrato, no una opinion. */
export function revisar(p) {
  const malo = [];
  if (!p.name || p.name.length > LIMITES.nombreMax) malo.push("The name has to be 1 to 60 characters.");
  if (!p.symbol || p.symbol.length > LIMITES.simboloMax) malo.push("The symbol has to be 1 to 20 characters.");
  if (!(p.supply > 0n)) malo.push("The supply has to be greater than zero.");
  if (p.supply > LIMITES.supplyMax) malo.push("The supply is over the contract maximum.");
  if (!(p.creatorBurnBps >= 0 && p.creatorBurnBps <= LIMITES.burnBpsMax))
    malo.push("The share to burn goes from 0 to 100%.");
  if (p.initialBuyPair < 0n) malo.push("The first buy cannot be negative.");
  /* `_buy` lleva `require(pairIn != 0 && minTokensOut != 0, "INPUT")`. O sea
     que con compra atomica, un minimo de cero REVIERTE. Lo dice el contrato,
     no yo, y la primera version de este fichero lo dejaba en cero por defecto:
     habria fallado en la firma con un "INPUT" que no explica nada. */
  if (p.initialBuyPair > 0n && !(p.minTokensOut > 0n))
    malo.push("With a first buy, the minimum tokens has to be greater than zero.");
  return malo;
}

/* LANZAR. Simula con `staticCall` antes de pedir la firma: es gratis y dice si
   va a revertir. La ruta de Cusp no lo hace, pero aqui el usuario esta eligiendo
   nueve parametros a mano y una firma perdida cuesta gas y confianza. */
export async function lanzar(signer, p, avisar = () => {}) {
  const errores = revisar(p);
  if (errores.length) throw new Error(errores.join(" "));

  const c = contrato(signer);
  const cuenta = await signer.getAddress();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const args = [
    p.name, p.symbol, p.metadataURI, p.supply, p.creatorBurnBps,
    p.feeRecipient || cuenta, p.initialBuyPair, p.minTokensOut || 0n, deadline,
  ];

  avisar("Checking that the launchpad accepts this…");
  if (await c.launchesPaused()) throw new Error("The launchpad is paused right now.");

  /* LA COMPRA ATOMICA NO SE PAGA CON `value`: `launchWithSupply` NO ES PAYABLE.
     `_buy` hace `safeTransferFrom(pairToken, buyer, ...)`, o sea que cobra el
     USDC ERC-20 y hace falta APROBAR antes. La primera version de este fichero
     mandaba el importe como `value` y habria revertido en la firma sin decir
     por que -- en Arc el gas es USDC y es facil dar por hecho que todo es
     nativo, pero el contrato pide el ERC-20.

     Y el approve va ANTES de simular: al reves, el `staticCall` revierte por
     falta de permiso y parece que el lanzamiento es malo cuando lo que pasa es
     que no le hemos dejado cobrar. Esa trampa ya esta escrita en cusp-web. */
  if (p.initialBuyPair > 0n) {
    const usdc = new ethers.Contract(USDC, ERC20_ABI, signer);
    const permitido = await usdc.allowance(cuenta, FACTORY);
    if (permitido < p.initialBuyPair) {
      avisar("Approving the USDC for the first buy…");
      const ta = await usdc.approve(FACTORY, p.initialBuyPair);
      await ta.wait();
    }
  }

  avisar("Simulating the launch…");
  let previsto;
  try {
    previsto = await c.launchWithSupply.staticCall(...args);
  } catch (e) {
    throw new Error("The launch would revert: " + (e.shortMessage || e.message || e));
  }

  avisar("Signing the launch…");
  const tx = await c.launchWithSupply(...args);
  avisar("Waiting for it to land…");
  const rec = await tx.wait();

  /* La direccion sale del EVENTO, no de la simulacion: entre simular y minar
     puede haber entrado otro lanzamiento y el salt lleva `saltNonce` dentro. */
  let token = null, pool = null;
  for (const log of rec.logs) {
    try {
      const e = c.interface.parseLog({ topics: log.topics, data: log.data });
      if (e && e.name === "Launched") { token = e.args.token; pool = e.args.pool; }
    } catch { /* logs de otros contratos */ }
  }
  if (!token && previsto) token = previsto[0];
  return { token, pool, hash: tx.hash };
}

/* MARCARLO COMO TOKEN DE LA PLATAFORMA. Segunda firma, y NO HAY TERCERA:
   el contrato lleva `require(cuspToken == address(0))`. */
export async function marcarComoPlataforma(signer, token, avisar = () => {}) {
  const c = contrato(signer);
  const yaEsta = await c.cuspToken();
  if (!/^0x0+$/i.test(String(yaEsta))) {
    throw new Error("This launchpad already has a platform token (" + yaEsta + ") and it cannot be changed.");
  }
  avisar("Simulating the mark…");
  try {
    await c.setCuspToken.staticCall(token);
  } catch (e) {
    throw new Error("Cannot mark it: " + (e.shortMessage || e.message || e));
  }
  avisar("Signing the mark. This cannot be undone…");
  const tx = await c.setCuspToken(token);
  await tx.wait();
  return tx.hash;
}
