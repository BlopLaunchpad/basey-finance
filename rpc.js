/* ── Los nodos de Arc, en orden ──────────────────────────────────────────
 *
 * UN PROVEEDOR DE ETHERS QUE NO SE CASA CON UN NODO.  (14-sep-2026)
 *
 * Hasta este día `proveedorRPC()` era un JsonRpcProvider clavado en
 * rpc.arc-scan.org, y por él pasaba TODO lo que firma la rápida y el clúster,
 * además del Quoter y los recibos. El dueño, en pleno pico de volumen: "da
 * error 500, no me deja sacar los 80 que tengo en la rápida ni comprar".
 *
 * MEDIDO ESE DÍA (06:34 UTC, desde Node, 8 rondas de las llamadas que hacen una
 * retirada y una compra -- nonce, estimateGas, gas, bloque, eth_call, saldo,
 * recibo -- más el lote de 4 que ethers manda al preparar una transacción):
 *
 *   rpc.arc-scan.org         28 de 96 con HTTP 503 y -32603 "arc-scan.org could
 *                            not complete this request. No answer was obtained,
 *                            so nothing about the result should be assumed".
 *                            Hasta su preflight CORS dio 503.
 *   thecusp.io/api/arc-rpc   77 de 80 bien sin contar estimateGas; los 3 malos,
 *                            429 "arc-scan.org is rate limiting" que el proxy
 *                            deja pasar. estimateGas: 6 de 8 "Please contact
 *                            thirdweb support" (lo reenvía a un nodo de
 *                            thirdweb). CORS 204 con allow-origin *.
 *   niorfun.com/api/rpc      vivo pero cojo: 11 de 96 sin respuesta en 10 s y
 *                            un "all upstreams unavailable". Va el ÚLTIMO.
 *   ac-rpc.theleak.cx        409 a las 88 llamadas sueltas. Fuera.
 *   brc.exchange/api/rpc     contesta todo, pero SIN access-control-allow-origin:
 *                            un navegador no lo puede leer nunca. Fuera.
 *   5042.rpc.thirdweb.com    429 "public-good RPC with strict rate limits" o
 *                            "contact thirdweb support" en las 96. Fuera.
 *
 * Y ethers pinta ese 503 como "server response 503" -- en un navegador con
 * HTTP/2 ni siquiera trae el texto de estado --, que es lo más parecido a
 * "error 500 noseque" que sale de esta cadena. rawCall ya rotaba, así que los
 * saldos se veían bien y la rápida parecía sana: lo que moría era firmar.
 *
 * EN ORDEN, NO POR TURNOS.  (14-sep, tras la revisión adversarial)
 * La primera versión rotaba nodo en cada petición, y eso metía nodos atrasados
 * en lo que depende del estado: el nonce, el saldo de "vender todo", la
 * cotización del amountOutMinimum. Medido ese día, eth_blockNumber a la vez en
 * los tres: desde https://basey.finance niorfun llegó a ir 54 bloques (~27 s)
 * detrás de arc-scan; en 12 rondas desde Node, thecusp iba 0-7 detrás (su
 * proxy guarda eth_blockNumber 1,5 s) y niorfun 0-23. Con la rotación niorfun
 * daba la primera lectura de 43 preparaciones de cada 150 y se llevaba el envío
 * detrás. Ahora se pregunta en el orden de NODOS_ARC -- arc-scan primero, que es
 * lo que hacía el código de antes cuando contestaba -- y el siguiente sólo
 * cuando el anterior falla o está castigado.
 *
 * TRES NODOS, PERO NO TRES SALIDAS.  DNS por 1.1.1.1, 14-sep:
 *   thecusp.io          188.114.96.5, 188.114.97.5
 *   niorfun.com         188.114.96.5, 188.114.97.5     <- las MISMAS dos
 *   rpc.arc-scan.org    104.21.49.38, 172.67.141.71
 * Los tres van por Cloudflare, que LaLiga bloquea en España los días de
 * partido. Un bloqueo de esas dos IPs se lleva thecusp Y niorfun juntos, y
 * queda arc-scan con sus 503: la lista NO es independiente, y por eso thecusp
 * tampoco puede ir solo. Los únicos RPC de Arc fuera de Cloudflare que salieron
 * (brc.exchange 45.77.45.17, ac-rpc.theleak.cx 78.17.213.109) no sirven desde
 * un navegador, ver arriba. Uno propio fuera de Cloudflare necesita un servidor
 * con su propio certificado: queda pendiente, y no es un cambio de este repo.
 *
 * CADA NODO DICE SU CADENA, Y UNA CABEZA SUELTA NO MANDA.  (14-sep, tercera
 * revisión adversarial) Con un nodo de la lista sirviendo OTRA cadena -- un
 * proxy mal apuntado, una testnet --, bastaba UNA lectura en la que arc-scan
 * diese 503 y thecusp 429 para que su cabeza (+1.000.000) pasara a ser el techo:
 * los nodos buenos quedaban "atrasados" y ese nodo servía el saldo 0, el nonce
 * 150, las comisiones, y recibía el envío. Ahora:
 *   - ninguna respuesta de un nodo se usa hasta que ese nodo ha contestado
 *     eth_chainId = 5042 una vez en esta página. La pregunta va DENTRO del
 *     primer lote que se le manda (sin viaje de más), sólo se guarda el acierto,
 *     y el nodo que contesta otra cadena queda fuera hasta recargar;
 *   - un nodo solo no sube el techo más de lo que la cadena ha podido avanzar
 *     (0,5 s por bloque) más 120 bloques, salvo que otro nodo verificado diga lo
 *     mismo con 20 bloques de margen. La primera cabeza de la página sí puede
 *     venir de uno solo;
 *   - lo atrasado sólo sirve de respaldo a 600 bloques (5 min) o menos del
 *     techo; más atrás se falla como fallaba el código de antes.
 *
 * El 16-sep abre la red pública de Arc; ni docs.arc.io ni comparenodes.com
 * listaban hoy un RPC público de mainnet (5042) aparte de arc-scan.
 */

/* EL ORDEN ES LA PRIORIDAD: se lee del primero sano, y niorfun el último. */
export const NODOS_ARC = [
  "https://rpc.arc-scan.org",
  "https://thecusp.io/api/arc-rpc",
  "https://niorfun.com/api/rpc",
];

