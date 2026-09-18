/* ===========================================================================
   PRUEBA DEL CONTRATO FIJO DEL PASO 6 (basey-token.js)

     node tools/probar-token-fijo.mjs

   Lo que tiene que ser verdad para que "Verificado" salga solo en cada
   lanzamiento, y que aqui se comprueba:
     1. Compila sin avisos con el MISMO solc y ajustes que el navegador.
     2. El bytecode de ejecucion NO depende de los argumentos: ni un solo
        inmutable. Si lo hubiera, cada token tendria un codigo distinto y los
        exploradores no podrian emparejarlos con la fuente verificada.
     3. La HUELLA de ese bytecode es la apuntada abajo. Si cambias la fuente (un
        comentario basta), cambia, y esta prueba te para: los tokens nuevos ya no
        casaran con la verificacion de los viejos y hay que verificar el primero
        de la version nueva. Se actualiza la huella a proposito, no por accidente.
     4. Desplegado DE VERDAD con eth_simulateV1: identidad, tokenURI en base64
        IGUAL al de Node (tambien con acentos y emojis), owner() en cero, ERC-20
        completo, y en la variante editable que solo el dueño cambia la imagen y
        que tras renunciar ya nadie puede.
   No firma ni manda nada: todo es simulacion sobre el ultimo bloque.
   =========================================================================== */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
function cargarEthers() {
  const sitios = [process.env.ETHERS_PATH, "ethers",
    path.join(raiz, "..", "blop-contracts", "node_modules", "ethers"),
    path.join(raiz, "..", "cusp-web", "node_modules", "ethers"),
    path.join(raiz, "..", "blop-indexer", "node_modules", "ethers")].filter(Boolean);
  for (const s of sitios) { try { return require(s); } catch { /* el siguiente */ } }
  throw new Error("ethers not found — set ETHERS_PATH");
}
const { ethers } = cargarEthers();
const { BASEY_TOKEN_SOURCE, argsDelToken, contratoDelToken } = await import(pathToFileURL(path.join(raiz, "basey-token.js")).href);

const NODO = process.env.NODO || "https://arc.drpc.org";
const SOLC = process.env.SOLC || [".exe", ""].map((ext) => path.join(process.env.APPDATA || "", "svm", "0.8.24", "solc-0.8.24" + ext))
  .find((f) => fs.existsSync(f));
if (!SOLC) throw new Error("solc 0.8.24 not found — set SOLC");

/* LA HUELLA del bytecode de ejecucion de cada contrato (keccak256). Ver el punto 3. */
const HUELLA = {
  /* apuntadas el 18-sep-2026 con la primera version de basey-token.js */
  BaseyToken: process.env.HUELLA_TOKEN || "0x4f51a2182fbbb77c55711d2301e9ad4de66be64ea53d1f8c352e7ad08e0e02e4",
  BaseyTokenEditable: process.env.HUELLA_EDITABLE || "0x19047945d2cde5268c431bca68668f59636d31f2c48d019eb0b16bf109241aa1",
};

/* ── compilar exactamente como el navegador (app.js, compileAll) ── */
const entrada = {
  language: "Solidity",
  sources: { "Token.sol": { content: BASEY_TOKEN_SOURCE } },
  settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } },
  },
};
const tmp = path.join(os.tmpdir(), "probar-token-fijo-" + process.pid + ".json");
fs.writeFileSync(tmp, JSON.stringify(entrada));
const out = JSON.parse(execFileSync(SOLC, ["--standard-json", tmp], { maxBuffer: 64e6 }).toString());
fs.unlinkSync(tmp);
const errores = (out.errors || []).filter((e) => e.severity === "error");
if (errores.length) throw new Error(errores.map((e) => e.formattedMessage).join("\n"));
const avisos = (out.errors || []).filter((e) => e.severity === "warning");
const K = out.contracts["Token.sol"];

let bien = 0;
const caso = async (nombre, fn) => { await fn(); bien++; console.log("ok  " + nombre); };

await caso("compila sin avisos, y estan los dos contratos", async () => {
  assert.equal(avisos.length, 0, avisos.map((a) => a.formattedMessage).join("\n"));
  assert.ok(K.BaseyToken && K.BaseyTokenEditable);
});

