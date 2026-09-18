/* ===========================================================================
   PRUEBA DE LA FABRICA V4 DEL PASO 6, CONTRA LA V4 REAL DE ARC

     node tools/probar-fabrica-v4.mjs

   Despliega BaseyLaunchFactoryV4 (y con ella el LaunchLocker de openlaunch) y lanza
   con ella de verdad, todo con eth_simulateV1 sobre el ultimo bloque de Arc: el
   PoolManager, el PositionManager, Permit2 y la USDC son los reales. No firma ni
   manda nada. Lo que tiene que ser verdad:
     A. lanzar con el muro BLOQUEADO: token (el BaseyToken verificado, mismo
        bytecode), pool V4 USDC/token al precio pedido, muro dentro del locker y
        registrado a nombre del lanzador, tesoreria al lanzador, y la compra atomica
        hecha en la misma transaccion. Y collect() le paga a EL las comisiones.
     B. lanzar SIN bloquear con el token editable: el NFT es del lanzador, el token
        tambien (owner), y lockPosition() lo mete despues en el locker a su nombre.
     C. todo lo que no debe pasar, revierte: codigo de token desconocido, ticks
        malos, token por debajo de la USDC, slippage, callback de fuera, y bloquear
        algo que no es tuyo.
   =========================================================================== */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { ethers } = require(path.join(raiz, "..", "blop-contracts", "node_modules", "ethers"));
const { entradaEstandar, compilar } = await import(pathToFileURL(path.join(raiz, "tools", "compilar-v4.mjs")).href);
const { BASEY_TOKEN_SOURCE, argsDelToken } = await import(pathToFileURL(path.join(raiz, "basey-token.js")).href);

const NODO = process.env.NODO || "https://arc.drpc.org";
const V4 = {
  poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  positionManager: "0x6049c9a0e26405c0985f9e3685c87d0ae917f82b",
  stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};
const USDC = "0x3600000000000000000000000000000000000000";

/* ── compilar: la fabrica (0.8.26 viaIR, como openlaunch) y el token (0.8.24, como la pagina) ── */
const { out: outF } = compilar(await entradaEstandar());
const FAB = outF.contracts["src/BaseyLaunchFactoryV4.sol"].BaseyLaunchFactoryV4;
const LOCK = outF.contracts["src/LaunchLocker.sol"].LaunchLocker;
const SOLC24 = [".exe", ""].map((e) => path.join(process.env.APPDATA, "svm", "0.8.24", "solc-0.8.24" + e)).find((f) => fs.existsSync(f));
function compilar24(fuente) {
  const e = { language: "Solidity", sources: { "Token.sol": { content: fuente } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } } };
  return JSON.parse(execFileSync(SOLC24, ["--standard-json"], { input: JSON.stringify(e), maxBuffer: 64e6 }).toString()).contracts["Token.sol"];
}
const TK = compilar24(BASEY_TOKEN_SOURCE);
const CODIGO_TOKEN = "0x" + TK.BaseyToken.evm.bytecode.object;
const CODIGO_EDITABLE = "0x" + TK.BaseyTokenEditable.evm.bytecode.object;
const LECTOR = compilar24("// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\ncontract Lector { function hash(address a) external view returns (bytes32 h) { assembly { h := extcodehash(a) } } }").Lector;
const HUELLA_TOKEN = "0x4f51a2182fbbb77c55711d2301e9ad4de66be64ea53d1f8c352e7ad08e0e02e4";   // la del BaseyToken verificado