/* LOS TIEMPOS, y de dónde salen.
 *   lectura        8 s   arc-scan contesta en 70-460 ms de mediana; lo que no ha
 *                        contestado en 8 s no va a hacerlo (niorfun: o 200 ms o
 *                        más de 10 s).
 *   lecturaProxy  10 s   SÓLO thecusp.io. Su proxy tiene 9,5 s de presupuesto
 *                        propio (TOTAL_BUDGET_MS en cusp-web/api/arc-rpc.js), y
 *                        desde https://basey.finance un eth_call suyo tardó
 *                        9.169 ms y trajo el valor bueno: con 8 s se tiraba esa
 *                        respuesta y encima se castigaba al nodo por darla. Tres
 *                        nodos colgados son 26 s, no los 300 s de ethers.
 *   envío         20 s   aquí cortar pronto es PEOR: un envío sin respuesta no se
 *                        reintenta (ver `enviar`), así que cada segundo de espera
 *                        es una respuesta de verdad en vez de un "no se sabe".
 *   castigo       15 s   el mismo que cusp-web/api/arc-rpc.js: el nodo que acaba
 *                        de fallar pasa al final de la cola un rato, sin echarlo.
 *   preflight      4 s   sin Access-Control-Max-Age, Chrome guarda un preflight
 *                        CORS 5 s, y thecusp no lo manda (medido: 204 sin
 *                        max-age). Un envío a thecusp tras más de 4 s sin hablarle
 *                        va precedido de una lectura, ver `enviar`.
 *   bloqueReciente 30 s  cuánto sirve el último bloque visto como bloque de
 *                        partida de una transacción ya aceptada (ver `_send`). Arc
 *                        hace un bloque cada 0,5 s -- medido --: son ~60 bloques
 *                        que ethers sólo recorrería si la transacción fuese
 *                        reemplazada.
 *   sinConfirmar   5 min tope del aviso "ya se envió" en los errores de lectura
 *                        cuando esta página no llega a leer el recibo. Es una
 *                        cota, no una medida.
 *   nonceMinimo   60 s   vida del suelo de nonce "pending" que deja un envío
 *                        aceptado (ver `leer`). Es lo que tarda en propagarse una
 *                        transacción entre nodos, con holgura: pasado eso, un nodo
 *                        que sigue dando el nonce viejo no va atrasado, es que la
 *                        transacción se cayó del mempool. Cota, no medida.
 *   techo         30 s   vida del bloque más alto visto si ningún nodo vuelve a
 *                        llegar a él. A 0,5 s por bloque son 60 bloques: un techo
 *                        de hace más de 30 s ya no sirve para decir quién va
 *                        atrasado, y uno que nadie alcanza es un techo falso.
 *   getLogs       12 s   el reloj que rawCall tuvo siempre, sólo para eth_getLogs:
 *                        un rango grande tarda de verdad (2.000 bloques, 2,6 s
 *                        desde el droplet) y eso no es un nodo colgado.
 *   segundaOpinion 2 s   el reloj de los nodos que quedan cuando ya hay en la mano
 *                        un respaldo para todo lo que falta (un nonce por debajo
 *                        del suelo, una lectura atrasada pero cercana). Con
 *                        thecusp y niorfun colgados eran 10 + 8 s de espera para
 *                        acabar devolviendo lo que ya se tenía; y el nodo que
 *                        falló hace menos de `castigo` ni se pregunta. arc-scan
 *                        contesta en 70-460 ms: es una cota, no una medida.
 * Es un objeto y no constantes sueltas para que la prueba los encoja. */
export const TIEMPOS = {
  lecturaMs: 8000, lecturaProxyMs: 10000, envioMs: 20000, castigoMs: 15000,
  preflightMs: 4000, bloqueRecienteMs: 30000, sinConfirmarMs: 300000, getLogsMs: 12000,
  nonceMinimoMs: 60000, techoMs: 30000, segundaOpinionMs: 2000,
};

/* EL MARGEN DE ALTURA. Una respuesta que trae la cabeza de su nodo (un
 * eth_blockNumber, un eth_getBlockByNumber "latest") y la trae más de 10 bloques
 * por DEBAJO del bloque más alto que ya se había visto ANTES de preguntarle, no
 * se cree: el nodo va atrasado seguro, porque la cadena no retrocede. Se compara
 * con lo visto antes de mandar la petición y no al recibirla, para que una
 * respuesta lenta pero buena no parezca vieja. 10: thecusp va 0-7 detrás en uso
 * normal y pasa; niorfun, en sus peores rondas (23 y 54), no. */
export const MARGEN_BLOQUES = 10;

/* LA CABEZA CREÍBLE. Arc hace un bloque cada 0,5 s (medido): un nodo solo no
 * sube el techo más que eso por el tiempo pasado desde la cabeza más alta que se
 * creyó, más SALTO_BLOQUES (un minuto de cadena) de holgura. Por encima hace
 * falta que otro nodo verificado haya dicho lo mismo con ACUERDO_BLOQUES de
 * margen. */
export const MS_POR_BLOQUE = 500;
export const SALTO_BLOQUES = 120;
export const ACUERDO_BLOQUES = 20;

/* EL RESPALDO ATRASADO. Lo que se aparta por ir detrás del techo sólo se
 * devuelve si su nodo va a 600 bloques (5 min de cadena) o menos: más atrás es
 * un saldo, un nonce o una cotización que ya no se parecen a los de ahora. */
export const ATRASO_MAXIMO = 600;

/* Ethers junta en un lote las lecturas que coinciden (por defecto hasta 100).
 * arc-scan y el proxy aceptan 50 como mucho, pero niorfun.com/api/rpc rechaza
 * todo lote de más de 20: "-32600 Batch too large (max 20)", medido desde
 * https://basey.finance el 14-sep. Con 25, el lote grande de un clúster que
 * cayese en niorfun fallaba entero. El eth_chainId de la primera vez va dentro
 * del lote si cabe, y si el lote ya trae 20, va solo antes (ver `preguntar`). */
export const LOTE_MAXIMO = 20;

/* SIN PREFLIGHT. text/plain es un content-type "simple" de CORS: el navegador no
 * manda OPTIONS antes, así que no hay preflight que pueda fallar antes de un
 * envío -- un preflight fallido da el mismo "Failed to fetch" que una conexión
 * cortada a mitad, y un envío así se tenía que dar por dudoso aunque el POST no
 * hubiese salido. Medido desde Origin https://basey.finance: arc-scan y niorfun
 * contestan un POST text/plain igual que uno JSON; thecusp contesta 400
 * "Expected a JSON-RPC body" (su handler exige JSON), así que sigue con
 * application/json y su lectura previa.
 * Y medido desde una página, 8 rondas con un lote de 3 mandado a la vez como
 * JSON y como text/plain: arc-scan 4 de 8 con los dos tipos (sus 503 caen en
 * el mismo instante a los dos), niorfun 6 de 8 con los dos (un timeout
 * compartido y uno suelto en cada tipo). Los fallos son del nodo, no del tipo. */
export const SIN_PREFLIGHT = new Set(["rpc.arc-scan.org", "niorfun.com"]);
const PROXY_CON_PRESUPUESTO = "thecusp.io";

const METODOS_DE_ENVIO = new Set(["eth_sendRawTransaction", "eth_sendTransaction"]);

/* La pregunta de la cadena. Id numérico -- ac-rpc.theleak.cx se come los de
 * texto -- y fuera del rango de ethers, cuyos ids empiezan en 1 y suben de uno
 * en uno. */
const ID_CADENA = 1504205042;
const PREGUNTA_CADENA = { jsonrpc: "2.0", id: ID_CADENA, method: "eth_chainId", params: [] };

/* EL RECHAZO LIMPIO: el nodo dijo que no ANTES de mirar la petición. Misma
 * lista que `esRechazoLimpio` en cusp-web/api/arc-rpc.js. */
const RECHAZO_LIMPIO = /rate limit|too many requests|exceeded quota|out of capacity|method disabled|not supported|unsupported method|does not support|api key|unauthorized|restricted/i;

