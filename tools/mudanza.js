/* ===========================================================================
   MUDANZA — llevarse la contabilidad de arc-launcher a otro dominio.

   Se pega en la CONSOLA del navegador (F12). Dos pasos: exportar en el sitio
   viejo, importar en el nuevo.

   ---------------------------------------------------------------------------
   LO QUE **NO** HACE FALTA MUDAR, Y ES LO IMPORTANTE
   ---------------------------------------------------------------------------
   LAS CARTERAS Y EL DINERO NO SE TOCAN. La clave sale de firmar un texto que
   lleva sólo el nombre de la app, `chain: 5042` y tu dirección — el dominio NO
   entra (ver la cabecera de `wallets.js`). Así que firmas en el dominio nuevo
   y vuelven exactamente las mismas carteras, con su dinero dentro, sin haber
   exportado nada. Esto no mueve fondos ni toca claves privadas.

   ---------------------------------------------------------------------------
   LO QUE SÍ SE PIERDE SI NO SE HACE ESTO
   ---------------------------------------------------------------------------
   `localStorage` es de cada origen y no viaja:

     arclauncher.cluster    CUÁNTAS HIJAS tiene tu clúster. Sin esto la página
                            te lo enseña VACÍO aunque el dinero esté ahí, porque
                            no sabe cuántas derivar.
     arclauncher.coste      lo que pusiste en cada moneda. Es la base del "+12%"
                            y NO SE PUEDE RECALCULAR: deducirlo de un saldo
                            actual es como se pintan ganancias que no existen.
     arclauncher.monedas    tu lista por símbolo
     arclauncher.progreso   qué NFT mirar
     arcLauncher.tokens.v1  histórico de lanzamientos

   NO se copia `arclauncher.fastkey`: esa es la CLAVE PRIVADA, vive en
   sessionStorage, muere al cerrar la pestaña y se recupera firmando. Sacarla a
   un fichero sería crear una copia del tesoro sin necesidad ninguna.
   =========================================================================== */

/* ===========================================================================
   PASO 0 — MIRA QUÉ TIENES, ANTES DE TOCAR NADA
   ---------------------------------------------------------------------------
   Sólo LEE. No escribe, no descarga, no manda nada.

   POR QUÉ HACE FALTA: todo esto va guardado POR NAVEGADOR, no por wallet. Un
   mismo `localStorage` lleva TODAS las principales que se hayan conectado en
   ese navegador y ese perfil — así que si usas dos carteras en el mismo Chrome,
   una sola exportación se lleva las dos.

   Y AL REVÉS, que es lo que se olvida: lo de OTRA PERSONA está en SU navegador
   y tu exportación no puede verlo. Cada uno hace la suya en su máquina.

   Comprueba aquí que salen todas las que esperas y con el número de hijas que
   esperas. `n` son LAS HIJAS: la rápida principal (la madre) no se guarda
   nunca, sale siempre de la firma. Un clúster que ves de 9 tiene `n: 8`.
   =========================================================================== */
(() => {
  const cl = JSON.parse(localStorage.getItem("arclauncher.cluster") || "{}");
  const co = JSON.parse(localStorage.getItem("arclauncher.coste") || "{}");
  const principales = Object.keys(cl);

  if (!principales.length) {
    console.warn("Este navegador no tiene ningún clúster guardado.\n" +
      "O no es el navegador con el que usas arc-launcher, o es otro perfil de Chrome.");
    return;
  }

  const tabla = {};
  for (const p of principales) {
    const g = cl[p] || {};
    /* Los apuntes de coste de ESA cartera y de sus hijas no se pueden contar
       aquí: la clave es `cartera|token` y las hijas tienen direcciones propias.
       Se cuenta el total y se dice, en vez de inventar un reparto. */
    tabla[p] = {
      hijas_guardadas: g.n,
      cluster_total_con_la_madre: typeof g.n === "number" ? g.n + 1 : "?",
      filas_de_pantalla: Array.isArray(g.filas) ? g.filas.length : 0,
    };
  }
  console.log("%c  LO QUE HAY EN ESTE NAVEGADOR  ", "background:#E0A33C;color:#000;font-weight:bold");
  console.table(tabla);
  console.log("  apuntes de coste (todas las carteras juntas): " + Object.keys(co).length);
  console.log("");
  console.log("  ¿Salen TODAS tus principales y con las hijas que esperas?");
  console.log("  Si falta una, esa la usaste en otro navegador o en otro perfil,");
  console.log("  y hay que exportar TAMBIÉN desde allí.");
})();