const iF = new ethers.Interface(FAB.abi);
const iL = new ethers.Interface(LOCK.abi);
const iT = new ethers.Interface(TK.BaseyTokenEditable.abi);
const iE = new ethers.Interface(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
const iP = new ethers.Interface(["function ownerOf(uint256) view returns (address)", "function approve(address,uint256)", "function nextTokenId() view returns (uint256)"]);
const iS = new ethers.Interface(["function getSlot0(bytes32) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);
const iLec = new ethers.Interface(LECTOR.abi);

/* ── el nodo ── */
let peticiones = 0;
async function rpc(method, params) {
  peticiones++;
  const r = await fetch(NODO, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(90000) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error).slice(0, 300));
  return j.result;
}
const hex = (n) => "0x" + BigInt(n).toString(16);
const SALDO = hex(1000n * 10n ** 18n);   // en Arc el saldo nativo ES la USDC (y la cara ERC20 lo refleja)
/* varios bloques: el estado pasa de uno a otro. Gas por llamada, sumando por debajo del bloque. */
async function simular(bloques, cuentas) {
  const stateOverrides = {};
  for (const a of cuentas) stateOverrides[a] = { balance: SALDO };
  const blockStateCalls = bloques.map((calls, i) => ({ ...(i === 0 ? { stateOverrides } : {}),
    calls: calls.map((c) => ({ ...c, gas: hex(c.gas || (c.to ? 700_000 : 9_000_000)) })) }));
  for (let intento = 1; ; intento++) {
    try { return (await rpc("eth_simulateV1", [{ blockStateCalls, validation: false }, "latest"])).map((b) => b.calls); }
    catch (e) {
      if (intento >= 3 || !/Temporary internal error/.test(e.message)) throw e;
      await new Promise((ok) => setTimeout(ok, 2500 * intento));
    }
  }
}
const motivo = (r) => {
  const d = r.returnData || "0x";
  try { const e = iF.parseError(d); if (e) return e.name; } catch { /* no es de la fabrica */ }
  try { const e = iL.parseError(d); if (e) return "locker." + e.name; } catch { /* ni del locker */ }
  try { if (d.startsWith("0x08c379a0")) return ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + d.slice(10))[0]; } catch { /* nada */ }
  return d.slice(0, 10);
};
const ok = (r, que) => assert.equal(r.status, "0x1", que + " revierte: " + motivo(r));
const lee = (iface, fn, r) => { ok(r, fn); const v = iface.decodeFunctionResult(fn, r.returnData); return v.length === 1 ? v[0] : v; };

/* ── las cuentas y las direcciones previstas ── */
const DEPLOYER = "0x00000000000000000000000000000000000de901";
const L1 = "0x000000000000000000000000000000000000ba51";
const L2 = "0x000000000000000000000000000000000000ba52";
const OTRO = "0x0000000000000000000000000000000000000b0b";
const nonce = Number(await rpc("eth_getTransactionCount", [DEPLOYER, "latest"]));
const FABRICA = ethers.getCreateAddress({ from: DEPLOYER, nonce });
const LOCKER = ethers.getCreateAddress({ from: FABRICA, nonce: 1 });   // el primer CREATE de un contrato usa nonce 1
const LECTOR_DIR = ethers.getCreateAddress({ from: DEPLOYER, nonce: nonce + 1 });

/* el precio: 5.000 $ de capitalizacion con 1.000 M -> 5e-6 $ por token.
   tick = log1.0001(tokens crudos por USDC cruda); el muro, del 2 % al 100x por encima */
const tickDe = (usdPorToken) => Math.floor(Math.log((1 / usdPorToken) * 1e18 / 1e6) / Math.log(1.0001));
const alEspaciado = (t) => Math.floor(t / 200) * 200;
const START = alEspaciado(tickDe(5e-6));
const WALL_UPPER = START - 200;
const WALL_LOWER = alEspaciado(START - Math.round(Math.log(100) / Math.log(1.0001)));

function argsCodificados(plan) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["string", "string", "uint256", "string", "string", "string"], argsDelToken(plan));
}
/* una sal cuyo token quede por encima (o por debajo, para la prueba) de la USDC */
function buscarSal(lanzador, codigo, plan, arriba = true) {
  const initHash = ethers.keccak256(ethers.concat([codigo, argsCodificados(plan)]));
  for (let i = 0; i < 5000; i++) {
    const sal = ethers.keccak256(ethers.toUtf8Bytes("sal-" + plan.símbolo + "-" + i));
    const scoped = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [lanzador, sal]));
    const dir = ethers.getCreate2Address(FABRICA, scoped, initHash);
    if ((BigInt(dir) > BigInt(USDC)) === arriba) return { sal, dir };
  }
  throw new Error("sin sal");
}
function params(plan, { codigo = CODIGO_TOKEN, sal, lock = true, buy = 25_000_000n, minOut = 1n, ticks = [START, WALL_LOWER, WALL_UPPER], recipients = [] } = {}) {
  const supply = BigInt(plan.supply) * 10n ** 18n;
  const a = argsDelToken(plan);
  return [codigo, a[0], a[1], a[2], a[3], a[4], a[5], sal, 10_000, ticks[0], ticks[1], ticks[2],
    supply * 85n / 100n, lock, recipients, buy, minOut];
}
const launch = (from, p, gas = 8_000_000) => ({ from, to: FABRICA, data: iF.encodeFunctionData("launch", [p]), gas });
const c = (from, to, iface, fn, args = [], gas) => ({ from, to, data: iface.encodeFunctionData(fn, args), gas });