export function esRechazoLimpio(err) {
  if (!err) return false;
  if (err.code === -32601) return true; // método no encontrado: ni lo miró
  return RECHAZO_LIMPIO.test(String(err.message || ""));
}

/* LO QUE CONTESTA LA CADENA, que ningún otro nodo va a contestar distinto y por
 * eso no se reintenta. Copiada de cusp-web/api/arc-rpc.js con UNA diferencia
 * medida: el código -32005 NO cuenta como respuesta de la cadena. arc-scan lo
 * usa para "arc-scan.org is rate limiting requests from this client" (visto hoy
 * a través del propio proxy, que por eso deja pasar ese 429 en vez de probar el
 * siguiente nodo). Aquí manda el texto, y el texto de un límite de tasa gana. */
const RESPUESTAS_DE_LA_CADENA = [
  /execution reverted/i,
  /insufficient funds/i,
  /nonce too low|nonce too high|invalid nonce/i,
  /already known|replacement transaction underpriced|transaction underpriced/i,
  /gas required exceeds|intrinsic gas too low|exceeds block gas limit|out of gas/i,
  /max fee per gas|fee cap|tip.{0,20}higher than/i,
  /invalid argument|invalid params|invalid opcode|invalid sender/i,
  /query returned more than|response size exceeded|too many results/i,
  /block range|range too large|exceed maximum block range/i,
  /header not found|unknown block|missing trie node/i,
];

export function esRespuestaDeLaCadena(err) {
  if (!err || typeof err !== "object") return false;
  if (esRechazoLimpio(err)) return false;
  if (err.code === 3 || err.code === -32614) return true;
  const m = String(err.message || "");
  return RESPUESTAS_DE_LA_CADENA.some((re) => re.test(m));
}

/* "La misma transacción ya la tengo". Con \b delante: sin él, /known transaction/
 * casaba DENTRO de "unknown transaction type" -- un rechazo -- y el envío se
 * daba por aceptado, con su suelo de nonce y su aviso de "ya se envió", sin que
 * ningún nodo la hubiese aceptado (revisión adversarial, 14-sep). */
const YA_LA_TIENE = /\b(?:already known|known transaction|already imported)\b/i;
const NONCE_BAJO = /nonce too low/i;
const HASH_32 = /^0x[0-9a-f]{64}$/i;

const corto = (s) => String(s || "").replace(/\s+/g, " ").slice(0, 90);
const hostDe = (u) => { try { return new URL(u).host; } catch { return String(u); } };
const plazoLectura = (u) => (hostDe(u) === PROXY_CON_PRESUPUESTO ? TIEMPOS.lecturaProxyMs : TIEMPOS.lecturaMs);
const clave = (id) => String(id);
const numero = (hex) => { try { return typeof hex === "string" ? Number(BigInt(hex)) : null; } catch { return null; } };

/* Un POST con su propio reloj. El reloj cubre también la lectura del cuerpo:
 * un nodo que manda cabeceras y se queda mudo es un nodo colgado igual. */
async function pedir(fetchFn, url, cuerpo, ms) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": SIN_PREFLIGHT.has(hostDe(url)) ? "text/plain" : "application/json" },
      body: JSON.stringify(cuerpo),
      signal: ctrl.signal,
    });
    const texto = await res.text();
    let json;
    try { json = JSON.parse(texto); } catch { json = undefined; }
    return { tipo: "http", status: res.status, json };
  } catch (e) {
    return { tipo: ctrl.signal.aborted ? "timeout" : "red", detalle: corto(e && e.message) };
  } finally {
    clearTimeout(reloj);
  }
}

/* La respuesta que corresponde a una petición, por id. Si se preguntó UNA sola
 * cosa y vuelve un objeto SIN id, se acepta: hay nodos que se lo comen (theleak
 * con ids de texto, documentado en arc-rpc.js; y el 503 de arc-scan trae
 * "id":null). Un id PRESENTE y distinto no: eso es la respuesta a otra
 * petición, y se trata como un fallo del nodo. Se compara como texto para que
 * un 7 y un "7" sean el mismo id. */
function respuestasPorId(json, pedidas) {
  const porId = new Map();
  const lista = Array.isArray(json) ? json : (json && typeof json === "object" ? [json] : []);
  for (const x of lista) if (x && typeof x === "object" && x.id != null) porId.set(clave(x.id), x);
  if (pedidas.length === 1 && json && typeof json === "object" && !Array.isArray(json) && json.id == null) {
    porId.set(clave(pedidas[0].id), json);
  }
  return porId;
}

/* La cabeza del nodo que contesta, si la petición la pedía. Un recibo NO vale
 * aquí: el de una transacción vieja trae un bloque viejo de un nodo al día. */
function cabezaQueTrae(p, result) {
  if (result == null) return null;
  if (p.method === "eth_blockNumber") return numero(result);
  if (p.method === "eth_getBlockByNumber" && p.params && p.params[0] === "latest" && typeof result === "object") {
    return numero(result.number);
  }
  return null;
}

