/* Pestaña 9 (5-oct-2026): que el bloque del pool solo con USDC carga y se pinta, sin errores, en PC y movil (Chrome headless
   con perfil temporal; sin wallet: no se firma nada). node tools/probar-pestana-9.mjs [capturas] */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const puppeteer = require(path.join(RAIZ, "..", "cusp-web", "node_modules", "puppeteer-core"));
const CAP = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "basey-p9-"));
const PUERTO = 4331, BASE = `http://localhost:${PUERTO}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bien = 0, mal = 0;
const comprobar = (n, ok, x) => { ok ? bien++ : mal++; console.log((ok ? "  bien  " : "  MAL   ") + n + (ok || x === undefined ? "" : "  -> " + JSON.stringify(x))); };
const srv = spawn(process.execPath, [path.join(RAIZ, "dev-server.js"), String(PUERTO)], { stdio: "ignore" });
await sleep(700);
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "basey-p9-perfil-"));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, userDataDir: perfil,
  args: ["--no-first-run", "--disable-extensions", "--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE cdnjs.cloudflare.com, EXCLUDE rpc.mainnet.arc.io, EXCLUDE arc.drpc.org"] });
fs.mkdirSync(CAP, { recursive: true });
try {
  const clave = (fs.readFileSync(path.join(RAIZ, "index.html"), "utf8").match(/var CLAVE = "([^"]*)"/) || [])[1];
  for (const [nombre, w, h, movil] of [["pc", 1280, 900, false], ["movil", 393, 852, true]]) {
    const p = await browser.newPage();
    const errores = [];
    p.on("pageerror", (e) => errores.push(String(e)));
    p.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(m.text())) errores.push(m.text()); });
    await p.setViewport({ width: w, height: h, isMobile: movil, hasTouch: movil });
    await p.evaluateOnNewDocument((c) => { try { localStorage.setItem("arcLauncher.gate", c); } catch (e) { /* */ } }, clave);
    await p.goto(BASE + "/", { waitUntil: "load" });
    await p.click('[data-step="9"]');
    await sleep(1500);
    const r = await p.evaluate(() => ({ btn: !!document.getElementById("oligPoolBtn"), sacar: !!document.getElementById("oligPoolSacar"),
      usdc: document.getElementById("oligPoolUsdc") && document.getElementById("oligPoolUsdc").value, sinScroll: document.documentElement.scrollWidth <= window.innerWidth }));
    comprobar(nombre + ": boton de abrir el pool y de sacar el USDC", r.btn && r.sacar, r);
    comprobar(nombre + ": 2 USDC por defecto", r.usdc === "2");
    comprobar(nombre + ": sin scroll horizontal", r.sinScroll);
    // sin wallet: pulsar abrir avisa y no rompe
    await p.click("#oligPoolBtn");
    await sleep(500);
    comprobar(nombre + ": sin wallet, lo dice", /No browser wallet/.test(await p.$eval("#oligPoolMsg", (e) => e.textContent)), await p.$eval("#oligPoolMsg", (e) => e.textContent));
    comprobar(nombre + ": sin errores de JavaScript", errores.length === 0, errores);
    const el = await p.$("#oligPoolBtn");
    await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await p.screenshot({ path: path.join(CAP, "pestana9-pool-" + nombre + ".png") });
    await p.close();
  }
} catch (e) { mal++; console.log("  MAL   se rompio:", e && e.stack || e); }
finally { await browser.close().catch(() => {}); srv.kill(); try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) { /* */ } }
console.log(`\n${bien} bien, ${mal} mal. Capturas en ${CAP}`);
process.exit(mal ? 1 : 0);
