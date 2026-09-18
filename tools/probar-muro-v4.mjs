/* ===========================================================================
   PRUEBA DE LOS BOTONES DE UN MURO V4 SIN BLOQUEAR (tarjeta de "What you launched")

     node tools/probar-muro-v4.mjs

   Contra la fabrica DESPLEGADA (FABRICA_V4) y la V4 real de Arc, con eth_simulateV1:
   no firma ni manda nada. Usa las MISMAS funciones que la pagina (fabrica-v4.js para
   codificar, v4.js para la liquidez). Lanza tres muros sin bloquear y comprueba:
     1. rangoDeInfo() lee del NFT el mismo rango que se lanzo;
     2. Collect fees (datosCobrarV4) funciona y no toca la liquidez;
     3. Add more (datosAñadirV4, liquidez de liquidityFor con el precio de despues de
        la compra) sube la liquidez, y ese muro se puede bloquear despues;
     4. Withdraw everything (datosRetirarV4) lo deja a cero y lo cobra el lanzador; y
        ya NO se puede bloquear (WallNotIntact);
     5. Burn permanently (transferFrom a 0x…dEaD) deja el NFT en la direccion muerta.
   =========================================================================== */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { ethers } = require(path.join(raiz, "..", "blop-contracts", "node_modules", "ethers"));
globalThis.ethers = ethers;
const imp = (f) => import(pathToFileURL(path.join(raiz, f)).href);
const { argsDelToken } = await imp("basey-token.js");
const PLANMOD = await imp("plan.js");
const F4 = await imp("fabrica-v4.js");
const { liquidityFor, poolId } = await imp("v4.js");