const PLAN_A = { nombre: "Basey V4 Test", símbolo: "BV4", supply: 1_000_000_000, imagen: "https://ipfs.io/ipfs/QmSWKk2f5tdpN5rZyRHYosW8XSMVx2cZybnB1W3no1wv2J",
  descripción: "fabrica v4", web: "https://basey.finance", twitter: "", telegram: "" };
const PLAN_B = { ...PLAN_A, nombre: "Editable V4", símbolo: "EV4" };
const salA = buscarSal(L1, CODIGO_TOKEN, PLAN_A);
const salB = buscarSal(L2, CODIGO_EDITABLE, PLAN_B);

let bien = 0;
const caso = async (n, fn) => { await fn(); bien++; console.log("ok  " + n); };
console.log("nodo " + NODO + " | fabrica prevista " + FABRICA + " | locker " + LOCKER);
console.log("ticks: inicio " + START + ", muro " + WALL_LOWER + " -> " + WALL_UPPER + "\n");

/* ── una sola simulacion con todo, en bloques ── */
const ctor = iF.encodeDeploy([V4.poolManager, V4.positionManager, V4.permit2, USDC, ethers.keccak256(CODIGO_TOKEN), ethers.keccak256(CODIGO_EDITABLE)]);
const bloque1 = [
  { from: DEPLOYER, data: "0x" + FAB.evm.bytecode.object + ctor.slice(2), gas: 12_000_000 },
  { from: DEPLOYER, data: "0x" + LECTOR.evm.bytecode.object, gas: 300_000 },
];
const bloque2 = [   // A: con el muro bloqueado
  c(L1, USDC, iE, "balanceOf", [L1]),
  c(L1, USDC, iE, "approve", [FABRICA, 25_000_000n]),
  launch(L1, params(PLAN_A, { sal: salA.sal })),
  c(L1, USDC, iE, "balanceOf", [L1]),
  c(L1, salA.dir, iT, "balanceOf", [L1]),
  c(L1, salA.dir, iT, "totalSupply"),
  c(L1, salA.dir, iT, "owner"),
  c(L1, LOCKER, iL, "tokenIdOf", [salA.dir]),
  c(L1, FABRICA, iF, "infoOf", [salA.dir]),
  c(L1, LECTOR_DIR, iLec, "hash", [salA.dir]),
  c(L1, salA.dir, iT, "tokenURI"),
];
const res1 = await simular([bloque1, bloque2], [DEPLOYER, L1, L2, OTRO]);
const [b1, b2] = res1;

await caso("despliega la fabrica, y la fabrica despliega el locker (el de openlaunch)", async () => {
  ok(b1[0], "despliegue de la fabrica");
  ok(b1[1], "lector");
});

let tokenIdA, boughtA;
await caso("A. lanza con el muro bloqueado y la compra atomica en UNA transaccion", async () => {
  ok(b2[1], "approve USDC");
  const [tokenAddr, tokenId, bought] = lee(iF, "launch", b2[2]);
  tokenIdA = tokenId; boughtA = bought;
  assert.equal(tokenAddr.toLowerCase(), salA.dir.toLowerCase(), "el token esta donde se predijo");
  assert.ok(BigInt(tokenAddr) > BigInt(USDC), "el token va por encima de la USDC: USDC es currency0");
  assert.ok(bought > 0n, "la compra atomica compro algo");
  console.log("      token " + tokenAddr + " | NFT #" + tokenId + " | comprados " + ethers.formatUnits(bought, 18) + " | gas " + Number(b2[2].gasUsed).toLocaleString("es"));
});

await caso("A. el lanzador paga 25 USDC exactas y recibe la tesoreria (15 %) mas lo comprado", async () => {
  const antes = lee(iE, "balanceOf", b2[0]);
  const despues = lee(iE, "balanceOf", b2[3]);
  assert.equal(antes - despues, 25_000_000n, "25 USDC salen del lanzador");
  const supply = lee(iT, "totalSupply", b2[5]);
  const suyo = lee(iT, "balanceOf", b2[4]);
  assert.equal(supply, 10n ** 27n);
  assert.ok(suyo >= supply * 15n / 100n + boughtA - 10n ** 18n && suyo <= supply * 15n / 100n + boughtA + 10n ** 20n,
    "tesoreria + comprado (con redondeo del muro): " + ethers.formatUnits(suyo, 18));
});

