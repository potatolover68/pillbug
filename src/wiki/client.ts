import { set } from "m3api/browser.js";
import {
  login as m3Login,
  logout as m3Logout,
  LoginError,
} from "m3api-botpassword";
import { getJson, path, RestApiClientError } from "m3api-rest";
import { PillbugSession } from "./m3Session";
import { WikiTitle, type SiteInfoQueryResponse } from "./title";

type WikiHttpContext = {
  origin: string;
  userAgent: string;
};

export type WikiUserInfo = {
  id?: number;
  name?: string;
  anon?: boolean;
  temp?: boolean;
};

type RestPage = {
  id: number;
  key: string;
  title: string;
  latest: { id: number; timestamp: string };
  content_model: string;
  license: { url: string; title: string };
  source: string;
};

export type EditResult = {
  result: string;
  pageid?: number;
  title?: string;
  contentmodel?: string;
  oldrevid?: number;
  newrevid?: number;
  newtimestamp?: string;
  nochange?: boolean;
};

export type WikiPage = {
  titleObj: WikiTitle;
  content: string;
  prefixed: string;
};

/**
 * Convenience layer over m3api for pillbug: login, siteinfo, page read/save.
 * Transport/retries/tokens come from m3api; named-account policy stays in session.ts.
 */
export class WikiClient {
  private session: PillbugSession;
  private getContext: () => WikiHttpContext;

  constructor(getContext: () => WikiHttpContext) {
    this.getContext = getContext;
    const ctx = getContext();
    this.session = new PillbugSession(ctx.origin, ctx.userAgent);
  }

  /** Clear cached tokens (e.g. on logout / session clear). */
  clearTokens(): void {
    this.session.tokens.clear();
  }

  /** Drop login assert params so anonymous requests work after origin switch. */
  clearAuthAssert(): void {
    delete this.session.defaultParams.assert;
    delete this.session.defaultParams.assertuser;
  }

  private syncContext(): PillbugSession {
    const ctx = this.getContext();
    this.session.setWikiOrigin(ctx.origin);
    this.session.defaultOptions.userAgent = ctx.userAgent;
    return this.session;
  }

  async login(username: string, password: string): Promise<void> {
    const session = this.syncContext();
    try {
      await m3Login(session, username, password);
    } catch (error) {
      if (error instanceof LoginError) {
        if (
          error.result === "AlreadyLoggedIn" ||
          /already logged in/i.test(String(error.result))
        ) {
          return;
        }
        throw new Error(error.message);
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    const session = this.syncContext();
    try {
      await m3Logout(session);
    } finally {
      this.clearTokens();
    }
  }

  async userinfo(): Promise<WikiUserInfo> {
    const session = this.syncContext();
    const data = (await session.request(
      {
        action: "query",
        meta: set("userinfo"),
        uiprop: set("blockinfo"),
      },
      { method: "GET" },
    )) as { query?: { userinfo?: WikiUserInfo } };
    const info = data.query?.userinfo;
    if (!info) {
      throw new Error("userinfo missing from response");
    }
    return info;
  }

  async getSiteInfo(): Promise<SiteInfoQueryResponse> {
    const session = this.syncContext();
    const data = (await session.request(
      {
        action: "query",
        meta: set("siteinfo"),
        siprop: set("general", "namespaces", "namespacealiases"),
      },
      { method: "GET" },
    )) as SiteInfoQueryResponse;
    WikiTitle.processNamespaceData(data);
    return data;
  }

  async getTokensAndSiteInfo(): Promise<void> {
    await this.getSiteInfo();
    // CSRF is fetched on demand via m3api tokenType; warm the cache.
    await this.syncContext().getToken("csrf");
  }

  /** Read page wikitext via REST: GET /w/rest.php/v1/page/{title} */
  async readPage(title: string): Promise<RestPage> {
    const session = this.syncContext();
    try {
      return (await getJson(
        session,
        path`/v1/page/${title}`,
      )) as RestPage;
    } catch (error) {
      if (error instanceof RestApiClientError && error.status === 404) {
        throw new Error("Page does not exist");
      }
      throw error;
    }
  }

  /**
   * Resolve a title and fetch its wikitext in one step.
   * Requires siteinfo (login / restore) so WikiTitle maps are loaded.
   */
  async getPage(title: string): Promise<WikiPage> {
    const titleObj = new WikiTitle(title);
    const prefixed = titleObj.getPrefixedText();
    const page = await this.readPage(prefixed);
    if (typeof page.source !== "string") {
      throw new Error("Page has no readable content");
    }
    return { titleObj, content: page.source, prefixed };
  }

  async save(
    title: string,
    text: string,
    summary = "",
    minor = false,
  ): Promise<EditResult> {
    const session = this.syncContext();
    const data = (await session.request(
      {
        action: "edit",
        title,
        text,
        summary,
        bot: true,
        ...(minor ? { minor: true } : { notminor: true }),
      },
      { method: "POST", tokenType: "csrf" },
    )) as { edit?: EditResult };
    const edit = data.edit;
    if (!edit) {
      throw new Error("Edit returned no result");
    }
    return edit;
  }

  /** Expose synced m3api session for list queries. */
  actionSession(): PillbugSession {
    return this.syncContext();
  }
}
