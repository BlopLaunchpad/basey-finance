/* Pestaña 10 (5-oct-2026, v2 tras la revision): prueba wallet.html de punta a punta en un Chrome headless con perfil TEMPORAL
   (nunca el del dueño) y sin red salvo localhost y cdnjs (para el SRI del launcher). Las wallets que crea son de usar y
   tirar: nunca se fondean, los ficheros se borran al acabar y la clave no se imprime.
   Comprueba: "Network: blocked" por la violacion de CSP (en http y en file://); nada fuera de sus ficheros; la frase de 8
   palabras; contraseñas propias no ASCII, cortas o repetitivas rechazadas; la direccion NO aparece hasta el paso 4; el paso 4
   rechaza la contraseña pegada, la mala y el fichero de otra wallet; el fichero lo abre ethers en Node con la frase y da la
   misma direccion; la clave no esta en el fichero ni en el DOM ni en localStorage; dos wallets salen distintas; la pagina se
   para si la abre otra pagina o va en un marco; la pestaña 10 y el ethers del launcher con SRI cargan.
   node tools/probar-wallet.mjs [directorio-capturas] */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// puppeteer-core vive en el repo hermano cusp-web (no se instala aqui)
const puppeteer = require(path.join(RAIZ, "..", "cusp-web", "node_modules", "puppeteer-core"));
const { ethers } = require("ethers");
const PUERTO = 4329, BASE = `http://localhost:${PUERTO}`;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CAPTURAS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "basey-wallet-capturas-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bien = 0, mal = 0;
function comprobar(nombre, ok, extra) { if (ok) bien++; else mal++; console.log((ok ? "  bien  " : "  MAL   ") + nombre + (ok || extra === undefined ? "" : "  -> " + JSON.stringify(extra))); }

const servidor = spawn(process.execPath, [path.join(RAIZ, "dev-server.js"), String(PUERTO)], { stdio: "ignore" });
await sleep(700);
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "basey-wallet-perfil-"));
const bajadas = fs.mkdtempSync(path.join(os.tmpdir(), "basey-wallet-bajadas-"));
fs.mkdirSync(CAPTURAS, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: perfil,
  args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-sync",
    "--disable-component-update", "--no-pings", "--hide-scrollbars", "--allow-file-access-from-files",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE cdnjs.cloudflare.com"],
});

