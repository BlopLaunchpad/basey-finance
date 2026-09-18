/* ===========================================================================
   PRUEBA DE esperarMinada (app.js): la espera a que se mine, CON PLAZO.

     node tools/probar-espera.mjs

   EL FALLO QUE CUBRE (18-sep-2026): el primer lanzamiento con el contrato fijo se
   quedo en "sign 1 of 4: deploy the token" para siempre. Un nodo acepto la
   transaccion de la rapida, no la paso a nadie y no se mino (nonce 194 minado y
   194 pendiente en los cinco nodos), y waitForDeployment no tiene plazo.

   NO PRUEBA UNA COPIA: saca esperarMinada del propio app.js y la ejecuta con
   transacciones falsas que imitan a las de ethers 6.13.2 (la que carga la pagina),
   cuyo wait(confirms, timeout) rechaza con code "TIMEOUT" al vencer.
   Nada toca la red.
   =========================================================================== */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = fs.readFileSync(path.join(raiz, "app.js"), "utf8");
const cab = "async function esperarMinada(";
const i = APP.indexOf(cab);
assert.ok(i >= 0 && APP.indexOf(cab, i + 1) < 0, "esperarMinada tiene que estar una vez en app.js");
const fin = APP.slice(i).match(/\r?\n\}\r?\n/);
const esperarMinada = new Function(APP.slice(i, i + fin.index + fin[0].length) + "\nreturn esperarMinada;")();

const PLAZO = (ms) => Object.assign(new Error("wait for transaction timeout"), { code: "TIMEOUT", ms });
function txFalsa({ espera, laTiene = null, nonceCadena = 194, nonce = 194 }) {
  const pedidos = [];
  return {
    hash: "0x" + "ab".repeat(32), nonce, from: "0x6cbc5dcfd337016e8d9aeab267c0b1873bbfe49f",
    wait: (conf, ms) => { pedidos.push({ conf, ms }); return espera(ms); },
    provider: {
      getTransaction: async () => laTiene,
      getTransactionCount: async (a, etiqueta) => { assert.equal(etiqueta, "latest"); return nonceCadena; },
    },
    pedidos,
  };
}
let bien = 0;
const caso = async (n, fn) => { await fn(); bien++; console.log("ok  " + n); };
const nada = () => {};

await caso("minada a tiempo: devuelve el recibo, y pide 1 confirmacion con plazo de 90 s", async () => {
  const tx = txFalsa({ espera: async () => ({ status: 1, contractAddress: "0x" + "11".repeat(20) }) });
  const r = await esperarMinada(tx, nada);
  assert.equal(r.status, 1);
  assert.deepEqual(tx.pedidos, [{ conf: 1, ms: 90000 }]);
});

await caso("revertida: lo dice con el hash, no devuelve un token que no existe", async () => {
  const tx = txFalsa({ espera: async () => ({ status: 0 }) });
  await assert.rejects(esperarMinada(tx, nada), /reverted on chain: 0xabab/);
});

await caso("plazo vencido y NINGUN nodo la tiene, nonce sin gastar: perdida, seguro relanzar", async () => {
  const tx = txFalsa({ espera: async (ms) => { throw PLAZO(ms); }, laTiene: null, nonceCadena: 194, nonce: 194 });
  await assert.rejects(esperarMinada(tx, nada, 50), (e) => {
    assert.match(e.message, /not mined after 0 s/);
    assert.match(e.message, /hash 0xabab/);
    assert.match(e.message, /nonce 194, wallet nonce on chain 194/);
    assert.match(e.message, /it was dropped, nothing was spent, and it is safe to run the plan again/);
    return true;
  });
});

await caso("plazo vencido pero un nodo AUN la tiene: NO dice que es seguro relanzar", async () => {
  const tx = txFalsa({ espera: async (ms) => { throw PLAZO(ms); }, laTiene: { hash: "0x" + "ab".repeat(32) } });
  await assert.rejects(esperarMinada(tx, nada, 50), (e) => {
    assert.doesNotMatch(e.message, /safe to run the plan again/);
    assert.match(e.message, /may still have it pending/);
    return true;
  });
});

await caso("plazo vencido y el nonce YA gastado (la mino otro o se reemplazo): tampoco 'seguro'", async () => {
  const tx = txFalsa({ espera: async (ms) => { throw PLAZO(ms); }, laTiene: null, nonceCadena: 195, nonce: 194 });
  await assert.rejects(esperarMinada(tx, nada, 50), (e) => { assert.doesNotMatch(e.message, /safe to run the plan again/); return true; });
});

await caso("plazo vencido y los nodos no contestan: no se afirma nada", async () => {
  const tx = txFalsa({ espera: async (ms) => { throw PLAZO(ms); } });
  tx.provider.getTransaction = async () => { throw new Error("red"); };
  tx.provider.getTransactionCount = async () => { throw new Error("red"); };
  await assert.rejects(esperarMinada(tx, nada, 50), (e) => {
    assert.doesNotMatch(e.message, /safe to run the plan again/);
    assert.doesNotMatch(e.message, /wallet nonce on chain/);
    return true;
  });
});

await caso("cualquier otro error del nodo se deja pasar tal cual", async () => {
  const tx = txFalsa({ espera: async () => { throw Object.assign(new Error("replacement transaction underpriced"), { code: "REPLACEMENT_UNDERPRICED" }); } });
  await assert.rejects(esperarMinada(tx, nada), /replacement transaction underpriced/);
});

console.log("\n" + bien + " casos, todos bien (sin red)");
