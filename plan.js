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

/* Un tramo: que parte del supply lleva, entre que multiplos del precio de
 * salida vive, y si se bloquea y cuanto. */
export function tramoPorDefecto(i) {
  return [
    { pct: 30, desde: 1.02, hasta: 4,   bloquear: false, meses: 6 },
    { pct: 30, desde: 4,    hasta: 20,  bloquear: true,  meses: 6 },
    { pct: 20, desde: 20,   hasta: 100, bloquear: true,  meses: 12 },
  ][i];
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
    // Con esto puesto queda setMetadataURI(), que es el unico poder de dueno
    // del contrato. Permite arreglar un enlace roto -- y tambien cambiar la
    // identidad entera, que es lo que un comprador tiene que confiar que no
    // haras. Se renuncia despues y se acaba la duda.
    metadataEditable: true,

    tramos: [tramoPorDefecto(0), tramoPorDefecto(1), tramoPorDefecto(2)],

    suelo: {
      usdc: 2,
      // El suelo va DEBAJO del precio, asi que lleva solo USDC. Es lo que
      // permite que quien compre pueda salir: sin el, la pool nace sin un
      // dolar dentro y una venta no tiene contra que ejecutarse.
      desde: 0.5,
      hasta: 0.98,
    },

    tesoreríaPct: 15,

    /* QUE PASA CON LO QUE SOBRA.
     *
     * Antes no se preguntaba: lo que no cabia en muros ni tesoreria caia en
     * "Unallocated" y acababa en la cartera del que lanza. Pedir quedarte el 1%
     * y quedarte el 10% sin haberlo elegido es un reparto silencioso, y encima
     * de la cifra que mas mira quien compra. Ahora es una decision con tres
     * respuestas y ninguna por omision. */
    sobrante: "muros",   // "muros" | "quemar" | "guardar"
  };
}

/* Un escalon de tick con fee 10000 son 200 ticks = +2,02% de precio. Un rango
 * que arranca EXACTAMENTE en el precio de salida redondea al mismo tick o por
 * debajo, queda a caballo del precio, y entonces pide USDC -- justo lo que un
 * muro de venta existe para no hacer. Por eso el primero empieza en 1.02 y no
 * en 1, y por eso el suelo acaba en 0.98 y no en 1. */
export const SEPARACIÓN_MÍNIMA = 1.02;

export function precioDe(plan) {
  return plan.mcapObjetivo / plan.supply;
}

export function repartido(plan) {
  return plan.tramos.reduce((a, t) => a + t.pct, 0);
}

/* Las posiciones que se van a crear, ya con sus cantidades y precios. Esto es
 * lo que ejecuta el runner, y lo que se pinta en la tabla: la misma fuente,
 * para que lo que ves y lo que se firma no puedan separarse. */
export function sobranteDe(plan) {
  return Math.max(0, 100 - repartido(plan) - plan.tesoreríaPct);
}

export function posicionesDe(plan) {
  const P0 = precioDe(plan);
  const vivos = plan.tramos.filter((t) => t.pct > 0);
  const sobra = sobranteDe(plan);
  // Repartido a PRORRATA, no a partes iguales: un muro que lleva el 50% recibe
  // el doble que uno del 25%, y la forma del lanzamiento no cambia por rellenar.
  const total = vivos.reduce((a, t) => a + t.pct, 0) || 1;
  const extra = (t) => (plan.sobrante === "muros" ? (sobra * t.pct) / total : 0);
  const out = vivos
    .map((t, i) => ({
      id: "muro" + (i + 1),
      etiqueta: "Sell wall " + (i + 1),
      tokens: Math.floor((plan.supply * (t.pct + extra(t))) / 100),
      usdc: 0,
      min: P0 * Math.max(t.desde, i === 0 ? SEPARACIÓN_MÍNIMA : t.desde),
      max: P0 * t.hasta,
      bloquear: !!t.bloquear,
      meses: t.meses,
    }));
  if (plan.suelo.usdc > 0) {
    out.push({
      id: "suelo",
      etiqueta: "Floor (buy wall)",
      tokens: 0,
      usdc: plan.suelo.usdc,
      min: P0 * plan.suelo.desde,
      max: P0 * Math.min(plan.suelo.hasta, 0.98),
      bloquear: false,
      meses: 0,
    });
  }
  return out;
}