async function abrir(url, ancho, alto, movil) {
  const page = await browser.newPage();
  await page.setViewport({ width: ancho, height: alto, deviceScaleFactor: 1, isMobile: !!movil, hasTouch: !!movil });
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: bajadas });
  page.__peticiones = []; page.__errores = [];
  page.on("request", (r) => page.__peticiones.push(r.url()));
  page.on("pageerror", (e) => page.__errores.push(String(e)));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => /blocked|OPEN|unverified/.test(document.getElementById("wlRed").textContent), { timeout: 10000 });
  return page;
}
async function mover(page, movil) {
  if (movil) {
    await page.touchscreen.touchStart(30, 200);
    for (let i = 0; i < 320; i++) await page.touchscreen.touchMove(20 + ((i * 37) % 340), 120 + ((i * 53) % 500));
    await page.touchscreen.touchEnd();
  } else {
    for (let i = 0; i < 320; i++) await page.mouse.move(20 + ((i * 37) % 600), 20 + ((i * 53) % 500));
  }
}
const texto = (page, id) => page.$eval("#" + id, (e) => e.textContent);
const oculto = (page, id) => page.$eval("#" + id, (e) => e.hidden);
async function crearConFrase(page, movil) {
  await mover(page, movil);
  await page.click("#wlFrase");
  const frase = (await texto(page, "wlFraseTxt")).trim();
  const antesPapel = await page.$eval("#wlCrear", (b) => b.disabled);
  await page.click("#wlPapel");
  const habilitado = await page.$eval("#wlCrear", (b) => !b.disabled);
  if (!habilitado) throw new Error("Create sigue deshabilitado (barra " + await texto(page, "wlBarraTxt") + ", " + await texto(page, "wlPassMsg") + ")");
  await page.click("#wlCrear");
  await page.waitForFunction(() => !document.getElementById("wlHecho").hidden || /didn't work/.test(document.getElementById("wlCreando").textContent), { timeout: 90000 });
  return { frase, antesPapel };
}
async function bajar(page, excluir) {
  await page.click("#wlBajar");
  let f = null;
  for (let i = 0; i < 60 && !f; i++) { await sleep(200); f = fs.readdirSync(bajadas).find((x) => x.endsWith(".json") && !excluir.includes(x)); }
  if (!f) throw new Error("no bajo nada; en la carpeta: " + JSON.stringify(fs.readdirSync(bajadas)) + "; boton: " + await texto(page, "wlBajar") + "; hecho oculto: " + await oculto(page, "wlHecho") + "; " + await texto(page, "wlCreando"));
  return f;
}
async function comprobarFichero(page, fichero, pw) {
  await (await page.$("#wlFich")).uploadFile(path.join(bajadas, fichero));
  await page.$eval("#wlPass3", (e) => { e.value = ""; e.dispatchEvent(new InputEvent("input", { inputType: "deleteContentBackward" })); });
  await page.type("#wlPass3", pw);
  await page.$eval("#wlRes", (e) => { e.textContent = ""; e.className = "wl-msg"; });
  await page.click("#wlComprobar");
  await page.waitForFunction(() => { const r = document.getElementById("wlRes"); return r.classList.contains("is-ok") || r.classList.contains("is-mal"); }, { timeout: 60000 });
  return texto(page, "wlRes");
}

try {
  console.log("wallet.html en", BASE);
  const page = await abrir(BASE + "/wallet.html", 1280, 900);
  comprobar("la pagina dice Network: blocked (violacion de CSP)", (await texto(page, "wlRed")) === "Network: blocked");
  comprobar("dice que viene de la web", (await texto(page, "wlDonde")) === "From the website");
  comprobar("Create empieza deshabilitado", await page.$eval("#wlCrear", (b) => b.disabled));

  // contraseñas propias malas
  await page.click("#wlPropia summary");
  for (const [pw, re, nombre] of [["contraseñamuylarga123", /plain letters/, "no ASCII (ñ)"], ["ºlargalargalarga1", /plain letters/, "no ASCII (º)"], ["corta12", /more character/, "corta"], ["aaaaaaaaaaaaaaaaaaaa", /repetitive/, "repetitiva"]]) {
    await page.$eval("#wlPass", (e) => { e.value = ""; }); await page.type("#wlPass", pw);
    comprobar("contraseña propia " + nombre + ": rechazada", re.test(await texto(page, "wlPassMsg")), await texto(page, "wlPassMsg"));
  }
  await page.$eval("#wlPass", (e) => { e.value = ""; e.dispatchEvent(new Event("input")); });
  await page.click("#wlPropia summary");

  const r1 = await crearConFrase(page);
  comprobar("la frase son 8 palabras BIP39 con guiones", r1.frase.split("-").length === 8 && r1.frase.split("-").every((w) => ethers.wordlists.en.getWordIndex(w) >= 0), r1.frase);
  comprobar("sin marcar 'en papel' no se puede crear", r1.antesPapel);
  comprobar("creada; la frase ya no se ve", !(await oculto(page, "wlHecho")) && !(await texto(page, "wlFraseTxt")).includes(r1.frase.split("-")[0] + "-"));
  comprobar("la direccion NO se ve todavia", await oculto(page, "wlListo"));

  const f1 = await bajar(page, []);
  comprobar("baja el fichero keystore-<fecha>-<id>.json", /^keystore-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.json$/.test(f1 || ""), f1);
  const json1 = fs.readFileSync(path.join(bajadas, f1), "utf8");
  const w1 = await ethers.Wallet.fromEncryptedJson(json1, r1.frase);
  const pk = w1.privateKey.slice(2).toLowerCase();
  comprobar("la clave NO esta en el fichero", !json1.toLowerCase().includes(pk));
  const cj = JSON.parse(json1).crypto || JSON.parse(json1).Crypto;
  comprobar("el fichero es scrypt + aes-128-ctr", cj && cj.kdf === "scrypt" && cj.cipher === "aes-128-ctr");
  const html1 = (await page.evaluate(() => document.documentElement.outerHTML)).toLowerCase();
  comprobar("la clave NO esta en el DOM", !html1.includes(pk));
  comprobar("la direccion NO esta en el DOM antes del paso 4", !html1.includes(w1.address.slice(2).toLowerCase()));
  comprobar("nada en localStorage ni sessionStorage", await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0));

  // paso 4: pegada, mala, buena
  await (await page.$("#wlFich")).uploadFile(path.join(bajadas, f1));
  await page.$eval("#wlPass3", (e, v) => { e.value = v; e.dispatchEvent(new InputEvent("input", { inputType: "insertFromPaste", data: v })); }, r1.frase);
  await page.click("#wlComprobar");
  await page.waitForFunction(() => document.getElementById("wlRes").classList.contains("is-mal"), { timeout: 10000 });
  comprobar("contraseña PEGADA: rechazada", /from your paper/.test(await texto(page, "wlRes")), await texto(page, "wlRes"));
  comprobar("contraseña mala: lo dice", /Wrong password/.test(await comprobarFichero(page, f1, "no-es-esta-para-nada")));
  comprobar("contraseña mala: ni direccion ni paso 5", (await oculto(page, "wlListo")) && (await oculto(page, "wlS5")));
  const ok1 = await comprobarFichero(page, f1, r1.frase);
  comprobar("frase tecleada: la copia funciona", /backup works/.test(ok1), ok1);
  comprobar("y ahora si: la direccion es la del fichero y sale el paso 5", (await texto(page, "wlDir")) === w1.address && !(await oculto(page, "wlS5")));
  await page.screenshot({ path: path.join(CAPTURAS, "wallet-pc-comprobada.png"), fullPage: true });

  const propias = new Set(["/wallet.html", "/style.css", "/wallet.css", "/ethers-6.17.0.umd.min.js", "/wallet.js", "/favicon.ico"]);
  const ajenas = page.__peticiones.filter((u) => !(u.startsWith(BASE) && propias.has(new URL(u).pathname)) && !u.startsWith("blob:"));
  comprobar("no pide nada fuera de sus ficheros (ni el robots.txt de la prueba de red)", ajenas.length === 0, ajenas);
  comprobar("sin errores de JavaScript", page.__errores.length === 0, page.__errores);

  // una segunda, en el movil; su fichero en la primera pestaña
  const page2 = await abrir(BASE + "/wallet.html", 393, 852, true);
  await page2.screenshot({ path: path.join(CAPTURAS, "wallet-movil-arriba.png") });
  const r2 = await crearConFrase(page2, true);
  const f2 = await bajar(page2, [f1]);
  const w2 = await ethers.Wallet.fromEncryptedJson(fs.readFileSync(path.join(bajadas, f2), "utf8"), r2.frase);
  comprobar("una segunda wallet sale distinta", w2.address !== w1.address);
  comprobar("movil 393: sin scroll horizontal", await page2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page2.screenshot({ path: path.join(CAPTURAS, "wallet-movil-creada.png"), fullPage: true });
  await page.bringToFront(); // una pestaña de fondo se queda dormida en headless
  comprobar("el fichero de OTRA wallet: avisa de que es distinta", /DIFFERENT/.test(await comprobarFichero(page, f2, r2.frase)));

  // guardas: abierta por otra pagina del mismo sitio, y dentro de un marco
  const madre = await browser.newPage();
  await madre.goto(BASE + "/wallet.css"); // una pagina cualquiera del mismo sitio (robots.txt lo baja como fichero)
  const nueva = new Promise((ok) => browser.once("targetcreated", (t) => ok(t.page())));
  await madre.evaluate(() => { window.__w = window.open("/wallet.html"); });
  const hija = await nueva;
  await hija.waitForFunction(() => !document.getElementById("wlParo").hidden, { timeout: 10000 }).catch(() => {});
  comprobar("abierta por otra pagina (window.open): se para", /opened by another page/.test(await texto(hija, "wlParo")) && await hija.$eval("#wlCrear", (b) => b.disabled));
  await hija.close(); await madre.bringToFront();
  await madre.evaluate(() => { const f = document.createElement("iframe"); f.src = "/wallet.html"; f.id = "marco"; document.body.appendChild(f); });
  await sleep(1500);
  const marco = madre.frames().find((f) => f.url().endsWith("/wallet.html"));
  comprobar("dentro de un marco: se para", !!marco && /inside a frame/.test(await marco.$eval("#wlParo", (e) => e.textContent)));
  await madre.close();

  // file:// (la copia local, la que se usa de verdad)
  const local = await abrir(pathToFileURL(path.join(RAIZ, "wallet.html")).href, 1280, 900);
  comprobar("file://: Network: blocked y 'Local copy'", (await texto(local, "wlRed")) === "Network: blocked" && (await texto(local, "wlDonde")) === "Local copy", [await texto(local, "wlRed"), await texto(local, "wlDonde")]);
  await local.screenshot({ path: path.join(CAPTURAS, "wallet-local-arriba.png") });
  await local.close();

  // la pestaña 10 y el ethers del launcher con SRI
  const clave = (fs.readFileSync(path.join(RAIZ, "index.html"), "utf8").match(/var CLAVE = "([^"]*)"/) || [])[1];
  const p3 = await browser.newPage();
  const errores3 = [];
  p3.on("console", (m) => { if (m.type() === "error") errores3.push(m.text()); });
  await p3.setViewport({ width: 1280, height: 900 });
  await p3.evaluateOnNewDocument((c) => { try { localStorage.setItem("arcLauncher.gate", c); } catch (e) { /* */ } }, clave);
  await p3.goto(BASE + "/", { waitUntil: "load" });
  comprobar("el launcher carga ethers 6.13.2 con SRI", await p3.evaluate(() => !!(window.ethers && window.ethers.version)), errores3.filter((e) => /integrity|ethers/i.test(e)));
  await p3.click('[data-step="10"]');
  await sleep(400);
  comprobar("pestaña 10: manda a la copia local y no promete aislamiento", await p3.evaluate(() => {
    const p = document.querySelector('[data-panel="10"]');
    return p && !p.hidden && /arc-launcher/.test(p.textContent) && /Guest window/.test(p.textContent) && !/in the room/.test(p.textContent);
  }));
  await p3.screenshot({ path: path.join(CAPTURAS, "basey-pestana-10.png") });
} catch (e) {
  mal++; console.log("  MAL   la prueba se rompio:", e && e.stack || e);
} finally {
  await browser.close().catch(() => {});
  servidor.kill();
  for (const d of [perfil, bajadas]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* */ } }
}
console.log(`\n${bien} bien, ${mal} mal. Capturas en ${CAPTURAS}`);
process.exit(mal ? 1 : 0);
