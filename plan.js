/* El plan de lanzamiento: un modelo, no una receta fija.
 *
 * La idea que lo ordena todo: eliges el market cap de salida y el supply, y el
 * PRECIO SE CALCULA. Nunca al reves. Un precio de salida es un numero como
 * 1.2479e-11 y teclearlo mal no falla de forma ruidosa -- abre la pool al
 * precio equivocado y te enteras por el grafico, con el dinero ya dentro.
 *
 *     precio = mcapObjetivo / supply
 *
 * Por eso da igual que pongas mil millones o un cuatrillon: sale a $5.000
 * igual, y lo unico que cambia es cuantos ceros tiene el precio.
 */

export const MCAP_POR_DEFECTO = 5000;

/* UN SOLO TRAMO.  (17-sep-2026)
 * El dueño: "ponmelo con un tramo solo, en teoria ya no quedaria". Eran tres
 * muros (30 % de 1,02x a 4x, 30 % de 4x a 20x, 20 % de 20x a 100x) y lo que no
 * cabia en ellos ni en la tesoreria obligaba a preguntar que hacer con el
 * sobrante. Con un muro no sobra nada: lleva TODO lo que no es tesoreria, asi
 * que su porcentaje no se teclea, se deduce (ver pctDelMuro). Va de 1,02x a
 * 100x, el mismo recorrido que cubrian los tres juntos.
 *
 * El `pct` que queda aqui es solo el valor inicial; manda pctDelMuro(). */
export function tramoPorDefecto() {
  return { pct: 85, desde: 1.02, hasta: 100, bloquear: false, meses: 6 };
}

/* Lo que lleva el muro: todo menos la tesoreria. */
export function pctDelMuro(plan) {
  return Math.max(0, 100 - (Number(plan.tesoreríaPct) || 0));
}

export function planPorDefecto() {
  return {
    nombre: "My Token",
    símbolo: "MTK",
    supply: 420690000000000,
    decimals: 18,
    mcapObjetivo: MCAP_POR_DEFECTO,
    fee: 10000,

    // Identidad. Todo esto va dentro del contrato, en metadataURI().
    imagen: "",
    descripción: "",
    web: "",
    twitter: "",
    telegram: "",
    /* IDENTIDAD EDITABLE O RENUNCIA, PERO NO LAS DOS  (18-sep-2026)
     * Con `metadataEditable` queda setMetadataURI() (y setTokenURI(), setLogo() y
     * setDescription()), que son los unicos poderes de dueño del contrato: sirven
     * para arreglar un enlace roto, y tambien para cambiar la identidad entera,
     * que es lo que un comprador tiene que confiar que no haras.
     * Con `renunciar` el dueño se suelta DENTRO del despliegue y `owner()`
     * contesta la direccion cero: es lo que hace que "Renunciado" salga en verde
     * en los rastreadores, y lo que pidio el dueño el 18-sep. Los setters no
     * pueden existir a la vez, asi que por defecto va la renuncia: la identidad ya
     * viaja DENTRO del contrato y no depende de nadie. Si se marca editable, se
     * puede renunciar despues desde "Your tokens" (Drop ownership). */
    metadataEditable: false,
    renunciar: true,

    tramos: [tramoPorDefecto()],

    /* LA COMPRA INICIAL, EN LUGAR DEL SUELO.  (17-sep-2026)
     * El dueño: "en vez de suelo pon compra atomica". Se hace en LA MISMA
     * transaccion que crea la pool (compra-atomica.js), asi que nadie compra
     * antes. Y cumple lo que hacia el suelo: los USDC de esa compra quedan
     * dentro de la pool, y el siguiente que compre ya puede vender. */
    compra: {
      usdc: 2,
    },

    tesoreríaPct: 15,
  };
}

/* Un escalon de tick con fee 10000 son 200 ticks = +2,02% de precio. Un rango
 * que arranca EXACTAMENTE en el precio de salida redondea al mismo tick o por
 * debajo, queda a caballo del precio, y entonces pide USDC -- justo lo que un
 * muro de venta existe para no hacer. Por eso el muro empieza en 1.02 y no en 1. */
export const SEPARACIÓN_MÍNIMA = 1.02;

export function precioDe(plan) {
  return plan.mcapObjetivo / plan.supply;
}

export function repartido(plan) {
  return pctDelMuro(plan);
}

