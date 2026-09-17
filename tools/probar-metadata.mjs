/* ===========================================================================
   PRUEBA DE LA METADATA DEL TOKEN: que se vea FUERA, no solo en nuestro indexer.

     node tools/probar-metadata.mjs

   EL FALLO QUE CUBRE (17-sep-2026). El token que genera solidity.js exponia solo
   `metadataURI()`, que es lo que lee NUESTRO indexer y nadie mas, asi que en GMGN
   salia sin imagen. Medido en cadena ese dia, en tokens que SI se ven a los pocos
   minutos de nacer:
       0x8bad245f…b01f  PAWSINU, pool V4 normal, sin launchpad
                        tokenURI() -> data:application/json;base64,{"image":"https://ipfs.io/…"}
       0x394d38f8…fa2e  FAZE     tokenURI(), logo(), description()
       0x997caf12…866d  barc     logo()
   Asi que el token de aqui expone los cuatro getters. Esta prueba COMPILA la
   fuente que genera la pagina y la DESPLIEGA en un nodo real con eth_simulateV1,
   y luego lee los getters: si un dia se cambia el nombre de uno, aqui salta.

   No firma nada y no manda ninguna transaccion: eth_simulateV1 es una simulacion
   sobre el ultimo bloque. Entorno: NODO (por defecto https://arc.drpc.org, el
   unico de los medidos que lo acepta) y SOLC (ruta al binario 0.8.24).
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
const { generateSource } = await import(pathToFileURL(path.join(raiz, "solidity.js")).href);

const NODO = process.env.NODO || "https://arc.drpc.org";
const SOLC = process.env.SOLC || [".exe", ""].map((ext) => path.join(process.env.APPDATA || "", "svm", "0.8.24", "solc-0.8.24" + ext))
  .find((f) => fs.existsSync(f));
if (!SOLC) throw new Error("solc 0.8.24 not found — set SOLC");

function compilar(fuente, nombre) {
  const entrada = JSON.stringify({
    language: "Solidity", sources: { "Token.sol": { content: fuente } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  });
  const tmp = path.join(os.tmpdir(), "probar-metadata-" + process.pid + ".json");
  fs.writeFileSync(tmp, entrada);
  const out = JSON.parse(execFileSync(SOLC, ["--standard-json", tmp], { maxBuffer: 64e6 }).toString());
  fs.unlinkSync(tmp);
  const errores = (out.errors || []).filter((e) => e.severity === "error");
  if (errores.length) throw new Error(nombre + ":\n" + errores.map((e) => e.formattedMessage).join("\n"));
  const avisos = (out.errors || []).filter((e) => e.severity === "warning");
  const file = out.contracts["Token.sol"];
  const clave = Object.keys(file)[0];
  return { abi: file[clave].abi, bytecode: "0x" + file[clave].evm.bytecode.object, avisos };
}

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
const MIL_USDC_NATIVO = hex(1000n * 10n ** 18n);   // en Arc el saldo nativo ES el USDC

/* Despliega el bytecode y ejecuta las lecturas, todo en la misma simulacion. */
async function desplegarYLeer(bytecode, lecturas, extras = []) {
  const cuenta = "0x00000000000000000000000000000000000ba5e1";
  const nonce = Number(await rpc("eth_getTransactionCount", [cuenta, "latest"]));
  const direccion = ethers.getCreateAddress({ from: cuenta, nonce });
  const llamadas = [
    { from: cuenta, data: bytecode, gas: hex(8_000_000) },
    /* 2 M por llamada de escritura: initialize() del proxy escribe cuatro cadenas y
       el supply, y con 400 k se queda sin gas y drpc solo dice status 0x0. */
    ...extras.map((d) => ({ from: cuenta, to: direccion, data: d, gas: hex(2_000_000) })),
    ...lecturas.map((sig) => ({ from: cuenta, to: direccion, data: ethers.id(sig).slice(0, 10), gas: hex(400_000) })),
  ];
  const params = [{ blockStateCalls: [{ stateOverrides: { [cuenta]: { balance: MIL_USDC_NATIVO } }, calls: llamadas }], validation: false }, "latest"];
  let res;
  for (let intento = 1; ; intento++) {
    try { res = (await rpc("eth_simulateV1", params))[0].calls; break; }
    catch (e) {
      if (intento >= 3 || !/Temporary internal error/.test(e.message)) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * intento));
    }
  }
  assert.equal(res[0].status, "0x1", "el despliegue revierte");
  for (let i = 0; i < extras.length; i++) assert.equal(res[1 + i].status, "0x1", "la llamada " + i + " revierte");
  const salida = {};
  lecturas.forEach((sig, i) => {
    const r = res[1 + extras.length + i];
    salida[sig] = r.status === "0x1" && r.returnData && r.returnData !== "0x"
      ? ethers.AbiCoder.defaultAbiCoder().decode(["string"], r.returnData)[0] : null;
  });
  return { direccion, salida };
}