await caso("A. el token es EL MISMO bytecode que el BaseyToken ya verificado, y sin dueño", async () => {
  assert.equal(lee(iLec, "hash", b2[9]), HUELLA_TOKEN, "misma huella: Blockscout lo emparejara solo");
  assert.equal(lee(iT, "owner", b2[6]), ethers.ZeroAddress);
  assert.ok(lee(iT, "tokenURI", b2[10]).startsWith("data:application/json;base64,"));
});

await caso("A. el muro esta DENTRO del locker, registrado a nombre del lanzador", async () => {
  assert.equal(lee(iL, "tokenIdOf", b2[7]), tokenIdA);
  const info = lee(iF, "infoOf", b2[8]);
  assert.equal(info[1].toLowerCase(), L1, "launcher");
  assert.equal(info[4], true, "locked");
  assert.equal(Number(info[0]), Number(tokenIdA));
});

/* segunda simulacion: lo que pasa DESPUES (collect, precio, B y C). Se repite lo necesario. */
const bloque3 = [
  c(OTRO, V4.positionManager, iP, "ownerOf", [tokenIdA]),
  c(OTRO, LOCKER, iL, "recipientsOf", [tokenIdA]),
  c(OTRO, USDC, iE, "balanceOf", [L1]),
  c(OTRO, LOCKER, iL, "collect", [tokenIdA], 1_500_000),
  c(OTRO, USDC, iE, "balanceOf", [L1]),
  // B: sin bloquear, token editable
  c(L2, USDC, iE, "approve", [FABRICA, 10_000_000n]),
  launch(L2, params(PLAN_B, { codigo: CODIGO_EDITABLE, sal: salB.sal, lock: false, buy: 10_000_000n })),
  c(L2, salB.dir, iT, "owner"),
  c(L2, LOCKER, iL, "tokenIdOf", [salB.dir]),
];
const res2 = await simular([bloque1, bloque2, bloque3], [DEPLOYER, L1, L2, OTRO]);
const b3 = res2[2];

await caso("A. collect() lo puede llamar cualquiera y las comisiones le llegan AL LANZADOR", async () => {
  assert.equal(lee(iP, "ownerOf", b3[0]).toLowerCase(), LOCKER.toLowerCase());
  const rec = lee(iL, "recipientsOf", b3[1]);
  assert.equal(rec.length, 1);
  assert.equal(rec[0][0].toLowerCase(), L1);
  assert.equal(Number(rec[0][1]), 10000);
  ok(b3[3], "collect");
  const cobrado = lee(iE, "balanceOf", b3[4]) - lee(iE, "balanceOf", b3[2]);
  /* el 1 % de 25 USDC es 0,25: lo que cobra el lanzador tiene que rondarlo */
  assert.ok(cobrado >= 240_000n && cobrado <= 250_000n, "comisiones cobradas: " + ethers.formatUnits(cobrado, 6) + " USDC");
  console.log("      comisiones de la compra atomica cobradas por el lanzador: " + ethers.formatUnits(cobrado, 6) + " USDC");
});

let tokenIdB;
await caso("B. sin bloquear y editable: el NFT y el token son del lanzador", async () => {
  const [tokenAddr, tokenId] = lee(iF, "launch", b3[6]);
  tokenIdB = tokenId;
  assert.equal(tokenAddr.toLowerCase(), salB.dir.toLowerCase());
  assert.equal(lee(iT, "owner", b3[7]).toLowerCase(), L2, "setMetadata queda en manos del lanzador");
  assert.equal(lee(iL, "tokenIdOf", b3[8]), 0n, "no esta en el locker");
});

/* Arc da 30 M de gas por bloque, y el nodo suma el gas PEDIDO, no el gastado: cuatro
   lanzamientos de 8 M en un bloque (32 M) los corta con "Temporary internal error". Por
   eso el bloqueo posterior va en un bloque y los reverts en otro, y los que revierten
   antes de desplegar nada piden solo 2 M. */
/* EL ATAQUE: el locker admite UNA posicion por token. Cualquiera con un poco del token
   podria abrir otra pool USDC/token (aqui al 0,3 %), acuñar polvo y bloquearlo antes,
   dejando fuera para siempre el muro de verdad. lockPosition solo acepta EL muro. */
