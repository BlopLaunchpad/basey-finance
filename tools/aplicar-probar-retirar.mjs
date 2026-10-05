/* tools/probar-pool-usdc.mjs: añade a la simulacion el boton de SACAR el USDC (planRetirar), en un tercer bloque.
   node tools/aplicar-probar-retirar.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), "probar-pool-usdc.mjs");
let s = fs.readFileSync(F, "utf8");
assert.ok(!s.includes("planRetirar"), "ya estaba");
function cambiar(a, b) { assert.strictEqual(s.split(a).length, 2, "ancla " + a.slice(0, 50)); s = s.replace(a, () => b); }
cambiar(`const { planPoolSoloUsdc, V4, usdDeTick } = await import("../olig-pool-usdc.js");`,
  `const { planPoolSoloUsdc, planRetirar, V4, usdDeTick } = await import("../olig-pool-usdc.js");`);
cambiar(`const r = await rpc("eth_simulateV1", [{ validation: false, blockStateCalls: [`,
  `// el numero que tendra la posicion: el siguiente del PositionManager (en la simulacion no se cuela nadie)
const posm = new ethers.Interface(["function nextTokenId() view returns (uint256)", "function getPositionLiquidity(uint256) view returns (uint128)"]);
const siguiente = posm.decodeFunctionResult("nextTokenId", await rpc("eth_call", [{ to: V4.positionManager, data: posm.encodeFunctionData("nextTokenId") }, "latest"]))[0];
const sacar = planRetirar({ tokenId: siguiente, liquidez: plan.L, key: plan.key, para: owner });
const r = await rpc("eth_simulateV1", [{ validation: false, blockStateCalls: [`);
cambiar(`    pmOlig(),
  ] },`, `    pmOlig(),
    { from: owner, to: V4.positionManager, data: posm.encodeFunctionData("getPositionLiquidity", [siguiente]), gas: G },
  ] },
  { calls: [
    { from: owner, to: V4.positionManager, data: sacar, gas: "0x7a1200" },
    { from: owner, to: USDC, data: erc.encodeFunctionData("balanceOf", [owner]), gas: G },
    { from: owner, to: V4.positionManager, data: posm.encodeFunctionData("getPositionLiquidity", [siguiente]), gas: G },
  ] },`);
cambiar(`console.log("TODO OK");`, `const liqPos = posm.decodeFunctionResult("getPositionLiquidity", r[1].calls[4].returnData)[0];
assert.strictEqual(liqPos, plan.L, "la posicion #" + siguiente + " no tiene la liquidez del plan");
const [d1, d2, d3] = r[2].calls;
console.log("sacar el USDC (#" + siguiente + ")".padEnd(10), d1.status === "0x1" ? "OK" : "REVIERTE", "| gas", parseInt(d1.gasUsed, 16), d1.status === "0x1" ? "" : "| " + JSON.stringify(d1.error || d1.returnData).slice(0, 300));
assert.strictEqual(d1.status, "0x1", "sacar revierte");
const vuelta = erc.decodeFunctionResult("balanceOf", d2.returnData)[0];
const liqDespues = posm.decodeFunctionResult("getPositionLiquidity", d3.returnData)[0];
console.log("tras sacar: USDC en la wallet", ethers.formatUnits(vuelta, 6), "(antes de todo", ethers.formatUnits(saldoUsdc, 6) + ") | liquidez de la posicion", liqDespues.toString());
assert.strictEqual(liqDespues, 0n, "la posicion no queda vacia");
assert.ok(saldoUsdc - vuelta < ethers.parseUnits("0.01", 6), "no vuelve el USDC");
console.log("TODO OK");`);
fs.writeFileSync(F, s);
console.log("ok");
