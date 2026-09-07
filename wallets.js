/* ── La cartera rápida y su clúster ──────────────────────────────────────
 *
 * UNA FIRMA, Y DE AHÍ SALE TODO. No se genera nada al azar y no hay frase
 * semilla que apuntar: firmas un mensaje fijo con tu cartera principal y la
 * clave es el hash de esa firma. Firma el mismo mensaje mañana, en otro
 * navegador o en otro ordenador, y vuelve exactamente la misma cartera.
 *
 * El diseño es el de `cusp-web/assets/js/fastwallet.js`, que lleva meses
 * funcionando, y se porta a propósito en vez de inventar otro: allí la clave
 * es `keccak256` de los 65 bytes de la firma. Lo que NO se porta es todo lo
 * que dependía de su Router — el alta en cadena, los 0,05 USDC de fondeo, la
 * tarifa plana y el grifo. Aquí no hay Router, así que no hay registro, no
 * hay comisión y no hay límite de una por principal.
 *
 * POR QUÉ ESTO Y NO UNA FRASE DE DOCE PALABRAS. Una frase hay que enseñarla,
 * copiarla y guardarla, y el día que se pierde se pierde el dinero. Una firma
 * no se guarda en ninguna parte: se vuelve a hacer. El coste es una ventana
 * de la cartera por sesión, y ese es exactamente el precio correcto.
 *
 * EL MENSAJE NO LLEVA EL DOMINIO, Y ESO ES DELIBERADO.
 *
 * Este párrafo decía que "el texto de abajo lleva el dominio dentro". ERA
 * FALSO: míralo, sólo lleva el nombre literal de la app, `chain` y `owner`.
 * Se corrigió el 7-sep-2026, al planear la mudanza a basey.finance, y el error
 * no era inofensivo — quien lo leyera y decidiera "arreglarlo" añadiendo el
 * dominio DERIVARÍA CLAVES DISTINTAS PARA TODO EL MUNDO, y el dinero se
 * quedaría en unas carteras que la página ya no sabría calcular. No hay aviso
 * ni error: simplemente aparecen clústeres vacíos.
 *
 * Lo que sí ata la clave es `owner`, y con eso basta: dos personas distintas
 * nunca colisionan. Y con Cusp tampoco, porque `fastwallet.js` firma un
 * EIP-712 (datos tipados con su Router dentro) y esto firma texto plano — dos
 * mundos que no se pueden cruzar ni queriendo.
 *
 * LA CONSECUENCIA BUENA: al no depender del dominio, esta página se puede
 * mudar de sitio sin que nadie pierda nada. Se firma en el dominio nuevo y
 * vuelven las mismas carteras. Lo único que NO viaja es el `localStorage`
 * (tamaño del clúster, coste puesto en cada moneda, lista de monedas), que es
 * de cada origen — para eso está `tools/mudanza.js`.
 *
 * ─── LO QUE HAY QUE SABER ANTES DE METER DINERO AQUÍ ───
 *
 * La clave vive en la memoria de esta pestaña y NO se guarda en ningún sitio:
 * ni en localStorage, ni cifrada, ni nada. Cerrar la pestaña la borra, y se
 * recupera firmando otra vez. Eso protege del disco y de las extensiones que
 * leen almacenamiento; NO protege de código malicioso corriendo en esta misma
 * página. Aquí va dinero de trabajo, no el tesoro.
 *
 * Y la principal NUNCA firma por lote: solo el reparto inicial. Todo lo demás
 * lo firman las rápidas, sin ventana, porque la clave es tuya y está aquí.
 */

const CADENA = 5042;

/* El texto que se firma. Cambiarlo cambia TODAS las carteras derivadas, así
 * que lleva versión: si algún día hay que cambiarlo, se sube el número y se
 * dice, en vez de que a alguien le desaparezcan las carteras sin explicación. */
export function mensajeDeDerivacion(principal) {
  return [
    "arc-launcher — fast wallet v1",
    "",
    "Signing this creates a working wallet that this page controls, derived",
    "from this signature and nothing else. It is not a transaction and it",
    "cannot move any funds.",
    "",
    "Sign the same text again, anywhere, and the same wallet comes back.",
    "",
    "chain: " + CADENA,
    "owner: " + String(principal).toLowerCase(),
  ].join("\n");
}

/* De la firma a una clave privada: keccak256 de sus 65 bytes. Igual que Cusp. */
export async function derivarMadre(ethers, signer) {
  const principal = await signer.getAddress();
  const firma = await signer.signMessage(mensajeDeDerivacion(principal));
  const clave = ethers.keccak256(firma);
  return { principal, clave, cartera: new ethers.Wallet(clave) };
}

/* Las hijas. Deterministas y ordenadas: la hija 3 es siempre la hija 3, hoy y
 * dentro de un año, sin guardar nada. El índice va dentro del hash como un
 * uint32 con su etiqueta, para que no pueda chocar con ninguna otra
 * derivación que se añada después. */