const K2 = [USDC, salB.dir, 3000, 60, ethers.ZeroAddress];
const iPM = new ethers.Interface(["function initialize((address,address,uint24,int24,address) key, uint160 sqrtPriceX96) returns (int24)"]);
const iP2 = new ethers.Interface(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const iMod = new ethers.Interface(["function modifyLiquidities(bytes unlockData, uint256 deadline) payable"]);
const precioDe = (tick) => BigInt(Math.floor(Math.sqrt(1.0001 ** tick) * 2 ** 96));
const POLVO_LO = Math.floor((START - 6000) / 60) * 60, POLVO_HI = Math.floor((START - 600) / 60) * 60;
const mintPolvo = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", "bytes[]"], ["0x020d", [
  ethers.AbiCoder.defaultAbiCoder().encode(["(address,address,uint24,int24,address)", "int24", "int24", "uint256", "uint128", "uint128", "address", "bytes"],
    [K2, POLVO_LO, POLVO_HI, 10n ** 15n, 0n, 10n ** 24n, L2, "0x"]),
  ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [USDC, salB.dir]),
]]);
const idPolvo = tokenIdB + 1n;   // el siguiente NFT del PositionManager en esta simulacion
const bloque4 = [
  c(L2, salB.dir, iT, "approve", [V4.permit2, ethers.MaxUint256]),
  c(L2, V4.permit2, iP2, "approve", [salB.dir, V4.positionManager, (1n << 160n) - 1n, (1n << 48n) - 1n]),
  c(L2, V4.poolManager, iPM, "initialize", [K2, precioDe(START)], 1_000_000),
  c(L2, V4.positionManager, iMod, "modifyLiquidities", [mintPolvo, (1n << 40n)], 1_500_000),
  c(L2, V4.positionManager, iP, "ownerOf", [idPolvo]),
  c(L2, V4.positionManager, iP, "approve", [FABRICA, idPolvo]),
  c(L2, FABRICA, iF, "lockPosition", [idPolvo, []], 900_000),             // polvo de otra pool: NO
  // lo de siempre: el muro de verdad se sigue pudiendo bloquear
  c(L2, V4.positionManager, iP, "ownerOf", [tokenIdB]),
  c(OTRO, FABRICA, iF, "lockPosition", [tokenIdB, []], 900_000),            // no es suyo
  c(L2, V4.positionManager, iP, "approve", [FABRICA, tokenIdB]),
  c(L2, FABRICA, iF, "lockPosition", [tokenIdB, []], 900_000),
  c(L2, V4.positionManager, iP, "ownerOf", [tokenIdB]),
  c(L2, LOCKER, iL, "recipientsOf", [tokenIdB]),
  c(L2, FABRICA, iF, "lockPosition", [tokenIdB, []], 900_000),              // ya no es suyo: es del locker
];
const bloque5 = [   // C: lo que tiene que revertir
  launch(L1, params(PLAN_A, { codigo: "0x" + "60".repeat(40), sal: salA.sal }), 2_000_000),                     // codigo desconocido
  launch(L1, params({ ...PLAN_A, símbolo: "BT" }, { sal: buscarSal(L1, CODIGO_TOKEN, { ...PLAN_A, símbolo: "BT" }).sal, ticks: [START, WALL_LOWER + 100, WALL_UPPER] }), 2_000_000),  // borde del muro sin espaciar
  launch(L1, params({ ...PLAN_A, símbolo: "BLO" }, { sal: buscarSal(L1, CODIGO_TOKEN, { ...PLAN_A, símbolo: "BLO" }, false).sal }), 2_000_000),  // por debajo de la USDC
  c(L1, USDC, iE, "approve", [FABRICA, 25_000_000n]),
  launch(L1, params({ ...PLAN_A, símbolo: "SLP" }, { sal: buscarSal(L1, CODIGO_TOKEN, { ...PLAN_A, símbolo: "SLP" }).sal, minOut: 10n ** 30n })),  // slippage
  c(OTRO, FABRICA, iF, "unlockCallback", ["0x"]),                                                     // callback de fuera
];
/* EL OTRO ATAQUE (revision del 18-sep, probado por el revisor): lanzar SIN bloquear,
   sacar la liquidez del muro (con los USDC de quien haya comprado) y bloquear despues el
   NFT vaciado. La fabrica lo daria por bloqueado y un rastreador lo contaria como
   quemado; y un muro a CERO hace revertir collect(), y con el collectMany() de todos.
   lockPosition exige ahora el muro ENTERO: la liquidez que se acuño al lanzar. Aqui se
   saca solo un pelo (1.000 unidades de liquidez) y ya tiene que revertir. */
