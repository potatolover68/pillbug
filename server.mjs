/**
 * Production server for Toolforge: static SPA + MediaWiki CORS proxy + OAuth.
 */
import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "serve-handler";
import {
  allowedWikiOrigin,
  assertProxyAccess,
  WIKI_ORIGIN_HEADER,
} from "./wiki-proxy-guard.mjs";
import { getOAuthAccessToken, handleOAuthHttp } from "./oauth-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");
const PORT = Number(process.env.PORT) || 8000;

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
  "accept-encoding",
  "content-encoding",
  "content-length",
]);

function isWikiProxyPath(pathname) {
  return (
    pathname === "/w/api.php" ||
    pathname === "/w/rest.php" ||
    pathname.startsWith("/w/rest.php/")
  );
}

function isPublicAiProxyPath(pathname) {
  return pathname === "/publicai" || pathname.startsWith("/publicai/");
}

const PUBLICAI_UPSTREAM = "https://api.publicai.co/v1";

function rewriteSetCookie(header, secure) {
  let out = header.replace(/;\s*Domain=[^;]*/gi, "");
  if (!secure) {
    out = out.replace(/;\s*Secure/gi, "");
  }
  return out.replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
}

function reject(res, status, message) {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(message);
}

async function proxyWiki(req, res) {
  const incoming = new URL(req.url || "/", `http://${req.headers.host}`);
  const wikiOrigin = allowedWikiOrigin(req.headers[WIKI_ORIGIN_HEADER]);
  if (!wikiOrigin) {
    reject(
      res,
      403,
      "Wiki origin not allowed (use https://*.wikipedia.org, *.wikimedia.org, or *.wiktionary.org)",
    );
    return;
  }

  /** @type {Buffer | undefined} */
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  const bearer = await getOAuthAccessToken(req);
  const gate = await assertProxyAccess(req, wikiOrigin, body, bearer);
  if (!gate.ok) {
    reject(res, gate.status, gate.message);
    return;
  }

  const target = new URL(`${incoming.pathname}${incoming.search}`, wikiOrigin);

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
  headers.set("accept-encoding", "identity");
  if (bearer) {
    headers.set("authorization", `Bearer ${bearer}`);
  }

  /** @type {RequestInit} */
  const init = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (body) {
    init.body = body;
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    reject(
      res,
      502,
      `Wiki proxy error: ${err instanceof Error ? err.message : err}`,
    );
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

/**
 * Same-origin proxy for Public AI Inference Utility.
 * /publicai/<rest> → https://api.publicai.co/v1/<rest>
 * Client must supply Authorization + User-Agent (not injected here).
 */
async function proxyPublicAi(req, res) {
  const incoming = new URL(req.url || "/", `http://${req.headers.host}`);
  const rest = incoming.pathname.replace(/^\/publicai\/?/, "");
  if (!rest || rest.includes("..")) {
    reject(res, 400, "Invalid Public AI proxy path");
    return;
  }

  const auth = req.headers.authorization;
  if (typeof auth !== "string" || !auth.toLowerCase().startsWith("bearer ")) {
    reject(res, 401, "Authorization: Bearer <api-key> is required");
    return;
  }

  /** @type {Buffer | undefined} */
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  const target = new URL(`${rest}${incoming.search}`, `${PUBLICAI_UPSTREAM}/`);

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
  headers.set("host", new URL(PUBLICAI_UPSTREAM).host);
  headers.set("accept-encoding", "identity");
  // Public AI asks for a User-Agent; browsers always send one to us, but ensure upstream has a value.
  if (!headers.get("user-agent")?.trim()) {
    headers.set("user-agent", "pillbug-ai/1.0");
  }

  /** @type {RequestInit} */
  const init = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (body) init.body = body;

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    reject(
      res,
      502,
      `Public AI proxy error: ${err instanceof Error ? err.message : err}`,
    );
    return;
  }

  res.statusCode = upstream.status;
  for (const [key, value] of upstream.headers.entries()) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    res.setHeader(key, value);
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  res.setHeader("content-length", String(buf.length));
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  try {
    if (await handleOAuthHttp(req, res)) return;
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(`Server error: ${err instanceof Error ? err.message : err}`);
    return;
  }

  const pathname = new URL(req.url || "/", `http://${req.headers.host}`)
    .pathname;

  if (pathname === "/healthz") {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end("ok");
    return;
  }

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

  if (isPublicAiProxyPath(pathname)) {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, User-Agent",
      );
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.end();
      return;
    }
    await proxyPublicAi(req, res);
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
  console.log(
    `[pillbug] listening on :${PORT} (static + /w/* + /publicai/* + oauth)`,
  );
});
