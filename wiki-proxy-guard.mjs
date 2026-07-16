/**
 * Shared wiki proxy guards for production (`server.mjs`) and Vite.
 * Allowed targets: *.wikipedia.org, *.wikimedia.org, *.wiktionary.org
 * All traffic requires a logged-in MediaWiki session (except the login handshake).
 * en.wikipedia.org additionally requires AWB CheckPageJSON approval.
 */

export const WIKI_ORIGIN_HEADER = "x-pillbug-wiki-origin";

const ALLOWED_SUFFIXES = [
  ".wikipedia.org",
  ".wikimedia.org",
  ".wiktionary.org",
];

const CHECKPAGE_URL =
  "https://en.wikipedia.org/w/index.php?title=Wikipedia:AutoWikiBrowser/CheckPageJSON&action=raw";
const CHECKPAGE_TTL_MS = 24 * 60 * 60 * 1000;
const USERINFO_TTL_MS = 5 * 60 * 1000;
const PROXY_UA =
  "pillbug/0.1.0 (https://github.com/potatolover68/pillbug; wiki proxy)";

/** @type {{ fetchedAt: number, users: Set<string>, bots: Set<string> } | null} */
let checkPageCache = null;

/** @type {Map<string, { name: string | null, expires: number }>} */
const userinfoCache = new Map();

/**
 * @param {string | undefined | null} raw
 * @returns {string | null} normalized https origin, or null if invalid/disallowed
 */
export function allowedWikiOrigin(raw) {
  if (!raw) return null;
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "wikipedia.org" ||
      host === "wikimedia.org" ||
      host === "wiktionary.org"
    ) {
      return url.origin;
    }
    if (ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      return url.origin;
    }
    return null;
  } catch {
    return null;
  }
}

export function isEnWikipedia(origin) {
  try {
    return new URL(origin).hostname.toLowerCase() === "en.wikipedia.org";
  } catch {
    return false;
  }
}

function normalizeUser(name) {
  return String(name).replace(/_/g, " ").trim();
}

/** BotPassword form `User@BotName` → base account for enabledusers. */
export function baseAccountName(name) {
  const n = normalizeUser(name);
  const at = n.indexOf("@");
  return at === -1 ? n : n.slice(0, at);
}

/**
 * @returns {Promise<{ users: Set<string>, bots: Set<string> }>}
 */
