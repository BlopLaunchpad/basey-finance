/* PRUEBA EN ARC SIN MANDAR NADA (4-oct-2026, tarde): eth_simulateV1 en arc.drpc.org (el mismo camino que probar-metadata.mjs,
   ver BASEY.md "anvil NO sirve"). Bloque 1: la wallet de comisiones despliega el bytecode de olig-codigo.js. Bloque 2: se leen
   del contrato recien creado lo que leen los rastreadores (tokenURI, logo, description, owner) y el saldo de la wallet.
   Comprueba: que el despliegue cabe y no revierte en Arc, su gas, que el JSON se decodifica con nombre, simbolo, web y X,
   y que la imagen que devuelve es BYTE A BYTE contratos-olig/logo/olig-200.webp.
   node tools/probar-olig-arc.mjs */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { OLIG_BYTECODE, OLIG_BYTECODE_MD5 } from "../olig-codigo.js";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEE = "0xF8eBF867Ae58179C85B1e158321eFB18c3dad0d5";
const RPC = "https://arc.drpc.org";
const iface = new ethers.Interface(["function tokenURI() view returns (string)", "function logo() view returns (string)", "function description() view returns (string)",
  "function owner() view returns (address)", "function balanceOf(address) view returns (uint256)", "function name() view returns (string)", "function symbol() view returns (string)"]);
let id = 0;
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(method + ": " + JSON.stringify(j.error).slice(0, 300));
  return j.result;
}
const nonce = parseInt(await rpc("eth_getTransactionCount", [FEE, "latest"]), 16);
const addr = ethers.getCreateAddress({ from: FEE, nonce });
console.log("bytecode md5", OLIG_BYTECODE_MD5, "|", (OLIG_BYTECODE.length - 2) / 2, "bytes | wallet de comisiones nonce", nonce, "-> el token naceria en", addr);
// gas explicito por llamada y que la suma quepa en un bloque (BASEY.md: si no, "Temporary internal error"): 6 M el despliegue, 1 M cada lectura
const llamadas = ["tokenURI", "logo", "description", "owner", "name", "symbol"].map((f) => ({ from: FEE, to: addr, data: iface.encodeFunctionData(f), gas: "0xf4240" }));
llamadas.push({ from: FEE, to: addr, data: iface.encodeFunctionData("balanceOf", [FEE]), gas: "0xf4240" });
const r = await rpc("eth_simulateV1", [{ blockStateCalls: [{ calls: [{ from: FEE, data: OLIG_BYTECODE, gas: "0x5b8d80" }] }, { calls: llamadas }], validation: false }, "latest"]);
const dep = r[0].calls[0];
assert.strictEqual(dep.status, "0x1", "el despliegue revierte: " + JSON.stringify(dep).slice(0, 300));
console.log("despliegue simulado en Arc: OK, gas", parseInt(dep.gasUsed, 16));
const sal = r[1].calls.map((c, i) => { assert.strictEqual(c.status, "0x1", "llamada " + i + " revierte"); return c.returnData; });
const [tokenURI, logo, description, owner, name, symbol] = ["tokenURI", "logo", "description", "owner", "name", "symbol"].map((f, i) => iface.decodeFunctionResult(f, sal[i])[0]);
const saldo = iface.decodeFunctionResult("balanceOf", sal[6])[0];
assert.ok(tokenURI.startsWith("data:application/json;base64,"), "tokenURI");
const json = JSON.parse(Buffer.from(tokenURI.slice(29), "base64").toString("utf8"));
const webp = fs.readFileSync(path.join(RAIZ, "contratos-olig", "logo", "olig-200.webp"));
assert.strictEqual(json.name, "Oligarc"); assert.strictEqual(json.symbol, "OLIG");
assert.strictEqual(json.website, "https://oligarc.xyz"); assert.strictEqual(json.twitter, "https://x.com/oligarcxyz");
assert.ok(json.image === logo && logo.startsWith("data:image/webp;base64,"), "la imagen del JSON y logo() son la misma");
assert.ok(Buffer.from(logo.slice(23), "base64").equals(webp), "la imagen NO es olig-200.webp");
assert.strictEqual(owner, ethers.ZeroAddress);
assert.strictEqual(saldo, 10n ** 27n);
console.log("name", name, "| symbol", symbol, "| owner", owner, "| saldo de la wallet de comisiones", ethers.formatUnits(saldo, 18));
console.log("JSON:", JSON.stringify(Object.assign({}, json, { image: "data:image/webp;base64,… (" + webp.length + " bytes, identica a olig-200.webp)" })));
console.log("description:", description);
console.log("TODO OK");