await caso("el bytecode de ejecucion NO depende de los argumentos (cero inmutables)", async () => {
  for (const n of ["BaseyToken", "BaseyTokenEditable"]) {
    const inm = K[n].evm.deployedBytecode.immutableReferences || {};
    assert.equal(Object.keys(inm).length, 0, n + " tiene inmutables: cada token tendria un codigo distinto");
  }
});

const huellas = {};
await caso("la huella del bytecode es la apuntada (o se apunta la primera vez)", async () => {
  for (const n of ["BaseyToken", "BaseyTokenEditable"]) {
    huellas[n] = ethers.keccak256("0x" + K[n].evm.deployedBytecode.object);
    console.log("      " + n.padEnd(19) + " " + huellas[n] + "  (" + K[n].evm.deployedBytecode.object.length / 2 + " B)");
    if (HUELLA[n]) assert.equal(huellas[n], HUELLA[n], n + ": LA FUENTE HA CAMBIADO. Los tokens nuevos ya no casaran con la verificacion de los viejos.");
  }
});

/* ── el nodo ── */
let peticiones = 0;
async function rpc(method, params) {
  peticiones++;
  const r = await fetch(NODO, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error).slice(0, 300));
  return j.result;
}
const hex = (n) => "0x" + BigInt(n).toString(16);
const SALDO = hex(1000n * 10n ** 18n);
async function simular(llamadas, cuentas) {
  const stateOverrides = {};
  for (const a of cuentas) stateOverrides[a] = { balance: SALDO };
  /* GAS JUSTO Y SUMANDO POR DEBAJO DEL DE UN BLOQUE (BASEY.md): con 9 M por
     despliegue y 1,5 M por lectura, tres tokens y treinta lecturas pasaban de 70 M
     y drpc solo contestaba "Temporary internal error". Un despliegue cuesta ~1,5 M. */
  const params = [{ blockStateCalls: [{ stateOverrides, calls: llamadas.map((c) => ({ ...c, gas: hex(c.gas || (c.to ? 300_000 : 3_000_000)) })) }], validation: false }, "latest"];
  for (let intento = 1; ; intento++) {
    try { return (await rpc("eth_simulateV1", params))[0].calls; }
    catch (e) {
      if (intento >= 3 || !/Temporary internal error/.test(e.message)) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * intento));
    }
  }
}
const abi = (n) => new ethers.Interface(K[n].abi);
const desplegar = (n, args, from) => ({ from, data: "0x" + K[n].evm.bytecode.object + abi(n).encodeDeploy(args).slice(2) });
const llamar = (n, to, from, fn, args = []) => ({ from, to, data: abi(n).encodeFunctionData(fn, args) });
const leer = (n, fn, r) => {
  assert.equal(r.status, "0x1", fn + " revierte");
  const v = abi(n).decodeFunctionResult(fn, r.returnData);
  return v.length === 1 ? v[0] : v;
};
const motivo = (r) => {
  try { if (r.returnData && r.returnData.startsWith("0x08c379a0")) return ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + r.returnData.slice(10))[0]; } catch { /* nada */ }
  return r.returnData || "";
};

const YO = "0x00000000000000000000000000000000000ba5e1";
const OTRO = "0x00000000000000000000000000000000000b0b01";
const nonceYo = Number(await rpc("eth_getTransactionCount", [YO, "latest"]));
const dirEn = (k) => ethers.getCreateAddress({ from: YO, nonce: nonceYo + k });

/* Planes como los del paso 6. Tres longitudes de JSON (para los tres restos de
   base64) y uno con acentos y emojis, que en base64 es donde se rompen las cosas. */
const PLAN_A = { nombre: "Pacharan Test", símbolo: "PCT", supply: 1_000_000_000, imagen: "https://ipfs.io/ipfs/QmSWKk2f5tdpN5rZyRHYosW8XSMVx2cZybnB1W3no1wv2J",
  descripción: "the internet made this inevitable", web: "https://basey.finance", twitter: "https://x.com/basey", telegram: "" };