export function reservasDe(plan) {
  const tes = (plan.supply * plan.tesoreríaPct) / 100;
  const sobra = (plan.supply * sobranteDe(plan)) / 100;
  const out = [];
  if (tes > 0) out.push({
    etiqueta: "Treasury",
    tokens: tes,
    nota: "for expenses — sold into the pool, never withdrawn as liquidity",
  });
  // Solo llega aqui si lo has pedido. Ni repartido ni quemado se queda contigo.
  if (sobra > 0 && plan.sobrante === "guardar") {
    out.push({ etiqueta: "Also kept", tokens: sobra, nota: "the leftover, kept on purpose" });
  }
  return out;
}

/* Lo que se quema, si esa es la respuesta. Va a la direccion muerta en su
 * propia transaccion, visible en la cadena para cualquiera. */
export function quemaDe(plan) {
  const sobra = sobranteDe(plan);
  return plan.sobrante === "quemar" && sobra > 0 ? (plan.supply * sobra) / 100 : 0;
}

export function resumen(plan) {
  const pos = posicionesDe(plan);
  const bloqueos = pos.filter((p) => p.bloquear).length;
  return {
    precio: precioDe(plan),
    /* deploy (solo si el plan escribe el token) + UNA aprobacion por moneda +
     * UN lote que lleva dentro la pool y todos los mints + (locker + enviar el
     * NFT) por bloqueo + la quema.
     *
     * La pool ya no cuenta aparte y los mints tampoco: el position manager de
     * Arc tiene multicall(), comprobado en su bytecode, asi que todo eso es una
     * transaccion. Los bloqueos siguen sueltos porque cada uno despliega su
     * propio locker, y meterlos en el lote exigiria adivinar los ids de unos
     * NFT que aun no existen. */
    pasos: (plan.modo === "existente" ? 0 : 1) +
           (pos.some((x) => x.tokens > 0) ? 1 : 0) +
           (pos.some((x) => x.usdc > 0) ? 1 : 0) +
           1 + bloqueos * 2 + (quemaDe(plan) > 0 ? 1 : 0),
    usdc: pos.reduce((a, p) => a + p.usdc, 0),
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
  if (r + plan.tesoreríaPct > 100) {
    out.push("The walls and the treasury add up to " + (r + plan.tesoreríaPct) + "% — more supply than exists. Adjust before launching.");
  }
  if (r === 0) out.push("No wall holds any tokens, so the pool will open with nothing to sell.");
  const sobra = sobranteDe(plan);
  if (sobra > 0 && plan.sobrante === "guardar") {
    out.push("The walls take " + r + "% and the treasury " + plan.tesoreríaPct + "%, so " + sobra +
      "% is left over and you have chosen to keep it — that is " + (sobra + plan.tesoreríaPct) +
      "% in your wallet, not " + plan.tesoreríaPct + "%. It is the first number a buyer looks at.");
  }
  if (sobra > 0 && plan.sobrante === "quemar") {
    out.push(sobra + "% of the supply will be burnt in its own transaction, to the dead address. It cannot be undone and anyone can verify it.");
  }
  if (plan.suelo.usdc <= 0) {
    out.push("With no floor the pool opens without a dollar inside. People can buy, but the first buyer cannot sell until somebody else does.");
  }
  for (let i = 1; i < plan.tramos.length; i++) {
    if (plan.tramos[i].desde < plan.tramos[i - 1].hasta) {
      out.push("Wall " + (i + 1) + " starts below where wall " + i + " ends: they overlap and compete with each other.");
    }
  }
  /* Solo si el plan escribe el contrato. Con un token que ya existe, este aviso
   * hablaba de una funcion que el plan no ha puesto y que puede no estar. */
  if (plan.metadataEditable && plan.modo !== "existente") {
    out.push("setMetadataURI() stays in the contract, so you can fix the image and links later and renounce once you no longer need to. It is the only owner power this token will have.");
  }
  return out;
}