const NODO = process.env.NODO || "https://arc.drpc.org";
const FAB = F4.FABRICA_V4;
const POSM = F4.V4_ARC.positionManager;
const PERMIT2 = F4.V4_ARC.permit2;
const USDC = F4.USDC_ERC20;
const STATEVIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
const DEAD = "0x000000000000000000000000000000000000dEaD";
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
async function simular(bloques, cuentas) {
  const stateOverrides = {};
  for (const a of cuentas) stateOverrides[a] = { balance: hex(1000n * 10n ** 18n) };
  const blockStateCalls = bloques.map((calls, i) => ({ ...(i === 0 ? { stateOverrides } : {}),
    calls: calls.map((c) => ({ ...c, gas: hex(c.gas || 700_000) })) }));
  for (let intento = 1; ; intento++) {
    try { return (await rpc("eth_simulateV1", [{ blockStateCalls, validation: false }, "latest"])).map((b) => b.calls); }
    catch (e) {
      if (intento >= 3 || !/Temporary internal error/.test(e.message)) throw e;
      await new Promise((ok) => setTimeout(ok, 2500 * intento));
    }
  }
}
const iF = new ethers.Interface(F4.ABI_FABRICA);
const iE = new ethers.Interface(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const iP = new ethers.Interface(["function ownerOf(uint256) view returns (address)", "function approve(address,uint256)", "function transferFrom(address,address,uint256)",
  "function getPositionLiquidity(uint256) view returns (uint128)", "function modifyLiquidities(bytes,uint256) payable",
  "function getPoolAndPositionInfo(uint256) view returns ((address,address,uint24,int24,address),uint256)"]);
const iP2 = new ethers.Interface(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const iS = new ethers.Interface(["function getSlot0(bytes32) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);
const c = (from, to, iface, fn, args = [], gas) => ({ from, to, data: iface.encodeFunctionData(fn, args), gas });
const textoRevert = (d) => { try { if (String(d).startsWith("0x08c379a0")) return "Error(" + ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + d.slice(10))[0] + ")"; } catch { /* nada */ } return F4.motivoV4({ data: d }) || String(d).slice(0, 10); };
const ok = (r, que) => assert.equal(r.status, "0x1", que + " revierte: " + textoRevert(r.returnData));
const lee = (iface, fn, r) => { ok(r, fn); const v = iface.decodeFunctionResult(fn, r.returnData); return v.length === 1 ? v[0] : v; };
const LEJOS = 1n << 40n;

let bien = 0;
const caso = async (n, fn) => { await fn(); bien++; console.log("ok  " + n); };
assert.ok(FAB && ethers.isAddress(FAB), "FABRICA_V4 no esta escrita");

/* ── tres lanzamientos sin bloquear, como la pagina, desde una cuenta de prueba ── */
const L = "0x000000000000000000000000000000000000ba54";
const PLAN = PLANMOD.planPorDefecto();
PLAN.supply = 1_000_000_000; PLAN.tesoreríaPct = 0;
const P0 = PLANMOD.precioDe(PLAN);
const t = PLAN.tramos[0];
const ticks = F4.ticksV4(P0, Math.max(t.desde, PLANMOD.SEPARACIÓN_MÍNIMA), t.hasta);
const wallTokens = ethers.parseUnits(String(Math.floor(PLANMOD.resumen(PLAN).posiciones[0].tokens)), 18);
const buy = 2_000_000n;
function lanzamiento(simbolo) {
  const argsToken = argsDelToken({ ...PLAN, nombre: "Muro " + simbolo, símbolo: simbolo });
  const initHash = ethers.keccak256(ethers.concat([F4.codigoDelToken(false), F4.argsTokenCodificados(argsToken)]));
  for (let i = 0; i < 500; i++) {
    const salt = ethers.id("muro-" + simbolo + "-" + i);
    const dir = ethers.getCreate2Address(FAB, ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [L, salt])), initHash);
    if (BigInt(dir) > BigInt(USDC)) {
      return { dir, p: F4.paramsV4({ editable: false, argsToken, salt, lpFee: PLAN.fee, ticks, wallTokens, lock: false, buyUsdc: buy, minTokensOut: 1n }) };
    }
  }
  throw new Error("sin sal");
}
const A = lanzamiento("MRA"), B = lanzamiento("MRB"), C = lanzamiento("MRC");
const bloque1 = [
  c(L, USDC, iE, "approve", [FAB, buy * 3n]),
  c(L, FAB, iF, "launch", [A.p], 8_000_000),
  c(L, FAB, iF, "launch", [B.p], 8_000_000),
  c(L, FAB, iF, "launch", [C.p], 8_000_000),
];

/* 1.ª simulacion: los ids de los NFT, la liquidez acuñada y el precio tras la compra */
const [s1] = await simular([bloque1, [
  c(L, FAB, iF, "infoOf", [A.dir]), c(L, FAB, iF, "infoOf", [B.dir]), c(L, FAB, iF, "infoOf", [C.dir]),
]], [L]).then((x) => [x]);
[1, 2, 3].forEach((i) => ok(s1[0][i], "lanzamiento " + i));
const info = [0, 1, 2].map((i) => iF.decodeFunctionResult("infoOf", s1[1][i].returnData));
const [idA, idB, idC] = info.map((x) => x[0]);
const mintA = info[0][5], mintC = info[2][5];
const keyA = [USDC, A.dir, PLAN.fee, F4.TICK_SPACING, ethers.ZeroAddress];
const keyC = [USDC, C.dir, PLAN.fee, F4.TICK_SPACING, ethers.ZeroAddress];
const [s0] = await simular([bloque1, [
  c(L, STATEVIEW, iS, "getSlot0", [poolId({ currency0: USDC, currency1: C.dir, fee: PLAN.fee, tickSpacing: F4.TICK_SPACING, hooks: ethers.ZeroAddress })]),
]], [L]).then((x) => [x]);
const slot = iS.decodeFunctionResult("getSlot0", s0[1][0].returnData);
console.log("NFT A #" + idA + ", B #" + idB + ", C #" + idC + " | tick tras la compra " + slot.tick + " (muro " + ticks.wallLower + " -> " + ticks.wallUpper + ")");

/* lo que añadiria la pagina: 100.000 tokens y 0,5 USDC (la cuenta compro ~380.000 con sus 2 USDC),
   al precio de despues de la compra */
const addTok = ethers.parseUnits("100000", 18), addUsd = 500_000n;
let Ladd = liquidityFor(Number(slot.sqrtPriceX96), ticks.wallLower, ticks.wallUpper, addUsd, addTok);
Ladd = (Ladd * 999n) / 1000n;
assert.ok(Ladd > 0n, "liquidityFor dio cero");

/* 2.ª simulacion: todo lo que hacen los botones */
const permisos = [
  c(L, C.dir, iE, "approve", [PERMIT2, ethers.MaxUint256]), c(L, USDC, iE, "approve", [PERMIT2, ethers.MaxUint256]),
  c(L, PERMIT2, iP2, "approve", [C.dir, POSM, (1n << 160n) - 1n, (1n << 48n) - 1n]),
  c(L, PERMIT2, iP2, "approve", [USDC, POSM, (1n << 160n) - 1n, (1n << 48n) - 1n]),
];
const bloque2 = [
  c(L, POSM, iP, "getPoolAndPositionInfo", [idA]),                                                     // 0
  c(L, POSM, iP, "modifyLiquidities", [F4.datosCobrarV4(idA, A.dir, L), LEJOS], 1_500_000),            // 1 cobrar
  c(L, POSM, iP, "getPositionLiquidity", [idA]),                                                       // 2
  ...permisos,                                                                                         // 3-6
  c(L, POSM, iP, "modifyLiquidities", [F4.datosAñadirV4(idC, Ladd, addUsd, addTok, C.dir), LEJOS], 1_500_000), // 7 añadir
  c(L, POSM, iP, "getPositionLiquidity", [idC]),                                                       // 8
  c(L, POSM, iP, "approve", [FAB, idC]),                                                               // 9
  c(L, FAB, iF, "lockPosition", [idC, []], 900_000),                                                   // 10
  c(L, USDC, iE, "balanceOf", [L]),                                                                    // 11
  c(L, POSM, iP, "modifyLiquidities", [F4.datosRetirarV4(idA, mintA, A.dir, L), LEJOS], 1_500_000),   // 12 retirar
  c(L, POSM, iP, "getPositionLiquidity", [idA]),                                                       // 13
  c(L, USDC, iE, "balanceOf", [L]),                                                                    // 14
  c(L, POSM, iP, "approve", [FAB, idA]),                                                               // 15
  c(L, FAB, iF, "lockPosition", [idA, []], 900_000),                                                   // 16 ya no
  c(L, POSM, iP, "transferFrom", [L, DEAD, idB]),                                                      // 17 quemar
  c(L, POSM, iP, "ownerOf", [idB]),                                                                    // 18
];
const s2 = await simular([bloque1, bloque2], [L]);
const b2 = s2[1];
/* token Y id del NFT iguales en las dos simulaciones: si alguien acuña en Arc entre una y
   otra, los ids se corren y la segunda apuntaria a otros NFT. Entonces, repetir. */
[1, 2, 3].forEach((i) => assert.equal(s2[0][i].returnData.slice(0, 130), s1[0][i].returnData.slice(0, 130),
  "el lanzamiento " + i + " salio distinto entre simulaciones (alguien acuño entre medias): vuelve a ejecutar"));

await caso("1. rangoDeInfo() lee del NFT el mismo rango que se lanzo", async () => {
  const [key, inf] = lee(iP, "getPoolAndPositionInfo", b2[0]);
  assert.deepEqual(F4.rangoDeInfo(inf), { lower: ticks.wallLower, upper: ticks.wallUpper });
  assert.equal(String(key[1]).toLowerCase(), A.dir.toLowerCase());
});
await caso("2. Collect fees (datosCobrarV4) funciona y no toca la liquidez", async () => {
  ok(b2[1], "cobrar");
  assert.equal(lee(iP, "getPositionLiquidity", b2[2]), mintA);
});
await caso("3. Add more (datosAñadirV4 + liquidityFor, como la pagina) sube la liquidez, y ese muro SE PUEDE bloquear", async () => {
  [3, 4, 5, 6].forEach((i) => ok(b2[i], "permiso " + i));
  ok(b2[7], "añadir");
  const Lc = lee(iP, "getPositionLiquidity", b2[8]);
  assert.equal(Lc, mintC + Ladd, "liquidez tras añadir");
  ok(b2[9], "approve del NFT");
  ok(b2[10], "lockPosition tras añadir");
  console.log("      C: " + mintC + " + " + Ladd + " = " + Lc + " de liquidez, y bloqueado");
});
await caso("4. Withdraw everything (datosRetirarV4) lo deja a cero, lo cobra el lanzador, y ya NO se puede bloquear", async () => {
  ok(b2[12], "retirar");
  assert.equal(lee(iP, "getPositionLiquidity", b2[13]), 0n);
  const antes = lee(iE, "balanceOf", b2[11]), despues = lee(iE, "balanceOf", b2[14]);
  assert.ok(despues > antes, "no volvio USDC al retirar");
  console.log("      A: retirados " + ethers.formatUnits(despues - antes, 6) + " USDC (la compra y sus comisiones)");
  ok(b2[15], "approve del NFT");
  assert.equal(b2[16].status, "0x0", "bloquear un muro vaciado tiene que revertir");
  assert.equal(F4.nombreErrorV4({ data: b2[16].returnData }), "WallNotIntact");
});
await caso("5. Burn permanently (transferFrom a 0x…dEaD) deja el NFT en la direccion muerta", async () => {
  ok(b2[17], "quemar");
  assert.equal(String(lee(iP, "ownerOf", b2[18])).toLowerCase(), DEAD.toLowerCase());
});

console.log("\n" + bien + " casos, todos bien | peticiones al nodo: " + peticiones + " | nada enviado a la cadena");