/* ===========================================================================
   PASO 1 — EN EL SITIO VIEJO (el arc-launcher de ahora)
   Pega esto y se te descarga un .json.
   =========================================================================== */
(() => {
  /* SE BUSCAN POR PATRÓN Y NO POR LISTA. Una lista escrita a mano se queda
     vieja en cuanto alguien añade una clave nueva, y el fallo sería invisible:
     migras, parece que todo fue bien, y meses después falta algo. El patrón
     coge cualquier `arclauncher.*` / `arcLauncher.*` que exista hoy o mañana. */
  const PATRON = /^arc[Ll]auncher\./;
  /* Menos la clave privada, que ni está aquí (es sessionStorage) ni debe salir. */
  const PROHIBIDAS = /fastkey/i;

  const datos = {};
  let saltadas = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !PATRON.test(k)) continue;
    if (PROHIBIDAS.test(k)) { saltadas.push(k); continue; }
    datos[k] = localStorage.getItem(k);
  }

  const claves = Object.keys(datos);
  if (!claves.length) {
    console.warn("No hay nada que exportar. ¿Seguro que estás en el arc-launcher " +
                 "y con la wallet que usas normalmente?");
    return;
  }

  /* El resumen se calcula AQUÍ y viaja DENTRO del fichero, para poder
     comprobar al importar que llegó lo mismo que salió. Un recuento hecho
     sólo al final no distingue "no había nada" de "se perdió por el camino". */
  const resumen = {};
  for (const k of claves) {
    let n = null;
    try {
      const v = JSON.parse(datos[k]);
      n = Array.isArray(v) ? v.length : (v && typeof v === "object" ? Object.keys(v).length : 1);
    } catch { n = 1; }
    resumen[k] = { bytes: datos[k].length, entradas: n };
  }

  const paquete = {
    que: "arc-launcher/mudanza",
    version: 1,
    origen: location.origin,
    cuando: new Date().toISOString(),
    resumen,
    datos,
  };

  console.log("%c  EXPORTADO  ", "background:#4ac26b;color:#000;font-weight:bold");
  console.table(resumen);
  if (saltadas.length) console.log("  no exportadas a propósito:", saltadas.join(", "));

  const blob = new Blob([JSON.stringify(paquete, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "arc-launcher-mudanza.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  console.log("  Descargado `arc-launcher-mudanza.json`. Guárdalo y llévalo al dominio nuevo.");
})();


/* ===========================================================================
   PASO 2 — EN basey.finance
   Pega ESTO, te pedirá el fichero, y compara lo que entra con lo que salió.
   =========================================================================== */
(() => {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "application/json,.json";
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    let p;
    try { p = JSON.parse(await f.text()); } catch { console.error("Ese fichero no es JSON."); return; }
    if (!p || p.que !== "arc-launcher/mudanza" || !p.datos) {
      console.error("Ese fichero no es una mudanza de arc-launcher.");
      return;
    }

    /* SE FUSIONA, NO SE SUSTITUYE, Y ESTA ES LA DECISIÓN QUE MÁS IMPORTA AQUÍ.
       -----------------------------------------------------------------------
       La primera versión de esto sustituía, y avisaba antes de pisar. Parecía
       prudente y estaba mal: si tus carteras están repartidas en dos
       navegadores hacen falta DOS exportaciones, y al importar la segunda las
       dos únicas salidas eran cancelar (perder la segunda) o aceptar (perder
       la primera). Las dos pierden datos.

       Fusionar lo resuelve porque el dato ya viene organizado para eso: los
       tres ficheros grandes son objetos indexados por dirección
       (`cluster` por principal, `coste` por cartera|token, `progreso` por
       dirección), así que dos navegadores distintos escriben en claves
       distintas y no se estorban. Las listas se concatenan sin repetidos.

       Así se pueden importar tantas exportaciones como haga falta, en
       cualquier orden, y también la de otra persona en la misma máquina. */
    const antes = {};
    for (const k of Object.keys(p.datos)) antes[k] = localStorage.getItem(k);

    const comoQuedo = {};
    for (const [k, v] of Object.entries(p.datos)) {
      const actual = localStorage.getItem(k);
      let salida = v, modo = "nuevo";

      if (actual !== null && actual !== v) {
        try {
          const a = JSON.parse(actual), b = JSON.parse(v);
          if (Array.isArray(a) && Array.isArray(b)) {
            /* Sin repetidos, comparando el elemento entero: estas listas son
               objetos pequeños y no tienen un id fiable en el que confiar. */
            const vistos = new Set(a.map((x) => JSON.stringify(x)));
            const nuevos = b.filter((x) => !vistos.has(JSON.stringify(x)));
            salida = JSON.stringify(a.concat(nuevos));
            modo = "lista fusionada (+" + nuevos.length + ")";
          } else if (a && b && typeof a === "object" && typeof b === "object") {
            salida = JSON.stringify({ ...a, ...b });
            modo = "fusionado por clave";
          } else {
            modo = "sustituido (no es fusionable)";
          }
        } catch { modo = "sustituido (no era JSON)"; }
      } else if (actual === v) {
        modo = "ya estaba igual";
      }

      try { localStorage.setItem(k, salida); comoQuedo[k] = modo; }
      catch (e) { comoQuedo[k] = "ERROR: " + e.message; }
    }
    console.log("  cómo se resolvió cada clave:");
    console.table(comoQuedo);

    /* LA COMPROBACIÓN, QUE ES LA MITAD QUE IMPORTA.
       -----------------------------------------------------------------------
       Se comprueba que NO FALTE NADA del paquete, no que el resultado sea
       idéntico: al fusionar, lo de aquí tiene con razón MÁS cosas que el
       fichero. Comparar tamaños daría "NO CUADRA" en una importación perfecta,
       y ese falso rojo es peor que no comprobar -- lleva a repetir la
       importación buscando un problema que no existe.

       Y se RELEE de localStorage en vez de fiarse del `setItem`: una escritura
       que falla por cuota no lanza en todos los navegadores. */
    const tabla = {};
    let faltan = 0;
    for (const [k, vOrig] of Object.entries(p.datos)) {
      const leido = localStorage.getItem(k);
      let dentro = leido !== null, detalle = "";

      if (leido !== null) {
        try {
          const a = JSON.parse(leido), b = JSON.parse(vOrig);
          if (Array.isArray(b)) {
            const hay = new Set((Array.isArray(a) ? a : []).map((x) => JSON.stringify(x)));
            const perdidos = b.filter((x) => !hay.has(JSON.stringify(x))).length;
            dentro = perdidos === 0;
            detalle = b.length + " del fichero, faltan " + perdidos;
          } else if (b && typeof b === "object") {
            const perdidas = Object.keys(b).filter((c) => !(c in (a || {})));
            dentro = perdidas.length === 0;
            detalle = Object.keys(b).length + " del fichero, faltan " + perdidas.length +
                      (perdidas.length ? " (" + perdidas.join(", ") + ")" : "");
          } else {
            dentro = leido === vOrig;
            detalle = dentro ? "valor suelto, igual" : "valor suelto, DISTINTO";
          }
        } catch { dentro = leido === vOrig; detalle = "no era JSON"; }
      } else {
        detalle = "NO ESTÁ";
      }

      if (!dentro) faltan++;
      tabla[k] = { estado: dentro ? "completo" : "FALTA ALGO", detalle };
    }

    console.table(tabla);
    if (faltan === 0) {
      console.log("%c  NO FALTA NADA DEL FICHERO  ",
        "background:#4ac26b;color:#000;font-weight:bold");
      console.log("  Recarga la página y conecta tu wallet: el clúster tiene que salir");
      console.log("  con el mismo número de carteras y los mismos saldos.");
      console.log("  Si tienes otra exportación (otro navegador, u otra persona en");
      console.log("  esta misma máquina), impórtala ahora: se fusiona, no pisa.");
    } else {
      console.log("%c  " + faltan + " CLAVE(S) INCOMPLETAS — no borres el fichero  ",
        "background:#e5484d;color:#fff;font-weight:bold");
    }
    console.log("  exportado de: " + p.origen + "   el " + p.cuando);
  };
  inp.click();
  console.log("  Elige el fichero `arc-launcher-mudanza.json`.");
})();
