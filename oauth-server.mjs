/**
 * MediaWiki OAuth 2.0 helpers for pillbug (server + Vite).
 * Secrets stay on the server; only an opaque session id is cookied.
 */
import { randomUUID } from "node:crypto";
import Session from "m3api/node.js";
import {
  OAuthClient,
  completeOAuthSession,
  initOAuthSession,
  isCompleteOAuthSession,
  serializeOAuthSession,
  deserializeOAuthSession,
} from "m3api-oauth2";
import { createClient } from "redis";

export const OAUTH_COOKIE = "pillbug_sid";

const PROXY_UA = "pillbug/0.1.0 (https://github.com/potatolover68/pillbug)";

const DEFAULT_CALLBACK = "https://pillbug.toolforge.org/callback";
const DEFAULT_MW_ORIGIN = "https://meta.wikimedia.org";
const PENDING_TTL_SEC = 60 * 60;
const COMPLETE_TTL_SEC = 60 * 60 * 24 * 30;

/** @type {Map<string, { value: string, expires: number }>} */
const memoryStore = new Map();

/** @type {import('redis').RedisClientType | null} */
let redisClient = null;
let redisInit = null;

export function oauthEnabled() {
  return Boolean(
    process.env.OAUTH_CONSUMER?.trim() && process.env.OAUTH_SECRET?.trim(),
  );
}

export function oauthCallbackUrl() {
  return process.env.OAUTH_CALLBACK?.trim() || DEFAULT_CALLBACK;
}

export function oauthMwOrigin() {
  try {
    return new URL(process.env.OAUTH_MW_ORIGIN?.trim() || DEFAULT_MW_ORIGIN)
      .origin;
  } catch {
    return DEFAULT_MW_ORIGIN;
  }
}

export function authConfigPayload() {
  return { oauth: oauthEnabled() };
}