export function crearProveedorRotativo(ethers, nodos, opciones = {}) {
  const chainId = opciones.chainId ?? 5042;
  /* Se busca `fetch` en cada llamada, no al crear: así una página que lo
   * envuelva después (o una prueba) también pasa por aquí. */
  const fetchFn = opciones.fetch || ((u, init) => globalThis.fetch(u, init));

  const castigados = new Map();       // url -> hasta cuándo
  const ultimaRespuesta = new Map();  // url -> cuándo contestó algo por última vez
  const historialEnvios = new Map();  // url -> últimos 10 envíos: true la miró, false no se sabe
  const nonceMinimo = new Map();      // cartera -> { n, t }: nonce "pending" por debajo del cual un nodo va atrasado
  const sinConfirmar = new Map();     // hash aceptado -> { t, desde }; sale al leer su recibo
  const cadenaBuena = new Set();      // url que ya contestó eth_chainId = chainId en esta página (sólo aciertos)
  const excluidos = new Map();        // url -> motivo: contestó otra cadena, y queda fuera hasta recargar
  const saltos = new Map();           // url -> { n, t }: su última cabeza que no se creyó por subir de más
  let techo = null;                   // { n, t, fuentes }: el bloque más alto creído, cuándo lo alcanzó uno, y quiénes
  let cumbre = null;                  // { n, t }: la cabeza más alta creída; `leer` baja el techo, no la cumbre

  const castigar = (u) => castigados.set(u, Date.now() + TIEMPOS.castigoMs);
  const castigado = (u) => {
    const hasta = castigados.get(u);
    if (!hasta) return false;
    if (Date.now() >= hasta) { castigados.delete(u); return false; }
    return true;
  };
  /* EL TECHO CADUCA. Antes sólo subía: UNA respuesta falsa muy por delante
   * (cabeza + 100.000) dejaba a todos los nodos honrados "atrasados" y
   * getBlockNumber, getFeeData y cada preparación de envío fallaban en todas
   * las carteras hasta que la cadena llegase ahí -- ~14 h --, con los saldos
   * viéndose bien (revisión adversarial, 14-sep). Ahora un techo que ningún
   * nodo alcanza en TIEMPOS.techoMs deja de hacer de suelo, y `leer` lo baja en
   * cuanto todos los que contestan quedan por debajo. */
  const techoVigente = () => !!techo && Date.now() - techo.t <= TIEMPOS.techoMs;
  const sueloAhora = () => (techoVigente() ? techo.n - MARGEN_BLOQUES : null);

  /* ¿SE CREE ESTA CABEZA?  (tercera revisión, 14-sep) Y si se cree, cuenta para
   * el techo. Por debajo siempre (lo atrasado lo decide `leer`). Por encima,
   * sólo hasta donde la cadena ha podido llegar desde la cumbre -- un bloque por
   * MS_POR_BLOQUE, más SALTO_BLOQUES --, salvo que otro nodo verificado haya
   * dicho lo mismo hace poco. La primera cabeza de la página se cree sola.
   * La cumbre no baja cuando `leer` baja el techo por nodos atrasados: si lo
   * hiciera, el nodo al día que vuelve tras un rato de nodos lentos quedaría
   * "demasiado adelantado" para siempre. */
  function creerCabeza(n, url) {
    if (n == null) return true;
    const ahora = Date.now();
    let otro = null;
    if (cumbre && n > cumbre.n + (ahora - cumbre.t) / MS_POR_BLOQUE + SALTO_BLOQUES) {
      for (const [u, x] of saltos) {
        if (u !== url && ahora - x.t <= TIEMPOS.techoMs &&
            Math.abs(n - x.n) <= ACUERDO_BLOQUES + (ahora - x.t) / MS_POR_BLOQUE) otro = u;
      }
      if (!otro) { saltos.set(url, { n, t: ahora }); return false; }
      saltos.delete(otro);
    }
    saltos.delete(url);
    if (!cumbre || n >= cumbre.n) cumbre = { n, t: ahora };
    if (!techo || (n < techo.n && !techoVigente())) {
      techo = { n, t: ahora, fuentes: new Set([url]) };
    } else if (n >= techo.n) {
      techo = { n, t: ahora, fuentes: n - techo.n <= ACUERDO_BLOQUES ? new Set([...techo.fuentes, url]) : new Set([url]) };
    } else if (n >= techo.n - ACUERDO_BLOQUES) {
      techo.fuentes.add(url);
    }
    if (otro) techo.fuentes.add(otro);
    return true;
  }
  const esNoncePendiente = (p) => p.method === "eth_getTransactionCount" && !!p.params && p.params[1] === "pending";
  const carteraDe = (p) => String(p.params[0]).toLowerCase();
  const sueloNonce = (cartera) => {
    const x = nonceMinimo.get(cartera);
    if (!x) return null;
    if (Date.now() - x.t > TIEMPOS.nonceMinimoMs) { nonceMinimo.delete(cartera); return null; }
    return x.n;
  };

  /* Lecturas: en el orden de la lista, los castigados al final. Si están todos
   * castigados se usan igual: un nodo malo es mejor que ninguno. Uno de otra
   * cadena, en cambio, no se usa nunca: ver `comprobarCadena`. */
  const vivos = () => nodos.filter((u) => !excluidos.has(u));
  function ordenLectura() {
    const lista = vivos();
    return [...lista.filter((u) => !castigado(u)), ...lista.filter(castigado)];
  }

  /* Envíos: primero el sano con MEJOR historial de envíos -- el que menos veces
   * dejó uno en "no se sabe" de los últimos 10 --, y a igualdad, el orden de la
   * lista. El último de la lista (niorfun: se cuelga, va atrasado y comparte IPs
   * con thecusp) nunca va primero mientras haya otro sano; si es el único sano,
   * va antes que los castigados. */
  const tasaDeDudas = (u) => {
    const h = historialEnvios.get(u) || [];
    return h.length ? h.filter((x) => !x).length / h.length : 0;
  };
  const apuntarEnvio = (u, bien) => {
    const h = historialEnvios.get(u) || [];
    h.push(bien);
    if (h.length > 10) h.shift();
    historialEnvios.set(u, h);
  };
  function ordenEnvio() {
    const ultimo = nodos[nodos.length - 1];
    const lista = vivos();
    const sanos = lista.filter((u) => !castigado(u))
      .map((u, i) => [u, i])
      .sort((a, b) => tasaDeDudas(a[0]) - tasaDeDudas(b[0]) || a[1] - b[1])
      .map(([u]) => u);
    if (sanos[0] === ultimo && sanos.length > 1) sanos.push(sanos.shift());
    return [...sanos, ...lista.filter(castigado)];
  }

  /* Un error que NO es de la cadena sino de los nodos. Lleva una marca para que
   * `getRpcError` lo entregue con su frase: si llegara a ethers tal cual, la
   * pantalla diría "could not coalesce error" o "missing revert data", que es
   * justo la clase de mensaje que no deja saber qué pasó. */
  const errorDeNodo = (id, message, extra) =>
    ({ jsonrpc: "2.0", id, error: { code: -32000, message, data: { nodoArc: true, ...extra } } });
  const esErrorDeNodo = (r) => !!(r && r.error && r.error.data && r.error.data.nodoArc);

  /* "TRY AGAIN" SÓLO SI NO HAY NADA ENVIADO SIN CONFIRMAR. Un error de lectura
   * justo después de un envío aceptado -- el eth_blockNumber que ethers pide con
   * él, el primer recibo de tx.wait() -- decía "Try again in a moment", y en la
   * rápida volver a pulsar es firmar OTRA: la segunda retirada, la compra doble.
   * Mientras esta página no haya leído el recibo de lo que envió, el error lo
   * dice con su hash.
   * PERO SÓLO EN LO QUE TIENE QUE VER CON ESE ENVÍO: una lectura del mismo lote
   * que el envío (`relacionados`, desde `_send`) o una cuyos parámetros nombran
   * su hash o su cartera. Antes salía en TODO error de lectura durante 5 min,
   * también en el saldo de otra cartera del clúster, y un aviso que sale en todo
   * deja de leerse (revisión adversarial, 14-sep). */
  function coletilla(p, relacionados) {
    let ultima = null;
    const ahora = Date.now();
    const params = JSON.stringify((p && p.params) || []).toLowerCase();
    for (const [h, x] of sinConfirmar) {
      if (ahora - x.t > TIEMPOS.sinConfirmarMs) { sinConfirmar.delete(h); continue; }
      if ((relacionados && relacionados.has(h)) || params.includes(h) ||
          (x.desde && params.includes(x.desde.slice(2)))) ultima = h;
    }
    return ultima
      ? " Transaction " + ultima + " was already sent from this page and this page has not seen it confirmed: do not send it again, check the balance first."
      : " Try again in a moment.";
  }
  const nadieContesto = (p, fallos, relacionados) =>
    errorDeNodo(p.id, "No Arc node answered " + p.method + " just now (" + fallos + ")." + coletilla(p, relacionados), { fallos });

  /* ── LA CADENA DE CADA NODO ────────────────────────────────────────────
   * Lo que dice una respuesta sobre la cadena del nodo que la manda: null si es
   * Arc (o ya se sabía), { motivo } si no lo ha demostrado, y { motivo, otra }
   * si contestó OTRA cadena, que lo deja fuera hasta recargar. Sólo se guarda el
   * acierto: un error al preguntar no dice nada de la cadena, y se vuelve a
   * preguntar en el siguiente lote a ese nodo. */
  function comprobarCadena(url, r, porId) {
    if (cadenaBuena.has(url)) return null;   // otra petición en vuelo ya la comprobó
    const x = porId.get(clave(ID_CADENA));
    const n = r.status >= 200 && r.status < 300 && x && !x.error ? numero(x.result) : null;
    if (n === Number(chainId)) { cadenaBuena.add(url); return null; }
    if (n != null) {
      const motivo = hostDe(url) + " answered chain id " + n + ", not Arc's " + chainId + ", and is not used again on this page";
      excluidos.set(url, motivo);
      return { motivo, otra: true };
    }
    /* Sin su elemento, el error que traiga el cuerpo: el 503 de arc-scan contesta
     * un lote con "id": null en cada uno, y sin esto el motivo perdía su texto. */
    const suelto = [].concat(r.json).find((y) => y && typeof y === "object" && y.error && typeof y.error === "object");
    const err = x && x.error && typeof x.error === "object" ? x.error : suelto ? suelto.error : null;
    return { motivo: hostDe(url) + " HTTP " + r.status +
      (err ? " \"" + corto(err.message) + "\"" : r.status >= 200 && r.status < 300 ? " without confirming its chain id" : "") };
  }

  /* UNA PREGUNTA A UN NODO, con su cadena comprobada. Si aún no la ha dicho en
   * esta página, eth_chainId va DENTRO del mismo lote: no cuesta un viaje. Sólo
   * si el lote ya trae LOTE_MAXIMO va sola antes, y eso pasa una vez. Devuelve
   *   { r }            sin respuesta HTTP (timeout, red caída)
   *   { r, cadena }    no se puede usar nada de este nodo (ver comprobarCadena)
   *   { r, porId }     las respuestas por id, sin la del eth_chainId */
  async function preguntar(url, peticiones, ms) {
    if (excluidos.has(url)) return { r: { tipo: "http", status: 0 }, cadena: { motivo: excluidos.get(url), otra: true } };
    if (!cadenaBuena.has(url) && peticiones.length >= LOTE_MAXIMO) {
      const r = await pedir(fetchFn, url, PREGUNTA_CADENA, ms);
      if (r.tipo !== "http") return { r };
      ultimaRespuesta.set(url, Date.now());
      const cadena = comprobarCadena(url, r, respuestasPorId(r.json, [PREGUNTA_CADENA]));
      if (cadena) return { r, cadena };
    }
    const conCadena = !cadenaBuena.has(url);
    const lote = conCadena ? [PREGUNTA_CADENA, ...peticiones] : peticiones;
    const r = await pedir(fetchFn, url, lote.length === 1 ? lote[0] : lote, ms);
    if (r.tipo !== "http") return { r };
    ultimaRespuesta.set(url, Date.now());
    const porId = respuestasPorId(r.json, lote);
    if (conCadena) {
      const cadena = comprobarCadena(url, r, porId);
      porId.delete(clave(ID_CADENA));
      if (cadena) return { r, cadena };
    }
    return { r, porId };
  }

  /* Sólo la cadena, para quien no la ha dicho aún y va a recibir un envío. */
  async function confirmarCadena(url) {
    if (cadenaBuena.has(url)) return {};
    const { r, cadena } = await preguntar(url, [], plazoLectura(url));
    if (r.tipo !== "http") return { motivo: hostDe(url) + (r.tipo === "timeout" ? " timed out" : " unreachable") };
    return cadena ? { motivo: cadena.motivo } : {};
  }

  /* ── LECTURAS: se reintenta todo lo que no sea la cadena contestando ──
   * 429, 5xx, timeout, red caída, cuerpo que no es JSON, "out of capacity",
   * "rate limit", "could not complete this request"... Todo eso es un nodo que
   * no pudo, y para eso hay más. En un lote sólo se repiten los que fallaron.
   * Y dos respuestas que parecen buenas tampoco se creen:
   *   - la de un nodo cuya cabeza va más de MARGEN_BLOQUES por debajo de lo ya
   *     visto: el lote entero se repite en el siguiente, reverts incluidos (un
   *     revert contra un estado viejo no es la respuesta de la cadena de ahora);
   *   - un nonce "pending" por debajo del que esta página ya envió desde esa
   *     cartera: ese nodo no ha visto la transacción, y firmar con ese nonce es
   *     "nonce has already been used", o una transacción que no mina nunca y un
   *     tx.wait() sin reloj esperándola.
   *
   * NINGUNA DE LAS DOS REGLAS PUEDE BLOQUEAR.  (14-sep, revisión adversarial)
   * Las dos daban por buena la sospecha aunque TODOS los nodos la contradijesen:
   *   - una transacción aceptada que se cae del mempool: los tres nodos dicen,
   *     con razón, el nonce N, los tres se rechazaban, y ningún envío más de esa
   *     cartera salía hasta recargar la página. El código de antes firmaba.
   *   - una cabeza falsa muy por delante: ver `sueloAhora`.
   * Así que lo que una regla aparta no se tira: se guarda, y si al acabar la
   * vuelta NINGÚN nodo ha dado nada mejor, se devuelve lo mejor de lo apartado
   * -- el nonce más alto; la respuesta del nodo con la cabeza más alta, que pasa
   * a ser el techo -- en vez de un error. La regla sólo elige entre respuestas;
   * no puede dejar sin ninguna. Y un nodo apartado por el nonce no se castiga:
   * puede tener razón.
   *
   * LO ATRASADO, POR ELEMENTO Y CERCA.  (tercera revisión, 14-sep) Antes lo
   * atrasado no servía para NADA de la vuelta si un nodo confirmaba el techo, y
   * un eth_blockNumber confirmado en el mismo lote que una cotización que ese
   * nodo no pudo dar dejaba la cotización sin respuesta, con arc-scan -- 15
   * bloques detrás -- teniéndola. Ahora cada elemento que ningún nodo al día
   * contestó puede venir de lo atrasado; el techo sólo baja si nadie lo confirmó,
   * y los atrasados se castigan igual. Pero sólo a ATRASO_MAXIMO bloques o menos
   * del techo, y sólo de nodos de Arc: si no hay eso, se falla como fallaba el
   * código de antes. */
  async function leer(lista) {
    const hechas = new Map();
    let pendientes = lista;
    const fallos = [];
    const fuera = [...excluidos.values()];  // no se les pregunta, pero el error los nombra
    const apartadas = [];   // { url, cabeza, atrasado, respuestas: id -> resp }
    let confirmado = false; // algún nodo de esta vuelta trajo una cabeza que pasó las reglas

    const aceptar = (p, x, url) => {
      hechas.set(clave(p.id), x);
      if (p.method === "eth_getTransactionReceipt" && x.result && typeof x.result === "object") {
        sinConfirmar.delete(String(p.params && p.params[0]).toLowerCase());
        creerCabeza(numero(x.result.blockNumber), url);   // la cadena llegó al menos ahí
      }
    };
    /* Lo apartado por el nonce siempre sirve (su altura pasó); lo atrasado, sólo
     * a ATRASO_MAXIMO bloques o menos de la referencia. */
    const sirve = (c, referencia) => !c.atrasado || (referencia != null && c.cabeza >= referencia - ATRASO_MAXIMO);

    for (const url of ordenLectura()) {
      if (!pendientes.length) break;
      /* CON RESPALDO NO SE ESPERA. Si lo apartado ya serviría para todo lo que
       * falta, el nodo que falló hace nada ni se pregunta, y el resto tiene
       * TIEMPOS.segundaOpinionMs: esperar 10 s a un colgado para acabar
       * devolviendo lo que ya se tenía es sólo esperar. */
      const respaldo = pendientes.every((p) =>
        apartadas.some((c) => c.respuestas.has(clave(p.id)) && sirve(c, techo && techo.n)));
      if (respaldo && castigado(url)) {
        fallos.push(hostDe(url) + " skipped (it failed moments ago)");
        continue;
      }
      const suelo = sueloAhora();
      const plazo = respaldo ? Math.min(plazoLectura(url), TIEMPOS.segundaOpinionMs) : plazoLectura(url);
      const { r, cadena, porId } = await preguntar(url, pendientes, plazo);
      if (r.tipo !== "http") {
        castigar(url);
        fallos.push(hostDe(url) + (r.tipo === "timeout" ? " timed out" : " unreachable"));
        continue;
      }
      if (cadena) {
        if (!cadena.otra) castigar(url);
        fallos.push(cadena.motivo);
        continue;
      }
      const buenas = new Map();
      let falloAqui = null;
      for (const p of pendientes) {
        const resp = porId.get(clave(p.id));
        const err = resp && resp.error;
        if (err && esRespuestaDeLaCadena(err)) {
          buenas.set(clave(p.id), { jsonrpc: "2.0", id: p.id, error: err });
        } else if (resp && !err && resp.result !== undefined && r.status >= 200 && r.status < 300) {
          buenas.set(clave(p.id), { jsonrpc: "2.0", id: p.id, result: resp.result });
        } else {
          falloAqui = falloAqui || (hostDe(url) + " HTTP " + r.status +
            (err && typeof err === "object" ? " \"" + corto(err.message) + "\"" : ""));
        }
      }
      if (falloAqui) { castigar(url); fallos.push(falloAqui); }

      let cabeza = null;
      for (const p of pendientes) {
        const x = buenas.get(clave(p.id));
        const n = x ? cabezaQueTrae(p, x.result) : null;
        if (n != null && (cabeza == null || n > cabeza)) cabeza = n;
      }
      if (cabeza != null && suelo != null && cabeza < suelo) {
        /* el castigo se decide al final: si el techo era falso, no lo merece */
        fallos.push(hostDe(url) + " was " + (suelo + MARGEN_BLOQUES - cabeza) + " blocks behind");
        if (buenas.size) apartadas.push({ url, cabeza, atrasado: true, respuestas: buenas });
        continue;
      }
      if (cabeza != null && !creerCabeza(cabeza, url)) {
        castigar(url);
        fallos.push(hostDe(url) + " said block " + cabeza + ", further ahead than the chain can have gone since block " + cumbre.n);
        continue;
      }
      if (cabeza != null) confirmado = true;

      const bajoSuelo = new Map();
      for (const p of pendientes) {
        const x = buenas.get(clave(p.id));
        if (!x || !esNoncePendiente(p)) continue;
        const minimo = sueloNonce(carteraDe(p));
        const n = numero(x.result);
        if (minimo != null && n != null && n < minimo) {
          buenas.delete(clave(p.id));
          bajoSuelo.set(clave(p.id), x);
          fallos.push(hostDe(url) + " gave nonce " + n + " after this page sent nonce " + (minimo - 1));
        }
      }
      if (bajoSuelo.size) apartadas.push({ url, cabeza, atrasado: false, respuestas: bajoSuelo });

      for (const p of pendientes) {
        const x = buenas.get(clave(p.id));
        if (x) aceptar(p, x, url);
      }
      pendientes = pendientes.filter((p) => !hechas.has(clave(p.id)));
    }

    /* Lo apartado, para lo que nadie contestó mejor. Preferencia: lo que sólo
     * apartó el nonce (su altura pasó) antes que lo atrasado; entre atrasados,
     * la cabeza más alta; y a igualdad, el nonce más alto. */
    const preferible = (a, xa, b, xb) =>
      (a.atrasado !== b.atrasado ? !a.atrasado
        : a.atrasado && a.cabeza !== b.cabeza ? a.cabeza > b.cabeza
          : (numero(xa.result) ?? -1) > (numero(xb.result) ?? -1));
    /* LA CABEZA QUE SE DESDICE. Si el techo lo dijo un nodo solo y en esta vuelta
     * ese mismo nodo contesta más de ATRASO_MAXIMO por debajo sin que nadie lo
     * confirme, el techo ya no lo sostiene ni quien lo puso: la referencia pasa a
     * ser lo más alto de esta vuelta, y la cumbre con ella. Sin esto una primera
     * cabeza falsa (+100.000) dejaba la página sin lecturas hasta que el techo
     * caducase: 30 s en los que el código de antes, fijo en arc-scan, leía. */
    const atrasadas = apartadas.filter((c) => c.atrasado);
    let referencia = techo ? techo.n : null;
    let rebajado = null;
    if (!confirmado && techo && techo.fuentes.size === 1 &&
        atrasadas.some((c) => techo.fuentes.has(c.url) && c.cabeza < techo.n - ATRASO_MAXIMO)) {
      referencia = rebajado = Math.max(...atrasadas.map((c) => c.cabeza));
      cumbre = { n: referencia, t: Date.now() };
    }
    for (const p of pendientes) {
      let mejor = null, x = null;
      for (const c of apartadas) {
        const y = c.respuestas.get(clave(p.id));
        if (!y || !sirve(c, referencia)) continue;
        if (!mejor || preferible(c, y, mejor, x)) { mejor = c; x = y; }
      }
      if (!mejor) continue;
      /* el techo sólo baja si en esta vuelta nadie lo confirmó */
      if (mejor.atrasado && !confirmado) rebajado = Math.max(rebajado ?? -Infinity, mejor.cabeza);
      if (esNoncePendiente(p)) {
        const minimo = sueloNonce(carteraDe(p));
        const n = numero(x.result);
        /* todos por debajo: la transacción se cayó, el suelo ya no dice nada */
        if (minimo != null && n != null && n < minimo) nonceMinimo.delete(carteraDe(p));
      }
      aceptar(p, x, mejor.url);
    }
    if (rebajado != null) {
      techo = { n: rebajado, t: Date.now(),
        fuentes: new Set(atrasadas.filter((c) => c.cabeza >= rebajado - ACUERDO_BLOQUES).map((c) => c.url)) };
    }
    for (const c of atrasadas) {
      if (confirmado || !(rebajado != null && c.cabeza >= rebajado - MARGEN_BLOQUES)) castigar(c.url);
    }
    const motivos = [...fallos, ...fuera].join(" · ");
    return lista.map((p) => hechas.get(clave(p.id)) || nadieContesto(p, motivos));
  }

  /* La cabeza de UN nodo, en una petición suelta (con su cadena, si no la ha
   * dicho). Devuelve { n } o { n: null, motivo } con el host delante. */
  async function cabezaDe(url) {
    const suelo = sueloAhora();
    const p = { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] };
    const { r, cadena, porId } = await preguntar(url, [p], plazoLectura(url));
    if (r.tipo !== "http") return { n: null, motivo: hostDe(url) + (r.tipo === "timeout" ? " timed out" : " unreachable") };
    if (cadena) return { n: null, motivo: cadena.motivo };
    const x = porId.get(clave(p.id));
    const n = r.status >= 200 && r.status < 300 && x && !x.error ? numero(x.result) : null;
    if (n == null) return { n: null, motivo: hostDe(url) + " HTTP " + r.status };
    if (suelo != null && n < suelo) return { n: null, motivo: hostDe(url) + " was " + (suelo + MARGEN_BLOQUES - n) + " blocks behind" };
    if (!creerCabeza(n, url)) return { n: null, motivo: hostDe(url) + " said block " + n + ", further ahead than the chain can have gone" };
    return { n };
  }

  /* ── ENVÍOS: la parte delicada, con la misma línea que arc-rpc.js ──────
   *
   * Reintentar una transacción firmada no la duplica en la cadena --mismos
   * bytes, mismo nonce--, pero informar de un error de una transacción que SÍ
   * va a minar hace que se vuelva a pulsar, y en la rápida pulsar es firmar
   * OTRA sin ventana: la segunda retirada. Así que la línea no es la gravedad
   * del fallo, es SI EL NODO LLEGÓ A MIRARLA:
   *
   *   se pasa al siguiente   HTTP 429; un error JSON-RPC de rechazo limpio (rate
   *                          limit, out of capacity, method disabled...); un 503
   *                          SIN error JSON-RPC dentro (el de un balanceador); y
   *                          un nodo con preflight que no contesta a la lectura
   *                          de justo antes: el POST del envío ni salió
   *   NO se reintenta        timeout, conexión caída, cuerpo roto, HTTP 500, y
   *                          el 503 de arc-scan: su propio cuerpo dice "No answer
   *                          was obtained, so nothing about the result should be
   *                          assumed". Un 503 que dice eso no es "antes de
   *                          mirarla", y se le cree.
   *   "already known"        es la MISMA transacción ya en el mempool de ese
   *                          nodo: se da por enviada, con su hash.
   *
   * LA LECTURA DE ANTES. thecusp necesita preflight y no manda max-age: tras 4 s
   * sin hablarle, el navegador repite el OPTIONS antes del POST, y si ese OPTIONS
   * falla (un bloqueo de LaLiga, por ejemplo) el envío salía como "no se sabe"
   * sin haber salido. Una lectura justo antes renueva el preflight y, si falla,
   * el nodo se salta limpio. */
  async function enviar(p) {
    const firmada = p.method === "eth_sendRawTransaction" && p.params ? p.params[0] : null;
    const hash = typeof firmada === "string" ? ethers.keccak256(firmada) : null;
    let desde = null, nonce = null;
    if (typeof firmada === "string") {
      try {
        const tx = ethers.Transaction.from(firmada);
        desde = tx.from ? tx.from.toLowerCase() : null;
        nonce = tx.nonce;
      } catch { /* bytes que no se leen como transacción: se envían igual */ }
    }
    const quizas = " The transaction may or may not have been broadcast — check the balance before sending it again.";
    /* ACEPTADA ES SÓLO SU HASH.  (14-sep, revisión adversarial) Antes bastaba
     * cualquier 2xx con `result` -- null, o el hash de otra --, y eso ponía el
     * suelo de nonce y el aviso de "ya se envió" para una transacción que nadie
     * aceptó, o con un hash falso. Ahora: el keccak256 de los bytes firmados, y
     * sin bytes (eth_sendTransaction) al menos un hash de 32 bytes, sin suelo. */
    const esSuHash = (x) => typeof x === "string" && (hash ? x.toLowerCase() === hash.toLowerCase() : HASH_32.test(x));
    /* EN MINÚSCULAS. ethers compara el hash devuelto con el suyo con ===, y un
     * nodo que lo daba en mayúsculas -- el mismo hash -- hacía fallar
     * broadcastTransaction con "@TODO: the returned hash did not match" con la
     * transacción ya aceptada (tercera revisión, 14-sep). Se devuelve el
     * calculado de los bytes firmados. */
    const aceptada = (url, resultado) => {
      apuntarEnvio(url, true);
      const h = (hash || String(resultado)).toLowerCase();
      sinConfirmar.set(h, { t: Date.now(), desde });
      if (hash && desde && nonce != null) {
        const antes = sueloNonce(desde);
        nonceMinimo.set(desde, { n: Math.max(antes ?? 0, nonce + 1), t: Date.now() });
      }
      return { estado: "aceptada", url, hash: h, resp: { jsonrpc: "2.0", id: p.id, result: h } };
    };
    const dudosa = (url, texto) => {
      castigar(url);
      apuntarEnvio(url, false);
      return { estado: "dudosa", url, resp: errorDeNodo(p.id, texto + quizas) };
    };
    const rechazos = [];
    /* El envío de un nodo que lo rechazó "limpio" SÍ salió hacia él: un 503 de
     * balanceador no demuestra que no llegase a nadie. Si luego otro dice
     * "nonce too low", ese nonce puede ser esta misma transacción, minada por el
     * primero: no se sabe, y se dice así (ver abajo). */
    let rechazoTrasSalir = null;
    const fuera = [...excluidos.values()];
    for (const url of ordenEnvio()) {
      const frio = !SIN_PREFLIGHT.has(hostDe(url)) && !(Date.now() - (ultimaRespuesta.get(url) ?? -Infinity) < TIEMPOS.preflightMs);
      /* Y nada firmado va a un nodo que no ha dicho su cadena en esta página. Al
       * que no necesita la lectura de antes se le pregunta sólo eso, una vez. */
      if (frio || !cadenaBuena.has(url)) {
        const antes = frio ? await cabezaDe(url) : await confirmarCadena(url);
        if (antes.motivo) {
          castigar(url);
          rechazos.push(antes.motivo + " on the read just before");
          continue;
        }
      }
      const r = await pedir(fetchFn, url, p, TIEMPOS.envioMs);
      if (r.tipo !== "http") {
        return dudosa(url, hostDe(url) + (r.tipo === "timeout" ? " did not answer in time." : " dropped the connection."));
      }
      ultimaRespuesta.set(url, Date.now());
      const resp = respuestasPorId(r.json, [p]).get(clave(p.id));
      const err = resp && resp.error && typeof resp.error === "object" ? resp.error : null;
      if (err && hash && YA_LA_TIENE.test(String(err.message || ""))) return aceptada(url, hash);
      const limpio = r.status === 429 || (err && esRechazoLimpio(err)) || (r.status === 503 && !err);
      if (limpio) {
        castigar(url);
        rechazos.push(hostDe(url) + " " + (err ? "\"" + corto(err.message) + "\"" : "HTTP " + r.status));
        rechazoTrasSalir = rechazoTrasSalir || rechazos[rechazos.length - 1];
        continue;
      }
      if (err && esRespuestaDeLaCadena(err)) {
        apuntarEnvio(url, true);
        if (rechazoTrasSalir && NONCE_BAJO.test(String(err.message || ""))) {
          /* el nodo contestó bien: ni castigo ni duda en su historial */
          return { estado: "dudosa", url, resp: errorDeNodo(p.id, hostDe(url) + " answered \"" + corto(err.message) +
            "\" after " + rechazoTrasSalir + ": that nonce may have been used by this very transaction." + quizas) };
        }
        return { estado: "cadena", url, resp: { jsonrpc: "2.0", id: p.id, error: err } };
      }
      if (err) return dudosa(url, hostDe(url) + " answered HTTP " + r.status + " \"" + corto(err.message) + "\".");
      if (resp && resp.result !== undefined && r.status >= 200 && r.status < 300) {
        if (esSuHash(resp.result)) return aceptada(url, resp.result);
        return dudosa(url, hostDe(url) + " answered HTTP " + r.status + " with " + corto(JSON.stringify(resp.result)) +
          ", which is not this transaction's hash.");
      }
      return dudosa(url, hostDe(url) + " answered HTTP " + r.status + " without a result.");
    }
    return { estado: "rechazada", url: null, resp: errorDeNodo(p.id, "Every Arc node turned the transaction away before looking at it (" +
      [...rechazos, ...fuera].join(" · ") + "), so it was not broadcast. Try again in a moment.") };
  }

  class ProveedorRotativo extends ethers.JsonRpcProvider {
    constructor() {
      /* La URL que se le da al padre no se usa: `_send` es de aquí. La cadena
       * sigue clavada en 5042 con staticNetwork, como antes: ethers no pregunta
       * eth_chainId por su cuenta. Lo pregunta `preguntar`, una vez por nodo y
       * dentro de su primer lote. */
      super(nodos[0], chainId, { staticNetwork: true, batchMaxCount: LOTE_MAXIMO });
    }

    /* Los envíos NUNCA van dentro de un lote. Ethers junta el
     * eth_sendRawTransaction con el eth_blockNumber que pide a la vez, y un lote
     * que falla entero no dice si el nodo llegó a mirar la transacción. Se
     * separan: las lecturas en su lote, cada envío en su petición.
     *
     * PERO SEPARADOS PUEDEN ACABAR DISTINTO (cazado en la revisión, 14-sep): el
     * envío aceptado y ese eth_blockNumber fallando en los tres nodos, y
     * broadcastTransaction rechazaba con el error de la LECTURA -- "No Arc node
     * answered eth_blockNumber... Try again in a moment" -- con la transacción
     * ya en la cadena. Así que, si hubo un envío en este mismo lote:
     *   aceptado   el bloque sale del último bloque visto (<= 30 s) o, si no
     *              hay, del nodo que aceptó el envío; y si tampoco, el error
     *              dice que la transacción SE ENVIÓ, con su hash
     *   dudoso     el error de la lectura pasa a ser el del envío: "may or may
     *              not have been broadcast", no "Try again". */
    async _send(payload) {
      const lista = Array.isArray(payload) ? payload : [payload];
      const envios = lista.filter((x) => METODOS_DE_ENVIO.has(x.method));
      const lecturas = lista.filter((x) => !METODOS_DE_ENVIO.has(x.method));
      const [leidas, enviadas] = await Promise.all([
        lecturas.length ? leer(lecturas) : [],
        Promise.all(envios.map(enviar)),
      ]);
      const aceptada = enviadas.find((x) => x.estado === "aceptada");
      const dudosa = enviadas.find((x) => x.estado === "dudosa");
      /* EL AVISO, SÓLO DONDE TOCA.  (tercera revisión, 14-sep) El eth_blockNumber
       * de este lote es el de broadcastTransaction: su error lleva el aviso del
       * envío. Las demás lecturas del lote, sólo si nombran su hash o su cartera
       * -- `coletilla` lo mira, y el envío ya está en sinConfirmar --: antes lo
       * llevaba también el saldo de otra cartera por caer en el mismo lote. */
      const deEsteLote = new Set(enviadas.filter((x) => x.estado === "aceptada").map((x) => x.hash));
      for (let k = 0; k < lecturas.length && (aceptada || dudosa); k++) {
        if (!esErrorDeNodo(leidas[k])) continue;
        const id = lecturas[k].id;
        if (lecturas[k].method !== "eth_blockNumber") {
          if (aceptada) leidas[k] = nadieContesto(lecturas[k], leidas[k].error.data.fallos);
          continue;
        }
        if (!aceptada) { leidas[k] = { ...dudosa.resp, id }; continue; }
        let n = techo && Date.now() - techo.t <= TIEMPOS.bloqueRecienteMs ? techo.n : null;
        if (n == null) n = (await cabezaDe(aceptada.url)).n;
        leidas[k] = n != null
          ? { jsonrpc: "2.0", id, result: ethers.toQuantity(n) }
          : nadieContesto(lecturas[k], leidas[k].error.data.fallos, deEsteLote);
      }
      const porId = new Map([...leidas, ...enviadas.map((x) => x.resp)].map((x) => [clave(x.id), x]));
      return lista.map((x) => porId.get(clave(x.id)));
    }

    getRpcError(payload, resp) {
      const e = resp && resp.error;
      if (e && e.data && e.data.nodoArc) {
        return ethers.makeError(e.message, "SERVER_ERROR", { info: { payload, error: e } });
      }
      return super.getRpcError(payload, resp);
    }

    /* EL rawCall DE app.js, con el mismo orden, relojes y castigos que todo lo
     * demás. Antes recorría su propia copia de la lista con 12 s por nodo y sin
     * castigo: con thecusp colgado, cada rawCall que topaba con el 503 de
     * arc-scan esperaba 12 s antes de llegar al siguiente. La promesa de
     * siempre se mantiene: cualquier error o falta de resultado pasa al
     * siguiente nodo, y si ninguno contesta el error lleva `noNode`. Un revert
     * no castiga al nodo; lo demás, sí. Y como todo lo demás, sólo se usa lo
     * de un nodo que ha dicho su cadena (`preguntar`). */
    async leerCrudo(method, params) {
      for (const url of ordenLectura()) {
        const plazo = method === "eth_getLogs" ? Math.max(TIEMPOS.getLogsMs, plazoLectura(url)) : plazoLectura(url);
        const p = { jsonrpc: "2.0", id: 1, method, params };
        const { r, cadena, porId } = await preguntar(url, [p], plazo);
        if (r.tipo !== "http") { castigar(url); continue; }
        if (cadena) { if (!cadena.otra) castigar(url); continue; }
        const j = porId.get(clave(p.id));
        if (r.status >= 200 && r.status < 300 && j && !j.error && j.result !== undefined) return j.result;
        if (!(j && j.error && esRespuestaDeLaCadena(j.error))) castigar(url);
      }
      const err = new Error("no node answered — Arc's public RPCs are down for this call");
      err.noNode = true;
      throw err;
    }
  }

  return new ProveedorRotativo();
}