export async function getCheckPageLists() {
  const now = Date.now();
  if (
    checkPageCache &&
    now - checkPageCache.fetchedAt < CHECKPAGE_TTL_MS &&
    checkPageCache.users.size > 0
  ) {
    return checkPageCache;
  }

  const res = await fetch(CHECKPAGE_URL, {
    headers: {
      "user-agent": PROXY_UA,
      accept: "application/json,text/plain,*/*",
      "accept-encoding": "identity",
    },
  });
  if (!res.ok) {
    throw new Error(`CheckPageJSON fetch failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  const users = new Set(
    (Array.isArray(json.enabledusers) ? json.enabledusers : []).map(
      normalizeUser,
    ),
  );
  const bots = new Set(
    (Array.isArray(json.enabledbots) ? json.enabledbots : []).map(
      normalizeUser,
    ),
  );
  checkPageCache = { fetchedAt: now, users, bots };
  return checkPageCache;
}

/**
 * @param {string} name
 * @param {{ users: Set<string>, bots: Set<string> }} lists
 */
export function isCheckPageAllowed(name, lists) {
  if (!name) return false;
  const full = normalizeUser(name);
  const base = baseAccountName(name);
  return (
    lists.users.has(base) ||
    lists.users.has(full) ||
    lists.bots.has(base) ||
    lists.bots.has(full)
  );
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {string} wikiOrigin
 * @returns {Promise<string | null>}
 */
export async function resolveWikiUsername(req, wikiOrigin) {
  const cookie = req.headers.cookie;
  if (!cookie || typeof cookie !== "string") return null;

  const cacheKey = `${wikiOrigin}\n${cookie}`;
  const cached = userinfoCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expires > now) return cached.name;

  try {
    const url = new URL("/w/api.php", wikiOrigin);
    url.searchParams.set("action", "query");
    url.searchParams.set("meta", "userinfo");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");

    const res = await fetch(url, {
      headers: {
        cookie,
        "user-agent": PROXY_UA,
        "accept-encoding": "identity",
      },
    });
    if (!res.ok) {
      userinfoCache.set(cacheKey, { name: null, expires: now + 30_000 });
      return null;
    }
    const data = await res.json();
    const info = data?.query?.userinfo;
    const name =
      info && !info.anon && typeof info.name === "string" ? info.name : null;
    userinfoCache.set(cacheKey, {
      name,
      expires: now + USERINFO_TTL_MS,
    });
    return name;
  } catch {
    return null;
  }
}

/**
 * @param {Buffer | undefined} body
 * @returns {string | null}
 */
export function lgnameFromBody(body) {
  if (!body || body.length === 0) return null;
  try {
    const text = body.toString("utf8");
    const params = new URLSearchParams(text);
    const lgname = params.get("lgname");
    if (lgname) return lgname;
    if (text.trimStart().startsWith("{")) {
      const json = JSON.parse(text);
      if (typeof json.lgname === "string") return json.lgname;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Requests needed before cookies exist (login token fetch / login POST).
 * @param {import('node:http').IncomingMessage} req
 * @param {Buffer | undefined} body
 */
export function isLoginHandshake(req, body) {
  if (lgnameFromBody(body)) return true;

  if (req.method !== "GET" && req.method !== "HEAD") return false;

  try {
    const url = new URL(req.url || "/", "http://pillbug.local");
    if (!url.pathname.startsWith("/w/api.php")) return false;
    const action = url.searchParams.get("action") || "";
    const meta = url.searchParams.get("meta") || "";
    const type = url.searchParams.get("type") || "";
    if (action === "query" && meta.includes("tokens")) {
      return type.includes("login") || type === "" || type.includes("csrf");
    }
    if (action === "query" && meta.includes("authmanagerinfo")) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Require a logged-in wiki session, except during the login handshake.
 * @returns {Promise<{ ok: true, name: string | null } | { ok: false, status: number, message: string }>}
 */
export async function assertLoggedIn(req, wikiOrigin, body) {
  if (isLoginHandshake(req, body)) {
    return { ok: true, name: lgnameFromBody(body) };
  }

  const name = await resolveWikiUsername(req, wikiOrigin);
  if (!name) {
    return {
      ok: false,
      status: 401,
      message: "Wiki proxy requires a logged-in MediaWiki session",
    };
  }
  return { ok: true, name };
}

/**
 * Enforce en.wikipedia.org CheckPage approval for a known account name.
 * @param {string} name
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string }>}
 */
export async function assertEnwikiCheckPage(name) {
  let lists;
  try {
    lists = await getCheckPageLists();
  } catch (err) {
    return {
      ok: false,
      status: 503,
      message: `CheckPage unavailable: ${err instanceof Error ? err.message : err}`,
    };
  }

  if (!isCheckPageAllowed(name, lists)) {
    return {
      ok: false,
      status: 403,
      message: `Not approved for en.wikipedia.org (CheckPageJSON): ${baseAccountName(name)}`,
    };
  }
  return { ok: true };
}

/**
 * Full proxy access check: login required, plus CheckPage on enwiki.
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string }>}
 */
export async function assertProxyAccess(req, wikiOrigin, body) {
  const auth = await assertLoggedIn(req, wikiOrigin, body);
  if (!auth.ok) return auth;

  if (isEnWikipedia(wikiOrigin)) {
    // Handshake GETs have no name yet; CheckPage applies once we know the account.
    if (!auth.name) return { ok: true };
    return assertEnwikiCheckPage(auth.name);
  }

  return { ok: true };
}