/* Las posiciones que se van a crear, ya con sus cantidades y precios. Esto es
 * lo que ejecuta el runner, y lo que se pinta en la tabla: la misma fuente,
 * para que lo que ves y lo que se firma no puedan separarse. */
/* Con un solo muro que se lleva todo lo que no es tesoreria, no sobra nada.
 * Se conserva la funcion porque app.js la importa. */
export function sobranteDe(plan) {
  return 0;
}

export function posicionesDe(plan) {
  const P0 = precioDe(plan);
  const t = plan.tramos[0];
  const pct = pctDelMuro(plan);
  if (!t || pct <= 0) return [];
  return [{
    id: "muro1",
    etiqueta: "Sell wall",
    tokens: Math.floor((plan.supply * pct) / 100),
    usdc: 0,
    min: P0 * Math.max(t.desde, SEPARACIÓN_MÍNIMA),
    max: P0 * t.hasta,
    bloquear: !!t.bloquear,
    meses: t.meses,
  }];
}

/* Los USDC de la compra inicial, o 0 si no se pide. */
export function compraDe(plan) {
  const v = Number(plan.compra && plan.compra.usdc);
  return isFinite(v) && v > 0 ? v : 0;
}

export function reservasDe(plan) {
  const tes = (plan.supply * plan.tesoreríaPct) / 100;
  const out = [];
  if (tes > 0) out.push({
    etiqueta: "Treasury",
    tokens: tes,
    nota: "for expenses — sold into the pool, never withdrawn as liquidity",
  });
  return out;
}

/* Sin sobrante no hay quema. Se conserva porque resumen() la devuelve. */
export function quemaDe(plan) {
  return 0;
}

export function resumen(plan) {
  const pos = posicionesDe(plan);
  const bloqueos = pos.filter((p) => p.bloquear).length;
  const compra = compraDe(plan);
  return {
    precio: precioDe(plan),
    /* deploy (solo si el plan escribe el token) + aprobar el token + aprobar el
     * USDC de la compra + UNA transaccion que crea la pool, pone el muro y
     * compra (o el lote de siempre si no hay compra) + (locker + enviar el NFT)
     * si se bloquea. Los bloqueos siguen sueltos porque el locker necesita el
     * id del NFT, que no existe hasta que el muro se crea. */
    pasos: (plan.modo === "existente" ? 0 : 1) +
           (pos.some((x) => x.tokens > 0) ? 1 : 0) +
           (compra > 0 ? 1 : 0) +
           1 + bloqueos * 2,
    usdc: compra,
    compra,
    repartido: repartido(plan),
    tesorería: plan.tesoreríaPct,
    libre: Math.max(0, 100 - repartido(plan) - plan.tesoreríaPct),
    bloqueos,
    quema: quemaDe(plan),
    sobrante: sobranteDe(plan),
    posiciones: pos,
    reservas: reservasDe(plan),
  };
}

/* Lo que no cuadra, dicho antes de firmar. Ninguno bloquea el boton: son
 * avisos, igual que en el resto de la pagina. */
export function avisosDe(plan) {
  const out = [];
  const r = repartido(plan);
  if (r === 0) out.push("The treasury takes the whole supply, so the wall holds nothing and the pool opens with nothing to sell.");
  const t = plan.tramos[0];
  if (t && !(t.hasta > Math.max(t.desde, SEPARACIÓN_MÍNIMA))) {
    out.push("The wall ends at or below where it starts. Raise \"to × price\" above \"from × price\".");
  }
  if (compraDe(plan) <= 0) {
    out.push("With no first buy the pool opens without a dollar inside. People can buy, but the first buyer cannot sell until somebody else does.");
  }
  /* Solo si el plan escribe el contrato. Con un token que ya existe, este aviso
   * hablaba de una funcion que el plan no ha puesto y que puede no estar. */
  if (plan.metadataEditable && plan.modo !== "existente") {
    out.push("The identity setters stay in the contract, so you can fix the image and links later. They are the only owner powers this token will have, and until you renounce, a tracker shows this token as NOT renounced. \"Drop ownership\" in Your tokens ends that.");
  }
  if (plan.renunciar && plan.modo !== "existente") {
    out.push("Ownership is dropped inside the deploy transaction, so owner() answers the zero address from the first block and nothing about this token can be changed by anyone, you included. The picture and links are already inside the contract.");
  }
  return out;
}
