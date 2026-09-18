/* ===========================================================================
   COMPILA LOS CONTRATOS V4 DEL PASO 6 (contratos-v4/src)

     node tools/compilar-v4.mjs

   BaseyLaunchFactoryV4 (nuestro) y LaunchLocker (copia literal del de
   openlaunch.lol, github.com/Gitlawb/openlaunch, MIT), con LA MISMA configuracion
   con la que openlaunch compilo el suyo en Arc: solc 0.8.26+commit.8a97fa7a, viaIR,
   optimizador 200, evm cancun, y sus remapeos. Asi el locker sale con el MISMO
   codigo que el suyo (comprobado el 18-sep: 5.757 B, igual salvo los 2 inmutables y
   los metadatos), y Blockscout lo empareja solo.

   Las dependencias se bajan fichero a fichero del commit EXACTO que fija cada
   submodulo, y se guardan en contratos-v4/.deps (fuera de git). Sale todo a
   contratos-v4/out/: la entrada estandar (para verificar) y abi + bytecode.
   =========================================================================== */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(raiz, "contratos-v4");
const DEPS = path.join(DIR, ".deps");
const OUT = path.join(DIR, "out");

/* los remapeos de openlaunch (contracts/remappings.txt), los que tocan a esto */
const REMAP = [
  ["@uniswap/v4-core/", "lib/v4-periphery/lib/v4-core/"],
  ["v4-core/", "lib/v4-periphery/lib/v4-core/"],
  ["@uniswap/v4-periphery/", "lib/v4-periphery/"],
  ["v4-periphery/", "lib/v4-periphery/"],
  ["permit2/", "lib/v4-periphery/lib/permit2/"],
  ["solmate/", "lib/v4-periphery/lib/v4-core/lib/solmate/"],
  ["openzeppelin-contracts/", "lib/v4-periphery/lib/v4-core/lib/openzeppelin-contracts/"],
].sort((a, b) => b[0].length - a[0].length);

/* cada submodulo, en el commit que fija su padre (medido en el clon de openlaunch) */
const ORIGENES = [
  ["lib/v4-periphery/lib/v4-core/lib/openzeppelin-contracts/", "OpenZeppelin/openzeppelin-contracts", "dbb6104ce834628e473d2173bbc9d47f81a9eec3"],
  ["lib/v4-periphery/lib/v4-core/lib/solmate/", "transmissions11/solmate", "4b47a19038b798b4a33d9749d25e570443520647"],
  ["lib/v4-periphery/lib/v4-core/", "Uniswap/v4-core", "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc"],
  ["lib/v4-periphery/lib/permit2/", "Uniswap/permit2", "cc56ad0f3439c502c246fc5cfcc3db92bb8b7219"],
  ["lib/v4-periphery/", "Uniswap/v4-periphery", "07336f2144f522874e2c3c85e04d1d3f8d5fa471"],
].sort((a, b) => b[0].length - a[0].length);

/* LOS 15 REMAPEOS DE OPENLAUNCH, TAL CUAL Y EN SU ORDEN (los que foundry les puso y
   Blockscout publica con su verificacion), aunque aqui solo se usen 7. No es manía: los
   remapeos entran en los METADATOS, y con estos 15 el LaunchLocker sale identico al suyo
   INCLUIDA la huella de metadatos (medido el 18-sep: solo difieren los 2 inmutables).
   Con solo los 7 que hacen falta, el codigo es el mismo pero la huella no. */
