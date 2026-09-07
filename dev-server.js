/* Minimal static server for local checking. Vercel serves these files
 * directly in production, so this exists only so a browser can load the page
 * with real module semantics — file:// blocks ES module imports. */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2] || 4321);
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("no"); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const alt = file + ".html";
    if (fs.existsSync(alt)) file = alt;
    else { res.writeHead(404, { "content-type": "text/plain" }).end("404 " + url); return; }
  }
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log("cusp-launch on http://localhost:" + PORT));