const base = {
  name: "Metadata Test", symbol: "META", supply: "1000000000", decimals: 18, ownership: "keep",
  taxBps: 0, taxCeilingBps: 1000, maxSupply: "0", maxTxAmount: "0", maxWalletAmount: "0",
  mintable: false, burnable: false, pausable: false, blacklist: false, tradingToggle: false,
  maxTx: false, transferTax: false, permit: false, capped: false, upgradeable: false,
  metaImage: "https://ipfs.io/ipfs/QmSWKk2f5tdpN5rZyRHYosW8XSMVx2cZybnB1W3no1wv2J",
  metaDescription: "un token de prueba, con acentos y \"comillas\"",
  metaWebsite: "https://basey.finance", metaTwitter: "https://x.com/basey", metaTelegram: "",
  metaUri: "", metaMode: "inline", metaMutable: false,
};
const LECTURAS = ["metadataURI()", "tokenURI()", "logo()", "description()", "name()", "symbol()"];
const deJSON = (dataUri) => {
  assert.ok(dataUri.startsWith("data:application/json;base64,"), "tokenURI no es un data URI: " + dataUri.slice(0, 60));
  return JSON.parse(Buffer.from(dataUri.slice("data:application/json;base64,".length), "base64").toString("utf8"));
};

let bien = 0;
const caso = async (nombre, fn) => { await fn(); bien++; console.log("ok  " + nombre); };

console.log("nodo:", NODO, "| solc:", SOLC, "\n");

/* 1. Lo normal: JSON dentro del contrato, fijo. */
await caso("inline fijo: los cuatro getters, y el tokenURI lleva el JSON entero", async () => {
  const cfg = { ...base };
  const { abi, bytecode, avisos } = compilar(generateSource(cfg), "inline fijo");
  assert.equal(avisos.length, 0, "compila sin avisos");
  for (const f of ["metadataURI", "tokenURI", "logo", "description"]) {
    assert.ok(abi.some((x) => x.name === f && x.type === "function"), "falta " + f + "() en el ABI");
  }
  const { salida } = await desplegarYLeer(bytecode, LECTURAS);
  const j = deJSON(salida["tokenURI()"]);
  assert.equal(j.image, cfg.metaImage, "la imagen del tokenURI");
  assert.equal(j.description, cfg.metaDescription, "la descripcion, con acentos y comillas");
  assert.equal(j.website, cfg.metaWebsite);
  assert.equal(j.twitter, cfg.metaTwitter);
  assert.ok(!("telegram" in j), "un campo vacio no viaja");
  assert.deepEqual(JSON.parse(salida["metadataURI()"]), j, "el JSON crudo y el del data URI son el MISMO");
  assert.equal(salida["logo()"], cfg.metaImage, "logo()");
  assert.equal(salida["description()"], cfg.metaDescription, "description()");
  assert.equal(salida["symbol()"], "META");
});

/* 2. Un enlace en vez del JSON: tokenURI tiene que ser el enlace tal cual. */
await caso("enlace: tokenURI() = el enlace, y sin logo() ni description() inventados", async () => {
  const cfg = { ...base, metaMode: "uri", metaUri: "ipfs://QmSWKk2f5tdpN5rZyRHYosW8XSMVx2cZybnB1W3no1wv2J" };
  const { abi, bytecode } = compilar(generateSource(cfg), "enlace");
  assert.ok(!abi.some((x) => x.name === "logo"), "con un enlace no sabemos la imagen: no se declara logo()");
  assert.ok(!abi.some((x) => x.name === "description"), "ni description()");
  const { salida } = await desplegarYLeer(bytecode, LECTURAS);
  assert.equal(salida["tokenURI()"], cfg.metaUri);
  assert.equal(salida["metadataURI()"], cfg.metaUri);
});

/* 3. Sin metadata: ningun getter, y el token sigue siendo un ERC-20 normal. */
await caso("sin metadata: no aparece ningun getter", async () => {
  const cfg = { ...base, metaMode: "none" };
  const { abi, bytecode } = compilar(generateSource(cfg), "sin metadata");
  for (const f of ["metadataURI", "tokenURI", "logo", "description"]) {
    assert.ok(!abi.some((x) => x.name === f), f + "() no deberia existir");
  }
  const { salida } = await desplegarYLeer(bytecode, ["name()", "symbol()"]);
  assert.equal(salida["symbol()"], "META");
});

/* 4. Editable: los cuatro setters cambian SU getter, y ninguno toca a los demas. */
await caso("editable: setTokenURI, setLogo y setDescription cambian lo que se ve fuera", async () => {
  const cfg = { ...base, metaMutable: true };
  const { abi, bytecode } = compilar(generateSource(cfg), "editable");
  for (const f of ["setMetadataURI", "setTokenURI", "setLogo", "setDescription"]) {
    assert.ok(abi.some((x) => x.name === f), "falta " + f + "()");
  }
  const iface = new ethers.Interface([
    "function setTokenURI(string)", "function setLogo(string)", "function setDescription(string)",
  ]);
  const nuevoUri = "data:application/json;base64," + Buffer.from('{"image":"https://basey.finance/otra.gif"}').toString("base64");
  const { salida } = await desplegarYLeer(bytecode, LECTURAS, [
    iface.encodeFunctionData("setTokenURI", [nuevoUri]),
    iface.encodeFunctionData("setLogo", ["https://basey.finance/otra.gif"]),
    iface.encodeFunctionData("setDescription", ["otra cosa"]),
  ]);
  assert.equal(salida["tokenURI()"], nuevoUri, "el tokenURI nuevo");
  assert.equal(deJSON(salida["tokenURI()"]).image, "https://basey.finance/otra.gif");
  assert.equal(salida["logo()"], "https://basey.finance/otra.gif");
  assert.equal(salida["description()"], "otra cosa");
  assert.equal(JSON.parse(salida["metadataURI()"]).image, base.metaImage, "metadataURI NO lo cambia setTokenURI");
});

