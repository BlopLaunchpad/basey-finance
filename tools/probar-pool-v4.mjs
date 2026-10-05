/* PRUEBA EN ARC SIN MANDAR NADA (5-oct-2026): el pool V4 de olig-pool.js para un token que ya existe, simulado con
   eth_simulateV1 en arc.drpc.org desde la wallet que tiene los tokens (validation:false: no hace falta su firma).
   Bloque 1: approve(Permit2), Permit2.approve(PositionManager), PositionManager.multicall(initializePool + mint).
   Bloque 2: el StateView da el precio de salida exacto, la liquidez de la pool y el saldo que queda en la wallet.
   node tools/probar-pool-v4.mjs <token> <wallet que lo tiene> [mc=5000] */
import assert from "node:assert";
import { ethers } from "ethers";
globalThis.ethers = ethers;
const { planPoolV4, V4 } = await import("../olig-pool.js");
const { STATEVIEW_ABI, PERMIT2_ABI } = await import("../v4.js?v=1");
const [token, owner, mcTxt] = process.argv.slice(2);
assert.ok(ethers.isAddress(token) && ethers.isAddress(owner), "uso: node tools/probar-pool-v4.mjs <token> <wallet> [mc]");
const mc = Number(mcTxt || 5000);
const RPC = "https://arc.drpc.org";
let id = 0;
async function rpc(method, params) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const j = await r.json();
    if (!j.error) return j.result;
    if (i === 4) throw new Error(method + ": " + JSON.stringify(j.error).slice(0, 300));
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
  }
}
const erc = new ethers.Interface(["function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const leer = async (f, args = []) => erc.decodeFunctionResult(f, await rpc("eth_call", [{ to: token, data: erc.encodeFunctionData(f, args) }, "latest"]))[0];
const [dec, supply, saldo] = [await leer("decimals"), await leer("totalSupply"), await leer("balanceOf", [owner])];
const plan = planPoolV4({ token, decimals: dec, supply, mcUsd: mc, wallTokens: saldo, owner });
console.log("token", token, "| saldo de", owner.slice(0, 10), ethers.formatUnits(saldo, 18), "| MC de salida", mc, "$ -> precio", plan.precio.toExponential(4), "$ por token");
console.log("poolId", plan.id, "| ticks: salida", plan.ticks.startTick, "muro", plan.ticks.wallLower, "->", plan.ticks.wallUpper, "| muro hasta", plan.precioArriba.toExponential(4), "$ por token | L", plan.L.toString());
const sv = new ethers.Interface(STATEVIEW_ABI);
const p2 = new ethers.Interface(PERMIT2_ABI);
const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
const G = "0x2dc6c0"; // 3 M por llamada: la suma cabe en un bloque
const r = await rpc("eth_simulateV1", [{ validation: false, blockStateCalls: [
  { calls: [
    { from: owner, to: token, data: erc.encodeFunctionData("approve", [V4.permit2, saldo]), gas: G },
    { from: owner, to: V4.permit2, data: p2.encodeFunctionData("approve", [token, V4.positionManager, saldo, exp]), gas: G },
    { from: owner, to: V4.positionManager, data: plan.multicall, gas: "0x7a1200" },
  ] },
  { calls: [
    { from: owner, to: V4.stateView, data: sv.encodeFunctionData("getSlot0", [plan.id]), gas: G },
    { from: owner, to: V4.stateView, data: sv.encodeFunctionData("getLiquidity", [plan.id]), gas: G },
    { from: owner, to: token, data: erc.encodeFunctionData("balanceOf", [owner]), gas: G },
  ] },
] }, "latest"]);
const [c1, c2, c3] = r[0].calls;
for (const [n, c] of [["approve(Permit2)", c1], ["Permit2.approve", c2], ["multicall pool + muro", c3]]) {
  console.log(n.padEnd(22), c.status === "0x1" ? "OK" : "REVIERTE", "| gas", parseInt(c.gasUsed, 16), c.status === "0x1" ? "" : "| " + JSON.stringify(c.error || c.returnData).slice(0, 300));
  assert.strictEqual(c.status, "0x1", n + " revierte");
}
const [s0, liq, despues] = r[1].calls.map((c) => c.returnData);
const slot0 = sv.decodeFunctionResult("getSlot0", s0);
const L = sv.decodeFunctionResult("getLiquidity", liq)[0];
const queda = erc.decodeFunctionResult("balanceOf", despues)[0];
assert.strictEqual(BigInt(slot0[0]), plan.sq, "la pool no abre al precio del plan");
console.log("pool simulada: sqrtPriceX96", slot0[0].toString(), "(el del plan) | tick", slot0[1].toString(), "| liquidez activa", L.toString(),
  "| el muro uso", ethers.formatUnits(saldo - queda, 18), "de", ethers.formatUnits(saldo, 18), "tokens");
console.log("TODO OK");