export function derivarHija(ethers, claveMadre, i) {
  const semilla = ethers.solidityPackedKeccak256(
    ["string", "bytes32", "uint32"],
    ["arc-launcher/child", claveMadre, i],
  );
  return new ethers.Wallet(semilla);
}

export function derivarClúster(ethers, claveMadre, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(derivarHija(ethers, claveMadre, i));
  return out;
}

/* ── El gas ────────────────────────────────────────────────────────────
 *
 * En Arc el gas ES USDC, así que una cartera vaciada del todo no puede firmar
 * el envío de vuelta: se queda con el dinero dentro y sin manera de sacarlo.
 * Cusp resuelve esto en `maximoASacar`, descontando el gas SOLO del USDC, y
 * aquí se hace igual pero midiendo el precio real en vez de fijar una cifra.
 *
 * Una transferencia son 21.000 de gas; se pide holgura por si el destino
 * tiene código, y se multiplica por tres porque el precio del gas se mueve
 * entre que lo miras y firmas. Sobra poco y falta nunca. */
export const GAS_TRANSFERENCIA = 30000n;

export function reservaDeGas(gasPrice) {
  return GAS_TRANSFERENCIA * BigInt(gasPrice) * 3n;
}

export function máximoASacar(saldo, gasPrice) {
  const reserva = reservaDeGas(gasPrice);
  return saldo > reserva ? saldo - reserva : 0n;
}

/* ── El reparto ────────────────────────────────────────────────────────
 *
 * Repartir a mano son N transacciones y N ventanas. Este contrato lo hace en
 * una: le mandas el total y él parte. Se compila en el navegador como el token
 * y el locker, así que no hay nada desplegado de antemano en lo que confiar.
 *
 * No tiene dueño, no guarda estado entre llamadas y devuelve al remitente lo
 * que sobre: no hay nada dentro que rugear ni nada que se pueda quedar. */
export const DISPERSE_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Splits the native token (USDC on Arc) across many addresses in one
///         call. Holds nothing between calls and has no owner: there is
///         nothing in here to rug, and anything left over goes back to the
///         sender so a rounding remainder cannot be stranded.
contract Disperse {
    error LengthMismatch();
    error SendFailed(address to);
    error RefundFailed();

    function send(address[] calldata to, uint256[] calldata amount) external payable {
        if (to.length != amount.length) revert LengthMismatch();
        for (uint256 i = 0; i < to.length; i++) {
            (bool ok, ) = to[i].call{value: amount[i]}("");
            if (!ok) revert SendFailed(to[i]);
        }
        uint256 left = address(this).balance;
        if (left > 0) {
            (bool ok, ) = msg.sender.call{value: left}("");
            if (!ok) revert RefundFailed();
        }
    }
}
`;

/* Cuánto va a cada una.
 *
 * Repartir la misma cifra exacta a diez carteras deja diez transacciones
 * idénticas, y quien lea la cadena verá diez carteras idénticas. Variar los
 * importes las hace parecer distintas, y conviene tener claro para qué sirve
 * cada cosa: partir TU orden para que no te la lean por delante y no comerte
 * tu propio deslizamiento es ejecución, y la hace cualquiera que mueva tamaño.
 * Hacer que diez compras tuyas parezcan diez compradores distintos es otra
 * cosa. La herramienta es la misma; quien la usa, no.
 *
 * Y esto no lo esconde: en la cadena las N carteras quedan a un salto de un
 * fondeador común, minutos antes de comprar todas.
 *
 * Determinista a propósito — la misma semilla da el mismo reparto — para que
 * lo que ves antes de firmar sea exactamente lo que se firma. */
export function repartir(total, n, variaciónPct, semilla) {
  if (n <= 0) return [];
  if (n === 1) return [total];
  const base = total / BigInt(n);
  if (!variaciónPct || variaciónPct <= 0) {
    const out = new Array(n).fill(base);
    out[0] += total - base * BigInt(n);      // el resto entero, al primero
    return out;
  }
  let x = BigInt(semilla >>> 0) || 1n;
  const rnd = () => {                        // xorshift32: basta para repartir
    x ^= (x << 13n) & 0xffffffffn;
    x ^= x >> 17n;
    x ^= (x << 5n) & 0xffffffffn;
    return Number(x & 0xffffffffn) / 0x100000000;
  };
  const pesos = Array.from({ length: n }, () => 1 + (rnd() * 2 - 1) * (variaciónPct / 100));
  const suma = pesos.reduce((a, b) => a + b, 0);
  const out = pesos.map((p) => (total * BigInt(Math.round((p / suma) * 1e9))) / 1000000000n);
  const dado = out.reduce((a, b) => a + b, 0n);
  out[0] += total - dado;                    // que la suma cuadre al wei
  return out;
}