/* 5. Una imagen y una descripcion vacias no dejan getters vacios por ahi. */
await caso("sin imagen ni descripcion: no se declaran logo() ni description()", async () => {
  const cfg = { ...base, metaImage: "", metaDescription: "" };
  const { abi, bytecode } = compilar(generateSource(cfg), "sin imagen");
  assert.ok(!abi.some((x) => x.name === "logo"));
  assert.ok(!abi.some((x) => x.name === "description"));
  const { salida } = await desplegarYLeer(bytecode, ["tokenURI()", "metadataURI()"]);
  const j = deJSON(salida["tokenURI()"]);
  assert.ok(!("image" in j) && !("description" in j), "no se inventan campos");
  assert.equal(j.website, base.metaWebsite);
});

/* 6. Proxy actualizable: la metadata se pone en initialize(), no en el constructor. */
await caso("actualizable: la metadata se escribe en initialize()", async () => {
  const cfg = { ...base, upgradeable: true, metaMutable: true };
  const fuente = generateSource(cfg);
  assert.match(fuente, /function initialize\(\) external \{/, "tiene initialize()");
  assert.match(fuente, /tokenURI = "data:application\/json;base64,/, "el tokenURI se asigna");
  const { bytecode } = compilar(fuente, "actualizable");
  const iface = new ethers.Interface(["function initialize()"]);
  const { salida } = await desplegarYLeer(bytecode, LECTURAS, [iface.encodeFunctionData("initialize", [])]);
  assert.equal(deJSON(salida["tokenURI()"]).image, base.metaImage);
  assert.equal(salida["logo()"], base.metaImage);
});

/* 7. LA RENUNCIA DEL PASO 6 (18-sep): sin ningun poder de dueño, `owner()` tiene que
      contestar la direccion cero. Un token que ni tiene el getter le sale al
      rastreador como interrogacion, no como renunciado, y eso es lo que vio el dueño. */
await caso("renuncia: owner() contesta la direccion cero y no hay ningun setter", async () => {
  const cfg = { ...base, ownership: "renounce", metaMutable: false };
  const { abi, bytecode } = compilar(generateSource(cfg), "renuncia");
  assert.ok(abi.some((x) => x.name === "owner" && x.stateMutability === "view"), "falta owner()");
  for (const f of ["setMetadataURI", "setTokenURI", "setLogo", "setDescription", "transferOwnership", "renounceOwnership"]) {
    assert.ok(!abi.some((x) => x.name === f), f + "() no puede existir si no hay dueño");
  }
  const cuenta = "0x00000000000000000000000000000000000ba5e1";
  const nonce = Number(await rpc("eth_getTransactionCount", [cuenta, "latest"]));
  const direccion = ethers.getCreateAddress({ from: cuenta, nonce });
  const llamadas = [
    { from: cuenta, data: bytecode, gas: hex(8_000_000) },
    { from: cuenta, to: direccion, data: ethers.id("owner()").slice(0, 10), gas: hex(400_000) },
    { from: cuenta, to: direccion, data: ethers.id("tokenURI()").slice(0, 10), gas: hex(400_000) },
  ];
  const params = [{ blockStateCalls: [{ stateOverrides: { [cuenta]: { balance: MIL_USDC_NATIVO } }, calls: llamadas }], validation: false }, "latest"];
  const res = (await rpc("eth_simulateV1", params))[0].calls;
  assert.equal(res[0].status, "0x1", "el despliegue revierte");
  const [dueño] = ethers.AbiCoder.defaultAbiCoder().decode(["address"], res[1].returnData);
  assert.equal(dueño, ethers.ZeroAddress, "owner() tiene que ser la direccion cero");
  assert.equal(deJSON(ethers.AbiCoder.defaultAbiCoder().decode(["string"], res[2].returnData)[0]).image, base.metaImage,
    "y la imagen sigue dentro del contrato");
});

/* 8. Y con identidad editable NO se renuncia: el setter necesita dueño. */
await caso("editable: owner() es quien despliega, no la direccion cero", async () => {
  const cfg = { ...base, ownership: "keep", metaMutable: true };
  const { abi } = compilar(generateSource(cfg), "editable con dueño");
  assert.ok(abi.some((x) => x.name === "setTokenURI"), "tiene setTokenURI");
  assert.ok(abi.some((x) => x.name === "renounceOwnership"), "y se puede renunciar despues desde Your tokens");
});

console.log("\n" + bien + " casos, todos bien | peticiones al nodo: " + peticiones);