const REMAP_OPENLAUNCH = [
  "forge-std/=lib/forge-std/src/",
  "@uniswap/v4-core/=lib/v4-periphery/lib/v4-core/",
  "v4-core/=lib/v4-periphery/lib/v4-core/",
  "@uniswap/v4-periphery/=lib/v4-periphery/",
  "v4-periphery/=lib/v4-periphery/",
  "uniswap-hooks/=lib/uniswap-hooks/src/",
  "permit2/=lib/v4-periphery/lib/permit2/",
  "solmate/=lib/v4-periphery/lib/v4-core/lib/solmate/",
  "openzeppelin-contracts/=lib/v4-periphery/lib/v4-core/lib/openzeppelin-contracts/",
  "@ensdomains/=lib/v4-periphery/lib/v4-core/node_modules/@ensdomains/",
  "@openzeppelin/=lib/v4-periphery/lib/v4-core/lib/openzeppelin-contracts/",
  "ds-test/=lib/v4-periphery/lib/v4-core/lib/forge-std/lib/ds-test/src/",
  "erc4626-tests/=lib/v4-periphery/lib/v4-core/lib/openzeppelin-contracts/lib/erc4626-tests/",
  "forge-gas-snapshot/=lib/v4-periphery/lib/permit2/lib/forge-gas-snapshot/src/",
  "hardhat/=lib/v4-periphery/lib/v4-core/node_modules/hardhat/",
];
export const AJUSTES = {
  viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun",
  remappings: REMAP_OPENLAUNCH,
};
export const VERSION_SOLC = "0.8.26+commit.8a97fa7a";

function resolver(desde, imp) {
  if (imp.startsWith("./") || imp.startsWith("../")) return path.posix.normalize(path.posix.join(path.posix.dirname(desde), imp));
  for (const [a, b] of REMAP) if (imp.startsWith(a)) return b + imp.slice(a.length);
  return imp;
}
async function leer(clave) {
  if (clave.startsWith("src/")) return fs.readFileSync(path.join(DIR, clave), "utf8").replace(/\r\n/g, "\n");
  const cache = path.join(DEPS, clave);
  if (fs.existsSync(cache)) return fs.readFileSync(cache, "utf8");
  const o = ORIGENES.find(([pref]) => clave.startsWith(pref));
  if (!o) throw new Error("no se de donde sale " + clave);
  const url = "https://raw.githubusercontent.com/" + o[1] + "/" + o[2] + "/" + clave.slice(o[0].length);
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  const txt = await r.text();
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, txt);
  return txt;
}
export async function entradaEstandar(raices = ["src/BaseyLaunchFactoryV4.sol"]) {
  const sources = {};
  const cola = [...raices];
  while (cola.length) {
    const k = cola.shift();
    if (sources[k]) continue;
    const txt = await leer(k);
    sources[k] = { content: txt };
    const re = /import\s+(?:[^"';]*?from\s+)?["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(txt))) cola.push(resolver(k, m[1]));
  }
  return { language: "Solidity", sources, settings: { ...AJUSTES } };
}
export function solc026() {
  const b = path.join(process.env.APPDATA || "", "svm", "0.8.26", "solc-0.8.26");
  const f = [b + ".exe", b].find((x) => fs.existsSync(x));
  if (!f) throw new Error("solc 0.8.26 no esta (svm install 0.8.26)");
  return f;
}
export function compilar(entrada) {
  const conSalida = { ...entrada, settings: { ...entrada.settings, outputSelection: { "*": { "*": [
    "abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences", "metadata"] } } } };
  const out = JSON.parse(execFileSync(solc026(), ["--standard-json"], { input: JSON.stringify(conSalida), maxBuffer: 256e6 }).toString());
  const errores = (out.errors || []).filter((e) => e.severity === "error");
  if (errores.length) throw new Error(errores.map((e) => e.formattedMessage).join("\n"));
  return { out, avisos: (out.errors || []).filter((e) => e.severity === "warning") };
}

/* EL TOKEN, COMO LO COMPILA LA PAGINA: solc 0.8.24, optimizador 200, evm paris y el
   fichero "Token.sol" (el nombre entra en los metadatos). Con esto sale la huella
   del BaseyToken verificado; tools/probar-token-fijo.mjs la fija. */
