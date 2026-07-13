/**
 * Production server for Toolforge: static SPA + MediaWiki CORS proxy.
 * Proxies /w/api.php and /w/rest.php/* using X-Pillbug-Wiki-Origin.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "serve-handler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");
const PORT = Number(process.env.PORT) || 8000;
const DEFAULT_WIKI_ORIGIN = "https://en.wikipedia.org";
const WIKI_ORIGIN_HEADER = "x-pillbug-wiki-origin";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  WIKI_ORIGIN_HEADER,
  // Node fetch decompresses; never advertise/pass encoding through.
  "accept-encoding",
  "content-encoding",
  "content-length",
]);

function normalizeOrigin(raw) {
  if (!raw) return DEFAULT_WIKI_ORIGIN;
  try {
    return new URL(String(raw).trim()).origin;
  } catch {
    return DEFAULT_WIKI_ORIGIN;
  }
}

function isWikiProxyPath(pathname) {
  return (
    pathname === "/w/api.php" ||
    pathname === "/w/rest.php" ||
    pathname.startsWith("/w/rest.php/")
  );
}

function rewriteSetCookie(header, secure) {
  let out = header.replace(/;\s*Domain=[^;]*/gi, "");
  if (!secure) {
    out = out.replace(/;\s*Secure/gi, "");
  }
  return out.replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
}

async function proxyWiki(req, res) {
  const incoming = new URL(req.url || "/", `http://${req.headers.host}`);
  const wikiOrigin = normalizeOrigin(req.headers[WIKI_ORIGIN_HEADER]);
  const target = new URL(
    `${incoming.pathname}${incoming.search}`,
    wikiOrigin,
  );

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  headers.set("host", new URL(wikiOrigin).host);
  // Ask for plain bytes so we don't fight Node fetch's auto-decompress.
  headers.set("accept-encoding", "identity");

  /** @type {RequestInit} */
  const init = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    init.body = Buffer.concat(chunks);
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(`Wiki proxy error: ${err instanceof Error ? err.message : err}`);
    return;
  }

  res.statusCode = upstream.status;
  const secure = req.headers["x-forwarded-proto"] === "https";
  for (const [key, value] of upstream.headers.entries()) {
    if (key.toLowerCase() === "set-cookie") continue;
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    res.setHeader(key, value);
  }

  const getSetCookie =
    typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : [];
  for (const cookie of getSetCookie) {
    res.appendHeader("set-cookie", rewriteSetCookie(cookie, secure));
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  res.setHeader("content-length", String(buf.length));
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url || "/", `http://${req.headers.host}`)
    .pathname;

  if (isWikiProxyPath(pathname)) {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Headers",
        `Content-Type, ${WIKI_ORIGIN_HEADER}, Authorization, Api-User-Agent`,
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.end();
      return;
    }
    await proxyWiki(req, res);
    return;
  }

  await handler(req, res, {
    public: DIST,
    directoryListing: false,
  });
});

if (!fs.existsSync(DIST)) {
  console.warn(
    `[pillbug] Warning: ${DIST} missing — run "npm run build" first`,
  );
}

server.listen(PORT, () => {
  console.log(`[pillbug] listening on :${PORT} (static + /w/* wiki proxy)`);
});
