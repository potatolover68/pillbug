/* eslint-disable */
// @ts-nocheck — loads shared ESM guard used by server.mjs
import type { Plugin, ProxyOptions } from "vite";
import type { IncomingMessage, ClientRequest } from "node:http";
import {
  allowedWikiOrigin,
  assertProxyAccess,
  isLoginHandshake,
  WIKI_ORIGIN_HEADER,
} from "../../wiki-proxy-guard.mjs";
import { DEFAULT_WIKI_ORIGIN } from "./defaults.js";

function originFromRequest(req: IncomingMessage): string | null {
  const raw = req.headers[WIKI_ORIGIN_HEADER];
  return allowedWikiOrigin(typeof raw === "string" ? raw : undefined);
}

/** Wikipedia Set-Cookie Domain/Secure break on http://localhost. */
function rewriteSetCookieForLocalhost(header: string): string {
  return header
    .replace(/;\s*Domain=[^;]*/gi, "")
    .replace(/;\s*Secure/gi, "")
    .replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
}

function rewriteProxySetCookieHeaders(proxyRes: IncomingMessage): void {
  const raw = proxyRes.headers["set-cookie"];
  if (!raw) return;
  const list = Array.isArray(raw) ? raw : [raw];
  proxyRes.headers["set-cookie"] = list.map(rewriteSetCookieForLocalhost);
}

function mediawikiProxy(pathPrefix: string, rewriteTo: string): ProxyOptions {
  const escaped = pathPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const options: ProxyOptions & {
    router?: (req: IncomingMessage) => string;
  } = {
    target: DEFAULT_WIKI_ORIGIN,
    changeOrigin: true,
    secure: true,
    cookieDomainRewrite: "",
    rewrite: (path) => path.replace(new RegExp(`^${escaped}`), rewriteTo),
    router(req: IncomingMessage) {
      return originFromRequest(req) ?? DEFAULT_WIKI_ORIGIN;
    },
    configure(proxy) {
      proxy.on("proxyReq", (proxyReq: ClientRequest, req: IncomingMessage) => {
        const origin = originFromRequest(req);
        proxyReq.removeHeader(WIKI_ORIGIN_HEADER);
        proxyReq.removeHeader("accept-encoding");
        if (origin) {
          try {
            proxyReq.setHeader("host", new URL(origin).host);
          } catch {
            // keep existing host
          }
        }
      });
      proxy.on("proxyRes", (proxyRes: IncomingMessage) => {
        rewriteProxySetCookieHeaders(proxyRes);
      });
    },
  };
  return options;
}

export function mediawikiApiProxy(): ProxyOptions {
  return mediawikiProxy("/w/api.php", "/w/api.php");
}

export function mediawikiRestProxy(): ProxyOptions {
  return mediawikiProxy("/w/rest.php", "/w/rest.php");
}

export function mediawikiProxyPlugin(): Plugin {
  return {
    name: "pillbug-mw-api-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (
          !(url.startsWith("/w/api.php") || url.startsWith("/w/rest.php"))
        ) {
          next();
          return;
        }

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

        const origin = originFromRequest(req as IncomingMessage);
        if (!origin) {
          res.statusCode = 403;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end(
            "Wiki origin not allowed (use https://*.wikipedia.org, *.wikimedia.org, or *.wiktionary.org)",
          );
          return;
        }

        // Avoid consuming POST bodies in Vite (proxy still needs them).
        // Login POSTs are allowed through; other unauthenticated traffic is blocked
        // once we can see cookies / handshake GETs.
        const incoming = req as IncomingMessage;
        if (
          !isLoginHandshake(incoming, undefined) &&
          (incoming.headers.cookie ||
            incoming.method === "GET" ||
            incoming.method === "HEAD" ||
            url.startsWith("/w/rest.php"))
        ) {
          const gate = await assertProxyAccess(incoming, origin, undefined);
          if (!gate.ok) {
            res.statusCode = gate.status;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end(gate.message);
            return;
          }
        }

        next();
      });
    },
  };
}
