/* Solo lectura: quien tiene la liquidez de una pool, que es lo que miran los rastreadores
   para el distintivo "Quemado/Bloqueado".
     node tools/donde-esta-la-liquidez.mjs
   Mira tres casos medidos el 18-sep: TEST (V3, el NFT mandado a 0xdead por el dueño),
   PANCHU (V4, openlaunch.lol, que en GMGN sale en verde) y CUSP (V3, la liquidez la
   acuño la fabrica directamente en la pool, sin NFT). */
const RPC = "https://brc.exchange/api/rpc";   // acepta getLogs filtrado de 50.000 bloques (medido 17-sep)
const RPC2 = "https://rpc.mainnet.arc.io";
const { ethers } = await import("file:///C:/Users/ruben/blop-contracts/node_modules/ethers/lib.esm/index.js");
const p = new ethers.JsonRpcProvider(RPC2, 5042, { staticNetwork: true });
const DEAD = "0x000000000000000000000000000000000000dead";
const NFPM_V3 = "0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377";
const PM_V4 = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const POSM_V4 = "0x6049c9a0e26405c0985f9e3685c87d0ae917f82b";
const RAPIDA = "0x6cbc5dcfd337016e8d9aeab267c0b1873bbfe49f";
const TRANSFER = ethers.id("Transfer(address,address,uint256)");
const MODIFY = ethers.id("ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)");
const pad = (a) => ethers.zeroPadValue(a, 32);

async function logs(filtro) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [filtro] }), signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 160));
  return j.result;
}
const cabeza = await p.getBlockNumber();
const hex = (n) => "0x" + n.toString(16);

/* 1. TEST: los NFT de posicion V3 que la rapida mando a 0xdead en la ultima hora */
console.log("== TEST (V3): NFT de posicion de la rapida mandados a 0xdead");
const aDead = await logs({ address: NFPM_V3, fromBlock: hex(cabeza - 8000), toBlock: hex(cabeza), topics: [TRANSFER, pad(RAPIDA), pad(DEAD)] });
const nfpm = new ethers.Contract(NFPM_V3, ["function ownerOf(uint256) view returns (address)",
  "function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)"], p);
for (const l of aDead) {
  const id = BigInt(l.topics[3]);
  const [dueno, pos] = await Promise.all([nfpm.ownerOf(id), nfpm.positions(id)]);
  console.log("  NFT #" + id + " -> ahora es de " + dueno + " | liquidez dentro " + pos[7] + " | par " + pos[2].slice(0, 10) + "/" + pos[3].slice(0, 10) + " fee " + pos[4]);
}
if (!aDead.length) console.log("  ninguno en los ultimos 8.000 bloques");

/* 2. PANCHU: las posiciones de su pool V4 y de quien son */
console.log("\n== PANCHU (V4): posiciones de su pool y su dueño");
const POOL_PANCHU = "0xcd85a7c2298d8a72c6e0aea3d83dc2f01131f0135fde68b2b502aff81492b589";
const posm = new ethers.Contract(POSM_V4, ["function ownerOf(uint256) view returns (address)"], p);
const vistos = new Map();
for (let hasta = cabeza; hasta > cabeza - 250000; hasta -= 50000) {
  const desde = Math.max(hasta - 49999, 0);
  let ls = [];
  try { ls = await logs({ address: PM_V4, fromBlock: hex(desde), toBlock: hex(hasta), topics: [MODIFY, POOL_PANCHU] }); }
  catch (e) { console.log("  tramo " + desde + "-" + hasta + ": " + e.message); continue; }
  for (const l of ls) {
    const sender = ethers.getAddress("0x" + l.topics[2].slice(26));
    const datos = ethers.AbiCoder.defaultAbiCoder().decode(["int24", "int24", "int256", "bytes32"], l.data);
    const clave = sender + ":" + datos[3];
    const v = vistos.get(clave) || { sender, salt: datos[3], liquidez: 0n, primero: Number(l.blockNumber) };
    v.liquidez += datos[2];
    vistos.set(clave, v);
  }
}
for (const v of vistos.values()) {
  let dueno = "(no es del PositionManager: la posicion es del propio " + v.sender + ")";
  if (v.sender.toLowerCase() === POSM_V4.toLowerCase()) {
    try { dueno = await posm.ownerOf(BigInt(v.salt)); } catch { dueno = "ownerOf revierte (NFT quemado)"; }
  }
  console.log("  posicion via " + v.sender.slice(0, 10) + " salt " + BigInt(v.salt) + " | liquidez neta " + v.liquidez + " | dueño: " + dueno);
}
if (!vistos.size) console.log("  ninguna posicion encontrada en los ultimos 250.000 bloques");

/* 3. CUSP: la posicion la tiene la fabrica en la pool, sin NFT */
console.log("\n== CUSP (V3): la liquidez la acuño la fabrica v1 directamente en la pool");
console.log("  (no hay NFT: el dueño de la posicion es el contrato de la fabrica, que no tiene");
console.log("   ninguna funcion para retirarla; solo llama a burn(...,0) para cobrar comisiones)");
