/* PRUEBA EN ARC SIN MANDAR NADA (5-oct-2026): el pool OLIG/USDC solo con USDC de olig-pool-usdc.js, simulado con
   eth_simulateV1 desde una wallet con USDC (validation:false: no hace falta su firma).
   Bloque 1: USDC.approve(Permit2), Permit2.approve(PositionManager), PositionManager.multicall(initializePool + mint).
   Bloque 2: precio del pool, liquidez activa, USDC que salio de la wallet y OLIG que hay en el PoolManager por este pool (0).
   Bloque 3: un intento de COMPRAR OLIG en ese pool no saca ni un OLIG (no hay).
   node tools/probar-pool-usdc.mjs <token> <wallet con USDC> [usdc=2] [mc=1000000] */
import assert from "node:assert";
import { ethers } from "ethers";
globalThis.ethers = ethers;
const { planPoolSoloUsdc, planRetirar, V4, usdDeTick } = await import("../olig-pool-usdc.js");
const { STATEVIEW_ABI, PERMIT2_ABI } = await import("../v4.js?v=1");
const [token, owner, usdcTxt, mcTxt] = process.argv.slice(2);
assert.ok(ethers.isAddress(token) && ethers.isAddress(owner), "uso: node tools/probar-pool-usdc.mjs <token> <wallet> [usdc] [mc]");
const USDC = "0x3600000000000000000000000000000000000000";
const usdc = ethers.parseUnits(usdcTxt || "2", 6), mc = Number(mcTxt || 1e6);
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
const erc = new ethers.Interface(["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const call = async (to, f, args = []) => erc.decodeFunctionResult(f, await rpc("eth_call", [{ to, data: erc.encodeFunctionData(f, args) }, "latest"]))[0];
const sv = new ethers.Interface(STATEVIEW_ABI);
const supply = await call(token, "totalSupply");
const saldoUsdc = await call(USDC, "balanceOf", [owner]);
const plan0 = planPoolSoloUsdc({ token, supply, mcUsd: mc, usdc, owner });
const s0 = sv.decodeFunctionResult("getSlot0", await rpc("eth_call", [{ to: V4.stateView, data: sv.encodeFunctionData("getSlot0", [plan0.id]) }, "latest"]));
const plan = BigInt(s0[0]) > 0n ? planPoolSoloUsdc({ token, supply, usdc, owner, sqrtActual: BigInt(s0[0]) }) : plan0;
console.log("pool", plan.id, plan.abrir ? "(NO existe: se abre)" : "(YA existe: se añade)", "| precio", plan.precio.toExponential(4), "$/OLIG = FDV",
  Math.round(plan.precio * Number(ethers.formatUnits(supply, 18))).toLocaleString("en-US"), "$ | colchon de", plan.desde.toExponential(3), "a", usdDeTick(plan.upper).toExponential(3),
  "$ | ticks", plan.lower, "->", plan.upper, "(actual", plan.tickActual + ") | L", plan.L.toString(), "| USDC de la wallet", ethers.formatUnits(saldoUsdc, 6));
const p2 = new ethers.Interface(PERMIT2_ABI);
const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
const G = "0x2dc6c0";
const pmOlig = () => ({ from: owner, to: token, data: erc.encodeFunctionData("balanceOf", [V4.poolManager || "0x8366a39cc670b4001a1121b8f6a443a643e40951"]), gas: G });
// el numero que tendra la posicion: el siguiente del PositionManager (en la simulacion no se cuela nadie)
const posm = new ethers.Interface(["function nextTokenId() view returns (uint256)", "function getPositionLiquidity(uint256) view returns (uint128)"]);
const siguiente = posm.decodeFunctionResult("nextTokenId", await rpc("eth_call", [{ to: V4.positionManager, data: posm.encodeFunctionData("nextTokenId") }, "latest"]))[0];
const sacar = planRetirar({ tokenId: siguiente, liquidez: plan.L, key: plan.key, para: owner });
const r = await rpc("eth_simulateV1", [{ validation: false, blockStateCalls: [
  { calls: [
    { from: owner, to: USDC, data: erc.encodeFunctionData("approve", [V4.permit2, usdc]), gas: G },
    { from: owner, to: V4.permit2, data: p2.encodeFunctionData("approve", [USDC, V4.positionManager, usdc, exp]), gas: G },
    { from: owner, to: V4.positionManager, data: plan.multicall, gas: "0x7a1200" },
  ] },
  { calls: [
    { from: owner, to: V4.stateView, data: sv.encodeFunctionData("getSlot0", [plan.id]), gas: G },
    { from: owner, to: V4.stateView, data: sv.encodeFunctionData("getLiquidity", [plan.id]), gas: G },
    { from: owner, to: USDC, data: erc.encodeFunctionData("balanceOf", [owner]), gas: G },
    pmOlig(),
    { from: owner, to: V4.positionManager, data: posm.encodeFunctionData("getPositionLiquidity", [siguiente]), gas: G },
  ] },
  { calls: [
    { from: owner, to: V4.positionManager, data: sacar, gas: "0x7a1200" },
    { from: owner, to: USDC, data: erc.encodeFunctionData("balanceOf", [owner]), gas: G },
    { from: owner, to: V4.positionManager, data: posm.encodeFunctionData("getPositionLiquidity", [siguiente]), gas: G },
  ] },
] }, "latest"]);
const [c1, c2, c3] = r[0].calls;
for (const [n, c] of [["USDC.approve(Permit2)", c1], ["Permit2.approve", c2], ["multicall pool + USDC", c3]]) {
  console.log(n.padEnd(24), c.status === "0x1" ? "OK" : "REVIERTE", "| gas", parseInt(c.gasUsed, 16), c.status === "0x1" ? "" : "| " + JSON.stringify(c.error || c.returnData).slice(0, 300));
  assert.strictEqual(c.status, "0x1", n + " revierte");
}
const [b0, b1, b2, b3] = r[1].calls.map((c) => c.returnData);
const slot = sv.decodeFunctionResult("getSlot0", b0);
const L = sv.decodeFunctionResult("getLiquidity", b1)[0];
const queda = erc.decodeFunctionResult("balanceOf", b2)[0];
const oligEnPm = erc.decodeFunctionResult("balanceOf", b3)[0];
assert.strictEqual(BigInt(slot[0]), plan.sq, "el pool no queda al precio del plan");
console.log("simulado: tick", slot[1].toString(), "| liquidez activa en el precio", L.toString(), "(0 = el USDC esta justo debajo, nadie compra OLIG)",
  "| USDC que salio de la wallet", ethers.formatUnits(saldoUsdc - queda, 6), "(+ gas) | OLIG en el PoolManager", ethers.formatUnits(oligEnPm, 18));
assert.strictEqual(oligEnPm, 0n, "hay OLIG en el PoolManager");
const liqPos = posm.decodeFunctionResult("getPositionLiquidity", r[1].calls[4].returnData)[0];
assert.strictEqual(liqPos, plan.L, "la posicion #" + siguiente + " no tiene la liquidez del plan");
const [d1, d2, d3] = r[2].calls;
console.log("sacar el USDC (#" + siguiente + ")".padEnd(10), d1.status === "0x1" ? "OK" : "REVIERTE", "| gas", parseInt(d1.gasUsed, 16), d1.status === "0x1" ? "" : "| " + JSON.stringify(d1.error || d1.returnData).slice(0, 300));
assert.strictEqual(d1.status, "0x1", "sacar revierte");
const vuelta = erc.decodeFunctionResult("balanceOf", d2.returnData)[0];
const liqDespues = posm.decodeFunctionResult("getPositionLiquidity", d3.returnData)[0];
console.log("tras sacar: USDC en la wallet", ethers.formatUnits(vuelta, 6), "(antes de todo", ethers.formatUnits(saldoUsdc, 6) + ") | liquidez de la posicion", liqDespues.toString());
assert.strictEqual(liqDespues, 0n, "la posicion no queda vacia");
assert.ok(saldoUsdc - vuelta < ethers.parseUnits("0.01", 6), "no vuelve el USDC");
console.log("TODO OK");