async function getRedis() {
  const uri = process.env.TOOL_REDIS_URI?.trim();
  if (!uri) return null;
  if (redisClient?.isOpen) return redisClient;
  if (!redisInit) {
    redisInit = (async () => {
      const client = createClient({ url: uri });
      client.on("error", (err) => {
        console.warn("[pillbug] redis error:", err.message);
      });
      await client.connect();
      redisClient = client;
      return client;
    })();
  }
  try {
    return await redisInit;
  } catch (err) {
    console.warn(
      "[pillbug] redis unavailable, using memory store:",
      err instanceof Error ? err.message : err,
    );
    redisInit = null;
    return null;
  }
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function sessionStoreGet(id) {
  if (!id) return null;
  const redis = await getRedis();
  if (redis) {
    const raw = await redis.get(`pillbug:oauth:${id}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const row = memoryStore.get(id);
  if (!row) return null;
  if (row.expires < Date.now()) {
    memoryStore.delete(id);
    return null;
  }
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

/**
 * @param {string} id
 * @param {object} serialization
 * @param {number} ttlSec
 */
export async function sessionStoreSet(id, serialization, ttlSec) {
  const value = JSON.stringify(serialization);
  const redis = await getRedis();
  if (redis) {
    await redis.set(`pillbug:oauth:${id}`, value, { EX: ttlSec });
    return;
  }
  memoryStore.set(id, {
    value,
    expires: Date.now() + ttlSec * 1000,
  });
}

/** @param {string} id */
export async function sessionStoreDel(id) {
  if (!id) return;
  const redis = await getRedis();
  if (redis) {
    await redis.del(`pillbug:oauth:${id}`);
    return;
  }
  memoryStore.delete(id);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {string | null}
 */
export function readSessionId(req) {
  const raw = req.headers.cookie;
  if (!raw || typeof raw !== "string") return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === OAUTH_COOKIE) {
      return decodeURIComponent(rest.join("=") || "") || null;
    }
  }
  return null;
}

/**
 * @param {boolean} secure
 * @param {string} [sid]
 * @param {number} [maxAgeSec]
 */
export function sessionCookieHeader(secure, sid, maxAgeSec = COMPLETE_TTL_SEC) {
  if (!sid) {
    return `${OAUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
      secure ? "; Secure" : ""
    }`;
  }
  return `${OAUTH_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${
    secure ? "; Secure" : ""
  }`;
}

function makeOAuthSession() {
  const consumer = process.env.OAUTH_CONSUMER.trim();
  const secret = process.env.OAUTH_SECRET.trim();
  const origin = oauthMwOrigin();
  const host = new URL(origin).hostname;
  return new Session(
    host,
    { formatversion: 2 },
    {
      userAgent: PROXY_UA,
      "m3api-oauth2/client": new OAuthClient(consumer, secret),
      "m3api-oauth2/assert": true,
    },
  );
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string | null>}
 */
export async function getOAuthAccessToken(req) {
  const sid = readSessionId(req);
  if (!sid) return null;
  const serialization = await sessionStoreGet(sid);
  if (!serialization?.accessToken) return null;
  return serialization.accessToken;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ secure?: boolean }} [opts]
 * @returns {Promise<boolean>} true if handled
 */
export async function handleOAuthHttp(req, res, opts = {}) {
  const secure =
    opts.secure ??
    (req.headers["x-forwarded-proto"] === "https" ||
      Boolean(process.env.TOOL_TOOLFORGE_API_URL));
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  const { pathname } = url;

  if (pathname === "/api/auth/config" && req.method === "GET") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(authConfigPayload()));
    return true;
  }

  if (!oauthEnabled()) {
    if (
      pathname === "/api/oauth/start" ||
      pathname === "/callback" ||
      pathname === "/api/oauth/logout"
    ) {
      res.statusCode = 503;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(
        "OAuth is not configured (missing OAUTH_CONSUMER / OAUTH_SECRET)",
      );
      return true;
    }
    return false;
  }

  if (pathname === "/api/oauth/start" && req.method === "GET") {
    try {
      const session = makeOAuthSession();
      const existingSid = readSessionId(req);
      if (existingSid) {
        const existing = await sessionStoreGet(existingSid);
        if (existing) {
          deserializeOAuthSession(session, existing);
        }
      }
      const authorizeUrl = await initOAuthSession(session);
      const sid = existingSid || randomUUID();
      await sessionStoreSet(
        sid,
        serializeOAuthSession(session),
        PENDING_TTL_SEC,
      );
      res.statusCode = 302;
      res.setHeader(
        "set-cookie",
        sessionCookieHeader(secure, sid, PENDING_TTL_SEC),
      );
      res.setHeader("location", authorizeUrl);
      res.end();
      return true;
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(
        `OAuth start failed: ${err instanceof Error ? err.message : err}`,
      );
      return true;
    }
  }

  if (pathname === "/callback" && req.method === "GET") {
    try {
      const sid = readSessionId(req);
      if (!sid) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("Missing OAuth session cookie — start login again");
        return true;
      }
      const pending = await sessionStoreGet(sid);
      if (!pending) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("OAuth session expired — start login again");
        return true;
      }
      const session = makeOAuthSession();
      deserializeOAuthSession(session, pending);
      const callbackUrl = oauthCallbackUrl() + url.search;
      await completeOAuthSession(session, callbackUrl);
      if (!isCompleteOAuthSession(session)) {
        throw new Error("OAuth session incomplete after callback");
      }
      await sessionStoreSet(
        sid,
        serializeOAuthSession(session),
        COMPLETE_TTL_SEC,
      );
      res.statusCode = 302;
      res.setHeader(
        "set-cookie",
        sessionCookieHeader(secure, sid, COMPLETE_TTL_SEC),
      );
      res.setHeader("location", "/");
      res.end();
      return true;
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(
        `OAuth callback failed: ${err instanceof Error ? err.message : err}`,
      );
      return true;
    }
  }

  if (pathname === "/api/oauth/logout" && req.method === "POST") {
    const sid = readSessionId(req);
    if (sid) await sessionStoreDel(sid);
    res.statusCode = 204;
    res.setHeader("set-cookie", sessionCookieHeader(secure, undefined));
    res.end();
    return true;
  }

  return false;
}
