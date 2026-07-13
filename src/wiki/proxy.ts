import type { Plugin, ProxyOptions } from "vite";
import type { IncomingMessage, ClientRequest } from "node:http";
import { DEFAULT_WIKI_ORIGIN, WIKI_ORIGIN_HEADER } from "./defaults.js";

function normalizeOrigin(raw: string | undefined): string {
  if (!raw) return DEFAULT_WIKI_ORIGIN;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return DEFAULT_WIKI_ORIGIN;
  }
}

function originFromRequest(req: IncomingMessage): string {
  const raw = req.headers[WIKI_ORIGIN_HEADER];
  return normalizeOrigin(typeof raw === "string" ? raw : undefined);
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
      return originFromRequest(req);
    },
    configure(proxy) {
      proxy.on("proxyReq", (proxyReq: ClientRequest, req: IncomingMessage) => {
        const origin = originFromRequest(req);
        proxyReq.removeHeader(WIKI_ORIGIN_HEADER);
        proxyReq.removeHeader("accept-encoding");
        try {
          proxyReq.setHeader("host", new URL(origin).host);
        } catch {
          // keep existing host
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
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (
          (url.startsWith("/w/api.php") || url.startsWith("/w/rest.php")) &&
          req.method === "OPTIONS"
        ) {
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
        next();
      });
    },
  };
}
