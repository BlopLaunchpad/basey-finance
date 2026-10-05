/* Solo lectura (5-oct-2026): ¿que infraestructura hay en Arc para el plan del token? Mira con eth_getCode si existen en la
   5042 los contratos canonicos de Safe (multifirma, v1.4.1 y v1.3.0) y los de Uniswap V4 que usa basey, y cuantos pools V4
   con hook se han inicializado en los ultimos bloques (evento Initialize del PoolManager, el hook va en los datos).
   node tools/mirar-infra-arc.mjs */
const RPC = ["https://rpc.mainnet.arc.io", "https://arc.drpc.org"];
let id = 0;
async function rpc(method, params) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(RPC[i % 2], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error));
      return j.result;
    } catch (e) { if (i === 5) throw e; await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); }
  }
}
const SITIOS = {
  "Safe 1.4.1 singleton": "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  "Safe 1.4.1 L2 singleton": "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  "Safe 1.4.1 ProxyFactory": "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  "Safe 1.3.0 singleton": "0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552",
  "Safe 1.3.0 L2 singleton": "0x3E5c63644E683549055b9Be8653de26E0B4CD36E",
  "Safe 1.3.0 ProxyFactory": "0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2",
  "V4 PoolManager": "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  "V4 PositionManager": "0x6049c9a0e26405c0985f9e3685c87d0ae917f82b",
  "V4 UniversalRouter": "0x4fca4a51ab4f23a7447b3284fbd7d73289a89fb1",
  "Permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  "CREATE2 deployer (Arachnid)": "0x4e59b44847b379578588920cA78FbF26c0B4956C",
};
for (const [n, a] of Object.entries(SITIOS)) {
  const c = await rpc("eth_getCode", [a, "latest"]);
  console.log(n.padEnd(30), a, c && c !== "0x" ? "SI (" + (c.length - 2) / 2 + " bytes)" : "no");
}
// pools V4 inicializados: Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)
const TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
const cabeza = parseInt(await rpc("eth_blockNumber", []), 16);
let conHook = {}, total = 0;
for (let b = cabeza; b > cabeza - 200000; b -= 9000) {
  const logs = await rpc("eth_getLogs", [{ fromBlock: "0x" + Math.max(0, b - 8999).toString(16), toBlock: "0x" + b.toString(16), address: SITIOS["V4 PoolManager"], topics: [TOPIC] }]);
  for (const l of logs || []) { total++; const hook = "0x" + l.data.slice(2 + 64 * 2 + 24, 2 + 64 * 3); if (!/^0x0{40}$/.test(hook)) conHook[hook] = (conHook[hook] || 0) + 1; }
}
console.log("pools V4 inicializados en ~200.000 bloques (~28 h):", total, "| con hook:", Object.values(conHook).reduce((x, y) => x + y, 0));
for (const [h, n] of Object.entries(conHook).sort((x, y) => y[1] - x[1]).slice(0, 8)) console.log("  hook", h, "->", n, "pools");
