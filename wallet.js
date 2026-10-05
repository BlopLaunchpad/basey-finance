/* basey · pestaña 10 (5-oct-2026, v2 tras la revision adversaria): una wallet EVM nueva cuya clave privada NO se enseña.
   - Aleatoriedad: 32 bytes del generador del sistema (crypto.getRandomValues), lo que aporten raton, teclado y toques, y otros
     32 bytes del sistema, todo junto por SHA-256. El generador del sistema ya da los 256 bits que caben en una clave; lo demas
     se mezcla encima y solo puede sumar. La clave se rechaza y se rehace si cae fuera del rango de secp256k1 (0 < k < n).
   - La clave solo vive en memoria: se cifra al momento (keystore V3 de ethers: scrypt N=2^17 + AES-128-CTR) y se suelta (los
     bytes se ponen a cero; los strings de JS no se pueden borrar: por eso se pide cerrar la ventana al acabar).
   - Contraseña: la pagina propone 8 palabras BIP39 (88 bits) o se teclea una propia de 16+ caracteres SOLO ASCII imprimible:
     ethers la normaliza (NFKC) y MetaMask no, asi que con º, ª, tildes sueltas o espacios duros el paso 4 daria OK y MetaMask
     no abriria el fichero (medido en la revision).
   - La direccion NO se enseña hasta que el paso 4 abre el fichero GUARDADO con la contraseña: nadie fondea una wallet sin
     copia comprobada. (v3, el dueño desde el movil: la frase va con espacios, el paso 4 acepta pegar y cada campo tiene Show
     para compararla con el papel; antes se rechazaba lo pegado.)
   - Guardas: se para si la abre otra pagina (window.opener) o va dentro de un marco (window.top): la CSP no protege de una
     pagina del mismo sitio con una referencia a esta ventana. La red se da por bloqueada solo si salta la violacion de CSP
     connect-src y el meta CSP esta como debe; un simple fallo de red no vale.
   - ethers va copiado en la raiz y comprobado contra npm y cdnjs (tools/copiar-ethers.mjs). */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const E = window.ethers;
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n; // orden de secp256k1
  const META = 256;        // muestras de raton/teclado/toque que llenan la barra
  const MIN_PROPIA = 16;
  const ASCII = /^[\x20-\x7e]+$/;

  let redBloqueada = false, creando = false, fichero = null, direccionCreada = null, bajado = false, comprobado = false;
  let parada = false, frase = null;

  function parar(texto) {
    parada = true;
    const p = $("wlParo"); p.textContent = texto; p.hidden = false;
    $("wlCrear").disabled = true;
  }
  function msg(id, texto, clase) {
    const el = $(id); el.textContent = texto || "";
    el.classList.toggle("is-ok", clase === "ok"); el.classList.toggle("is-mal", clase === "mal");
  }

  // ---- guardas: sola, sin marco, con ethers
  let sola = true;
  try { sola = window.opener === null && window.top === window.self; } catch (e) { sola = false; }
  if (!sola) { parar("This page was opened by another page or inside a frame. Close it and open it on its own (step 0)."); }
  if (!E || !E.Wallet || !E.sha256 || !E.wordlists || !E.wordlists.en) { parar("The page didn't load completely (ethers is missing). Reload it."); return; }

  const local = location.protocol === "file:";
  $("wlDonde").textContent = local ? "Local copy" : "From the website";
  $("wlDonde").classList.add(local ? "is-ok" : "is-aviso");

  // ---- la red: tiene que estar BLOQUEADA por la CSP. Se prueba contra el propio sitio (si faltara la CSP no se avisa a nadie)
  (async function probarRed() {
    const chip = $("wlRed");
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const c = meta ? meta.getAttribute("content") || "" : "";
    const cspOk = /default-src 'none'/.test(c) && /connect-src 'none'/.test(c) && /script-src 'self'/.test(c);
    let violacion = false;
    document.addEventListener("securitypolicyviolation", (e) => { if (e.effectiveDirective === "connect-src") violacion = true; });
    let abierta = false;
    try { await fetch("robots.txt", { cache: "no-store" }); abierta = true; } catch (e) { /* lo esperado */ }
    for (let i = 0; i < 20 && !violacion && !abierta; i++) await new Promise((r) => setTimeout(r, 50));
    if (!abierta && violacion && cspOk) {
      redBloqueada = true;
      chip.textContent = "Network: blocked"; chip.classList.add("is-ok");
    } else {
      chip.textContent = abierta ? "Network: OPEN" : "Network: unverified"; chip.classList.add("is-mal");
      parar(abierta ? "This copy of the page can reach the network, so it isn't the real one (or it was served without its protection). Don't create a wallet here."
        : "This page couldn't prove that its network protection is on. Don't create a wallet here; open the local copy (step 0).");
    }
    pintar();
  })();

  // ---- 1. aleatoriedad extra: tiempos y posiciones; NUNCA las teclas de las contraseñas
  const muestras = [];
  let eventos = 0, lx = -9, ly = -9;
  function anotar(a, b, c) {
    if (muestras.length < 16384) muestras.push(performance.now(), a, b, c);
    if (eventos < META) { eventos++; pintar(); }
  }
  document.addEventListener("pointermove", (e) => {
    if (Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) < 4) return;
    lx = e.clientX; ly = e.clientY;
    anotar(e.clientX + e.clientY / 1e4, e.screenX - e.screenY, e.timeStamp);
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    const t = e.touches && e.touches[0];
    if (!t || Math.abs(t.clientX - lx) + Math.abs(t.clientY - ly) < 4) return;
    lx = t.clientX; ly = t.clientY;
    anotar(t.clientX + t.clientY / 1e4, t.force || 0, e.timeStamp);
  }, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.target && e.target.tagName === "INPUT") return; // las contraseñas (tambien con Show, que las pasa a texto)
    anotar(e.timeStamp, e.repeat ? 1 : 0, eventos);
  });

  // ---- 2. contraseña: la frase de 8 palabras o una propia (16+, solo ASCII)
  function hacerFrase() {
    const lista = E.wordlists.en, r = crypto.getRandomValues(new Uint16Array(8)), w = [];
    for (let i = 0; i < 8; i++) w.push(lista.getWord(r[i] & 2047)); // 65536 es multiplo de 2048: sin sesgo
    r.fill(0);
    return w.join(" ");
  }
  // Show / Hide en cada contraseña
  for (const b of document.querySelectorAll(".wl-ver")) {
    b.addEventListener("click", () => {
      const i = $(b.dataset.para), ver = i.type === "password";
      i.type = ver ? "text" : "password";
      b.textContent = ver ? "Hide" : "Show";
      b.setAttribute("aria-pressed", String(ver));
    });
  }
  $("wlFraseCopiar").addEventListener("click", async () => {
    if (!frase) return;
    try { await navigator.clipboard.writeText(frase); $("wlFraseCopiar").textContent = "Copied"; }
    catch (e) { $("wlFraseCopiar").textContent = "Select it by hand"; }
    setTimeout(() => { $("wlFraseCopiar").textContent = "Copy"; }, 1800);
  });
  $("wlFrase").addEventListener("click", () => {
    if (fichero) return;
    frase = hacerFrase();
    $("wlFraseTxt").textContent = frase;
    $("wlFraseCaja").hidden = false;
    $("wlPass").value = ""; $("wlPass2").value = "";
    $("wlPropia").open = false;
    $("wlFrase").textContent = "Make another one";
    $("wlPapel").checked = false;
    pintar();
  });
  $("wlPropia").addEventListener("toggle", () => {
    if ($("wlPropia").open && frase) { frase = null; $("wlFraseCaja").hidden = true; $("wlFraseTxt").textContent = ""; $("wlFrase").textContent = "Make a password for me (8 words)"; $("wlPapel").checked = false; }
    pintar();
  });
  function contrasena() {
    if (frase) return { pw: frase, ok: true, texto: "Password made: 8 words." };
    const a = $("wlPass").value, b = $("wlPass2").value;
    if (!a) return { ok: false, texto: "" };
    if (!ASCII.test(a)) return { ok: false, mal: true, texto: "Only plain letters, numbers and symbols: no accents, ñ, º or ª." };
    if (a.length < MIN_PROPIA) return { ok: false, mal: true, texto: (MIN_PROPIA - a.length) + " more character" + (MIN_PROPIA - a.length === 1 ? "" : "s") + " at least." };
    if (new Set(a).size < 6) return { ok: false, mal: true, texto: "Too repetitive: use more different characters." };
    if (!b) return { ok: false, texto: "Now repeat it." };
    if (a !== b) return { ok: false, mal: true, texto: "The two don't match." };
    return { pw: a, ok: true, texto: "Good." };
  }
  $("wlPass").addEventListener("input", pintar);
  $("wlPass2").addEventListener("input", pintar);
  $("wlPapel").addEventListener("change", pintar);

  function listoParaCrear() {
    return !parada && redBloqueada && eventos >= META && contrasena().ok && $("wlPapel").checked && !creando && !fichero;
  }
  function pintar() {
    const pct = Math.min(100, Math.floor((eventos / META) * 100));
    $("wlBarra").value = Math.min(eventos, META);
    $("wlBarraTxt").textContent = pct + " %";
    const c = contrasena();
    msg("wlPassMsg", c.texto, c.ok ? "ok" : c.mal ? "mal" : "");
    $("wlCrear").disabled = !listoParaCrear();
  }

  // ---- 3. crear
  function unir(partes) {
    const t = partes.reduce((s, p) => s + p.length, 0), u = new Uint8Array(t);
    let o = 0; for (const p of partes) { u.set(p, o); o += p.length; }
    return u;
  }
  function claveValida(k) {
    const v = BigInt(E.hexlify(k));
    return v > 0n && v < N;
  }
  function nuevaClave() {
    for (let i = 0; i < 8; i++) {
      const a = crypto.getRandomValues(new Uint8Array(32));
      const b = crypto.getRandomValues(new Uint8Array(32));
      const x = new Uint8Array(new Float64Array(muestras).buffer);
      const todo = unir([a, x, b]);
      const k = E.getBytes(E.sha256(todo));
      a.fill(0); b.fill(0); x.fill(0); todo.fill(0);
      if (claveValida(k)) return k;
      k.fill(0);
    }
    throw new Error("the generator failed 8 times in a row");
  }
  $("wlCrear").addEventListener("click", async () => {
    if (!listoParaCrear()) return; // se vuelve a mirar todo aqui, no solo el boton
    const pw = contrasena().pw;
    creando = true; pintar();
    try {
      msg("wlCreando", "Creating and encrypting… (a few seconds)");
      const k = nuevaClave();
      let w = new E.Wallet(E.hexlify(k));
      k.fill(0);
      const dir = w.address;
      const json = await w.encrypt(pw, (p) => msg("wlCreando", "Encrypting… " + Math.round(p * 100) + " %"));
      w = null;
      msg("wlCreando", "Checking that the file opens with the password…");
      const vuelta = await E.Wallet.fromEncryptedJson(json, pw);
      if (vuelta.address !== dir) throw new Error("the encrypted file does not open to the same address");
      fichero = json; direccionCreada = dir;
      $("wlPass").value = ""; $("wlPass2").value = "";
      if (frase) { frase = null; $("wlFraseTxt").textContent = ""; $("wlFraseCaja").hidden = true; }
      $("wlFrase").disabled = true; $("wlPropia").hidden = true;
      $("wlHecho").hidden = false;
      msg("wlCreando", "Created. Download the file now: this tab is the only place it exists.", "ok");
    } catch (e) {
      msg("wlCreando", "It didn't work: " + (e && e.message ? e.message : e) + ". Nothing was created; try again.", "mal");
    } finally {
      creando = false; pintar();
    }
  });
  $("wlBajar").addEventListener("click", () => {
    if (!fichero) return;
    const url = URL.createObjectURL(new Blob([fichero], { type: "application/json" }));
    const a = document.createElement("a");
    // nombre unico sin la direccion (que no se ve hasta el paso 4): fecha + el id aleatorio del propio keystore
    let id = ""; try { id = String(JSON.parse(fichero).id || "").replace(/[^0-9a-f]/gi, "").slice(0, 8); } catch (e) { /* */ }
    a.href = url; a.download = "keystore-" + new Date().toISOString().slice(0, 10) + (id ? "-" + id : "") + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    bajado = true;
    $("wlBajar").textContent = "Download it again";
  });

  // ---- 4. comprobar la copia: el fichero guardado y la contraseña (tecleada o pegada)
  $("wlComprobar").addEventListener("click", async () => {
    const f = $("wlFich").files && $("wlFich").files[0];
    const pw = $("wlPass3").value;
    if (!f) { msg("wlRes", "Choose the file first.", "mal"); return; }
    if (!pw) { msg("wlRes", "Type or paste the password.", "mal"); return; }
    $("wlComprobar").disabled = true;
    try {
      const texto = await f.text();
      let j;
      try { j = JSON.parse(texto); } catch (e) { throw new Error("that file isn't a wallet file (not JSON)"); }
      if (!j || !(j.crypto || j.Crypto)) throw new Error("that file isn't an encrypted wallet file");
      msg("wlRes", "Opening… (a few seconds)");
      const w = await E.Wallet.fromEncryptedJson(texto, pw, (p) => msg("wlRes", "Opening… " + Math.round(p * 100) + " %"));
      $("wlPass3").value = "";
      if (direccionCreada && w.address !== direccionCreada) {
        msg("wlRes", "This file opens, but to a DIFFERENT wallet, not the one you just created. You saved another file.", "mal");
        $("wlListo").hidden = true;
        return;
      }
      if (direccionCreada && !ASCII.test(pw)) {
        msg("wlRes", "The file opens here, but its password has characters MetaMask can't handle. Start again with a plain password.", "mal");
        return;
      }
      comprobado = true;
      msg("wlRes", "Your backup works: this file and the password on your paper open this wallet.", "ok");
      $("wlDir").textContent = w.address;
      $("wlListo").hidden = false;
      $("wlS5").hidden = false;
    } catch (e) {
      const m = String(e && e.message || e);
      msg("wlRes", /password/i.test(m) ? "Wrong password for this file. Press Show and compare it with your paper: exactly one space between words, no space at the start or the end." : "It didn't open: " + m, "mal");
    } finally {
      $("wlComprobar").disabled = false;
    }
  });
  $("wlCopiar").addEventListener("click", async () => {
    const d = $("wlDir").textContent;
    try { await navigator.clipboard.writeText(d); $("wlCopiar").textContent = "Copied"; }
    catch (e) { $("wlCopiar").textContent = "Select it by hand"; }
    setTimeout(() => { $("wlCopiar").textContent = "Copy"; }, 1800);
  });

  // ---- no cerrar la pestaña con la wallet creada sin bajar ni comprobar la copia
  window.addEventListener("beforeunload", (e) => {
    if (fichero && (!bajado || !comprobado)) { e.preventDefault(); e.returnValue = ""; }
  });

  pintar();
})();