const L3 = "0x000000000000000000000000000000000000ba53";
const PLAN_C = { ...PLAN_A, nombre: "Drenado V4", símbolo: "DV4" };
const salC = buscarSal(L3, CODIGO_TOKEN, PLAN_C);
const idC = idPolvo + 1n;   // el NFT siguiente al polvo
const sacarUnPelo = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", "bytes[]"], ["0x0111", [
  ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256", "uint128", "uint128", "bytes"], [idC, 1000n, 0n, 0n, "0x"]),
  ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address"], [USDC, salC.dir, L3]),
]]);
const bloque6 = [
  launch(L3, params(PLAN_C, { sal: salC.sal, lock: false, buy: 0n })),
  c(L3, V4.positionManager, iP, "ownerOf", [idC]),
  c(L3, V4.positionManager, iMod, "modifyLiquidities", [sacarUnPelo, (1n << 40n)], 1_500_000),
  c(L3, V4.positionManager, iP, "approve", [FABRICA, idC]),
  c(L3, FABRICA, iF, "lockPosition", [idC, []], 900_000),
];
const res3 = await simular([bloque1, bloque2, bloque3, bloque4, bloque5, bloque6], [DEPLOYER, L1, L2, L3, OTRO]);
const ataque = res3[3].slice(0, 7);
const b4 = [...res3[3].slice(7), ...res3[4]];
const b6 = res3[5];

await caso("B. nadie puede bloquear polvo de OTRA pool del token y dejar fuera el muro", async () => {
  ["approve del token", "approve de permit2", "initialize de la otra pool", "mint del polvo"].forEach((q, i) => ok(ataque[i], q));
  assert.equal(lee(iP, "ownerOf", ataque[4]).toLowerCase(), L2, "el polvo existe y es de L2");
  ok(ataque[5], "approve del NFT de polvo");
  assert.equal(ataque[6].status, "0x0", "bloquear el polvo tiene que revertir");
  assert.equal(motivo(ataque[6]), "NotOurLaunch");
});

await caso("B. lockPosition(): solo el dueño, y mete el NFT en el locker a su nombre", async () => {
  assert.equal(lee(iP, "ownerOf", b4[0]).toLowerCase(), L2);
  assert.equal(b4[1].status, "0x0", "otro no puede bloquear lo tuyo");
  assert.equal(motivo(b4[1]), "NotPositionOwner");
  ok(b4[2], "approve del NFT");
  ok(b4[3], "lockPosition");
  assert.equal(lee(iP, "ownerOf", b4[4]).toLowerCase(), LOCKER.toLowerCase());
  const rec = lee(iL, "recipientsOf", b4[5]);
  assert.equal(rec[0][0].toLowerCase(), L2);
  assert.equal(b4[6].status, "0x0", "no se bloquea dos veces");
});

await caso("B. no se puede bloquear un muro al que ya se le ha sacado liquidez", async () => {
  ok(b6[0], "lanzamiento sin bloquear de L3");
  assert.equal(lee(iP, "ownerOf", b6[1]).toLowerCase(), L3, "el muro C es de L3 (id previsto bien)");
  ok(b6[2], "sacar un pelo de liquidez");
  ok(b6[3], "approve del NFT");
  assert.equal(b6[4].status, "0x0", "bloquear el muro tocado tiene que revertir");
  assert.equal(motivo(b6[4]), "WallNotIntact");
});

await caso("C. revierten: codigo desconocido, borde sin espaciar, token bajo la USDC, slippage y callback de fuera", async () => {
  assert.equal(motivo(b4[7]), "UnknownTokenCode");
  assert.equal(motivo(b4[8]), "BadTicks");
  assert.equal(motivo(b4[9]), "QuoteOrdering");
  ok(b4[10], "approve");
  assert.equal(motivo(b4[11]), "Slippage");
  assert.equal(motivo(b4[12]), "NotPoolManager");
});

console.log("\n" + bien + " casos, todos bien | peticiones al nodo: " + peticiones + " | nada enviado a la cadena");