const PLAN_B = { nombre: "Ñandú con acentos 🦤", símbolo: "ÑAN", supply: 420_690_000, imagen: "https://example.com/a.gif",
  /* con un TABULADOR pegado en medio: el hallazgo de la revision del 18-sep. El JSON
     tiene que salir valido igual, porque en un token sin dueño no se arregla despues. */
  descripción: "cañón,	pingüino y un emoji 🚀", web: "", twitter: "", telegram: "https://t.me/nandu" };
const PLAN_C = { nombre: "E", símbolo: "E", supply: 1, imagen: "", descripción: "", web: "", twitter: "", telegram: "" };
/* y uno cuyo JSON mida un multiplo de 3 bytes, para el resto 0 (el que no lleva "=") */
const PLAN_D = { ...PLAN_C, nombre: "Resto cero", símbolo: "RC", descripción: "x" };
while (Buffer.byteLength(argsDelToken(PLAN_D)[3]) % 3 !== 0) PLAN_D.descripción += "x";

await caso("dos tokens distintos: cada getter devuelve SU identidad, y el tokenURI es el base64 de Node", async () => {
  const planes = [PLAN_A, PLAN_B, PLAN_C, PLAN_D];
  const llamadas = [];
  planes.forEach((p) => llamadas.push(desplegar("BaseyToken", argsDelToken(p), YO)));
  const lecturas = ["name", "symbol", "decimals", "totalSupply", "metadataURI", "tokenURI", "logo", "description", "owner"];
  planes.forEach((p, k) => lecturas.forEach((fn) => llamadas.push(llamar("BaseyToken", dirEn(k), YO, fn))));
  planes.forEach((p, k) => llamadas.push(llamar("BaseyToken", dirEn(k), YO, "balanceOf", [YO])));
  const res = await simular(llamadas, [YO]);
  planes.forEach((p, k) => assert.equal(res[k].status, "0x1", "el despliegue " + k + " revierte: " + motivo(res[k])));
  let i = planes.length;
  for (const p of planes) {
    const v = {};
    for (const fn of lecturas) v[fn] = leer("BaseyToken", fn, res[i++]);
    const [, , , json, logo, desc] = argsDelToken(p);
    assert.equal(v.name, p.nombre);
    assert.equal(v.symbol, p.símbolo);
    assert.equal(Number(v.decimals), 18);
    assert.equal(v.totalSupply, BigInt(p.supply) * 10n ** 18n);
    assert.equal(v.metadataURI, json);
    assert.equal(v.logo, logo);
    assert.equal(v.description, desc);
    assert.equal(v.owner, ethers.ZeroAddress, "owner() tiene que ser la direccion cero");
    const esperado = "data:application/json;base64," + Buffer.from(json, "utf8").toString("base64");
    assert.equal(v.tokenURI, esperado, "tokenURI distinto del base64 de Node para " + p.símbolo + " (longitud " + Buffer.byteLength(json) + ", resto " + (Buffer.byteLength(json) % 3) + ")");
    assert.deepEqual(JSON.parse(Buffer.from(v.tokenURI.split(",")[1], "base64").toString("utf8")), JSON.parse(json));
  }
  for (let k = 0; k < planes.length; k++) {
    assert.equal(leer("BaseyToken", "balanceOf", res[i++]), BigInt(planes[k].supply) * 10n ** 18n, "todo el supply al que despliega");
  }
  const restos = new Set(planes.map((p) => Buffer.byteLength(argsDelToken(p)[3]) % 3));
  console.log("      restos de base64 cubiertos: " + [...restos].sort().join(", ") + " (de 0, 1 y 2)");
  assert.equal(restos.size, 3, "hay que cubrir los tres restos de base64");
});