export function compilarToken(fuente) {
  const b = path.join(process.env.APPDATA || "", "svm", "0.8.24", "solc-0.8.24");
  const solc = [b + ".exe", b].find((x) => fs.existsSync(x));
  if (!solc) throw new Error("solc 0.8.24 no esta (svm install 0.8.24)");
  const e = { language: "Solidity", sources: { "Token.sol": { content: fuente } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } } };
  const out = JSON.parse(execFileSync(solc, ["--standard-json"], { input: JSON.stringify(e), maxBuffer: 64e6 }).toString());
  const errores = (out.errors || []).filter((x) => x.severity === "error");
  if (errores.length) throw new Error(errores.map((x) => x.formattedMessage).join("\n"));
  return out.contracts["Token.sol"];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entrada = await entradaEstandar();
  console.log("fuentes:", Object.keys(entrada.sources).length);
  const { out, avisos } = compilar(entrada);
  for (const a of avisos) console.log("aviso:", a.formattedMessage.split("\n")[0]);
  const F = out.contracts["src/BaseyLaunchFactoryV4.sol"].BaseyLaunchFactoryV4;
  const L = out.contracts["src/LaunchLocker.sol"].LaunchLocker;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "entrada-estandar.json"), JSON.stringify(entrada));
  fs.writeFileSync(path.join(OUT, "BaseyLaunchFactoryV4.json"), JSON.stringify({ abi: F.abi, bytecode: "0x" + F.evm.bytecode.object, deployedBytecode: "0x" + F.evm.deployedBytecode.object }, null, 1));
  fs.writeFileSync(path.join(OUT, "LaunchLocker.json"), JSON.stringify({ abi: L.abi, bytecode: "0x" + L.evm.bytecode.object, deployedBytecode: "0x" + L.evm.deployedBytecode.object, immutableReferences: L.evm.deployedBytecode.immutableReferences }, null, 1));
  console.log("fabrica:", F.evm.deployedBytecode.object.length / 2, "B de ejecucion,", F.evm.bytecode.object.length / 2, "B de creacion (lleva dentro la del locker)");
  console.log("locker :", L.evm.deployedBytecode.object.length / 2, "B de ejecucion");

  /* LO QUE USA LA PAGINA: fabrica-v4-codigo.js, generado aqui y nunca a mano. El
     codigo de creacion de la fabrica (la pagina no tiene solc 0.8.26 ni las
     dependencias) y el de los dos tokens con sus hashes, que son los que la
     fabrica exige: asi la pagina no necesita compilar nada para lanzar en V4. */
  const { pathToFileURL } = await import("node:url");
  const { BASEY_TOKEN_SOURCE } = await import(pathToFileURL(path.join(raiz, "basey-token.js")).href);
  const { createRequire } = await import("node:module");
  const { ethers } = createRequire(import.meta.url)(path.join(raiz, "..", "blop-contracts", "node_modules", "ethers"));
  const TK = compilarToken(BASEY_TOKEN_SOURCE);
  const codTok = "0x" + TK.BaseyToken.evm.bytecode.object;
  const codEd = "0x" + TK.BaseyTokenEditable.evm.bytecode.object;
  const huella = ethers.keccak256("0x" + TK.BaseyToken.evm.deployedBytecode.object);
  if (huella !== "0x4f51a2182fbbb77c55711d2301e9ad4de66be64ea53d1f8c352e7ad08e0e02e4") {
    throw new Error("el BaseyToken ya no compila a la huella verificada (" + huella + "): no se genera nada");
  }
  const lineas = [
    "/* GENERADO por tools/compilar-v4.mjs. NO SE EDITA A MANO: se regenera con",
    "     node tools/compilar-v4.mjs",
    "   y se sube su ?v= en fabrica-v4.js. */",
    "export const CREACION_FABRICA = " + JSON.stringify("0x" + F.evm.bytecode.object) + ";",
    "export const CODIGO_TOKEN = " + JSON.stringify(codTok) + ";",
    "export const CODIGO_EDITABLE = " + JSON.stringify(codEd) + ";",
    "export const HASH_TOKEN = " + JSON.stringify(ethers.keccak256(codTok)) + ";",
    "export const HASH_EDITABLE = " + JSON.stringify(ethers.keccak256(codEd)) + ";",
    "export const ABI_FABRICA = " + JSON.stringify(F.abi) + ";",
    "export const ABI_LOCKER = " + JSON.stringify(L.abi) + ";",
    "",
  ];
  fs.writeFileSync(path.join(raiz, "fabrica-v4-codigo.js"), lineas.join("\n"));
  console.log("fabrica-v4-codigo.js:", fs.statSync(path.join(raiz, "fabrica-v4-codigo.js")).size, "B | hash token", ethers.keccak256(codTok).slice(0, 12) + "…, editable", ethers.keccak256(codEd).slice(0, 12) + "…");
}
