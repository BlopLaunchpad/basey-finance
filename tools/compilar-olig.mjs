/* EL TOKEN OLIGARC ($OLIG) PARA LA PAGINA (4-oct-2026).
     cd contratos-olig && forge test      (compila con solc 0.8.37, evm cancun, optimizador 200: ver foundry.toml)
     node tools/compilar-olig.mjs         -> olig-codigo.js (lo que despliega la pestaña 9)
   La pagina no compila nada: despliega EXACTAMENTE el bytecode que forge compilo y probo (8 pruebas), el mismo que luego
   se verifica en Sourcify con la metadata de contratos-olig/out. Escribe tambien el md5 del bytecode para comprobarlo. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const art = JSON.parse(fs.readFileSync(path.join(RAIZ, "contratos-olig", "out", "Oligarc.sol", "Oligarc.json"), "utf8"));
const bytecode = art.bytecode && art.bytecode.object;
if (!/^0x[0-9a-f]+$/i.test(bytecode || "") || bytecode.length < 2000) throw new Error("sin bytecode: haz forge build en contratos-olig");
const solc = art.metadata && art.metadata.compiler && art.metadata.compiler.version;
const md5 = crypto.createHash("md5").update(bytecode).digest("hex");
const abi = art.abi.filter((x) => x.type === "function" && ["name", "symbol", "decimals", "totalSupply", "balanceOf", "INITIAL_SUPPLY"].includes(x.name));
const salida = `/* GENERADO por tools/compilar-olig.mjs el ${new Date().toISOString()} — no se edita a mano.
   Oligarc ($OLIG): contratos-olig/src/Oligarc.sol, solc ${solc}, evm cancun, optimizador 200. md5 del bytecode: ${md5} */
export const OLIG_BYTECODE = "${bytecode}";
export const OLIG_BYTECODE_MD5 = "${md5}";
export const OLIG_SOLC = "${solc}";
export const OLIG_ABI = ${JSON.stringify(abi)};
`;
fs.writeFileSync(path.join(RAIZ, "olig-codigo.js"), salida);
console.log("olig-codigo.js | bytecode", (bytecode.length - 2) / 2, "bytes | md5", md5, "| solc", solc);