await caso("ERC-20: transfer, approve, transferFrom y la aprobacion infinita que no se gasta", async () => {
  const t = dirEn(0);
  const MAX = ethers.MaxUint256;
  const res = await simular([
    desplegar("BaseyToken", argsDelToken(PLAN_A), YO),
    llamar("BaseyToken", t, YO, "transfer", [OTRO, 1000n]),
    llamar("BaseyToken", t, YO, "approve", [OTRO, MAX]),
    llamar("BaseyToken", t, OTRO, "transferFrom", [YO, OTRO, 500n]),
    llamar("BaseyToken", t, YO, "allowance", [YO, OTRO]),
    llamar("BaseyToken", t, YO, "balanceOf", [OTRO]),
    llamar("BaseyToken", t, OTRO, "transfer", [ethers.ZeroAddress, 1n]),
    llamar("BaseyToken", t, OTRO, "transfer", [YO, 10n ** 30n]),
  ], [YO, OTRO]);
  assert.equal(res[0].status, "0x1");
  assert.equal(res[1].status, "0x1", "transfer");
  assert.equal(res[2].status, "0x1", "approve");
  assert.equal(res[3].status, "0x1", "transferFrom");
  assert.equal(leer("BaseyToken", "allowance", res[4]), MAX, "la infinita no se gasta");
  assert.equal(leer("BaseyToken", "balanceOf", res[5]), 1500n);
  assert.equal(res[6].status, "0x0", "a la direccion cero no");
  assert.equal(motivo(res[6]), "transfer to the zero address");
  assert.equal(res[7].status, "0x0", "sin saldo no");
  assert.equal(motivo(res[7]), "insufficient balance");
});

await caso("editable: solo el dueño cambia la imagen, el tokenURI la sigue, y tras renunciar nadie puede", async () => {
  const t = dirEn(0);
  const nuevo = argsDelToken({ ...PLAN_A, imagen: "https://basey.finance/otra.gif", descripción: "otra" });
  const res = await simular([
    desplegar("BaseyTokenEditable", argsDelToken(PLAN_A), YO),
    llamar("BaseyTokenEditable", t, YO, "owner"),
    llamar("BaseyTokenEditable", t, OTRO, "setMetadata", [nuevo[3], nuevo[4], nuevo[5]]),
    llamar("BaseyTokenEditable", t, YO, "setMetadata", [nuevo[3], nuevo[4], nuevo[5]]),
    llamar("BaseyTokenEditable", t, YO, "tokenURI"),
    llamar("BaseyTokenEditable", t, YO, "logo"),
    llamar("BaseyTokenEditable", t, YO, "transferOwnership", [ethers.ZeroAddress]),
    llamar("BaseyTokenEditable", t, YO, "renounceOwnership"),
    llamar("BaseyTokenEditable", t, YO, "owner"),
    llamar("BaseyTokenEditable", t, YO, "setMetadata", [argsDelToken(PLAN_A)[3], "", ""]),
  ], [YO, OTRO]);
  assert.equal(res[0].status, "0x1");
  assert.equal(leer("BaseyTokenEditable", "owner", res[1]).toLowerCase(), YO);
  assert.equal(res[2].status, "0x0", "otro no puede");
  assert.equal(motivo(res[2]), "not the owner");
  assert.equal(res[3].status, "0x1", "el dueño si");
  assert.equal(leer("BaseyTokenEditable", "tokenURI", res[4]), "data:application/json;base64," + Buffer.from(nuevo[3]).toString("base64"));
  assert.equal(leer("BaseyTokenEditable", "logo", res[5]), "https://basey.finance/otra.gif");
  assert.equal(res[6].status, "0x0", "transferir a la cero no: para eso esta renounceOwnership");
  assert.equal(res[7].status, "0x1", "renunciar");
  assert.equal(leer("BaseyTokenEditable", "owner", res[8]), ethers.ZeroAddress);
  assert.equal(res[9].status, "0x0", "tras renunciar, ya nadie");
});

await caso("un plan sin nombre o sin supply no se despliega", async () => {
  const res = await simular([
    desplegar("BaseyToken", ["", "X", 1n, "{}", "", ""], YO),
    desplegar("BaseyToken", ["X", "X", 0n, "{}", "", ""], YO),
  ], [YO]);
  assert.equal(res[0].status, "0x0");
  assert.equal(res[1].status, "0x0");
});

console.log("\n" + bien + " casos, todos bien | peticiones al nodo: " + peticiones);
if (!HUELLA.BaseyToken) console.log("\nApunta estas huellas en la constante HUELLA de este fichero (o en HUELLA_TOKEN / HUELLA_EDITABLE):\n  BaseyToken         " + huellas.BaseyToken + "\n  BaseyTokenEditable " + huellas.BaseyTokenEditable);
