import { computed, ref } from "vue";
import { openPillbugDB, type WikiConfigRecord } from "../db/open";
import {
  WikiClient,
  type EditResult,
  type WikiPage,
  type WikiUserInfo,
} from "./client";
import { DEFAULT_USER_AGENT } from "../meta";
import { DEFAULT_WIKI_ORIGIN } from "./defaults";
import { listFromSource, namespaceOptions, type QueueSource } from "./lists";

export type PrefetchMode = "A" | "B";

export const wikiOrigin = ref(DEFAULT_WIKI_ORIGIN);
export const username = ref("");
/** Memory-only; never written to IndexedDB. Cleared after each login attempt. */
export const password = ref("");

/** A = fetch+skip ahead; B = fetch+skip+process ahead. */
export const prefetchMode = ref<PrefetchMode>("A");

export const loggedIn = ref(false);
export const loginError = ref<string | null>(null);
export const loginBusy = ref(false);
export const loggedInAs = ref<string | null>(null);

/**
 * Bumped after each successful siteinfo load so UI (namespace list) re-reads
 * WikiTitle static maps.
 */
export const namespaceEpoch = ref(0);

/** Origin the current MediaWiki session cookies belong to (null if logged out). */
const sessionOrigin = ref<string | null>(null);

/** Single always-on client; session state lives in the refs above. */
const client = new WikiClient(() => ({
  origin: normalizedWikiOrigin(),
  userAgent: DEFAULT_USER_AGENT,
}));

export const canLogin = computed(
  () =>
    !loginBusy.value &&
    !loggedIn.value &&
    wikiOrigin.value.trim().length > 0 &&
    username.value.trim().length > 0 &&
    password.value.length > 0,
);

function normalizedWikiOrigin(): string {
  try {
    return new URL(wikiOrigin.value.trim() || DEFAULT_WIKI_ORIGIN).origin;
  } catch {
    return DEFAULT_WIKI_ORIGIN;
  }
}

function parseOrigin(raw: string): string {
  return new URL(raw.trim() || DEFAULT_WIKI_ORIGIN).origin;
}

/**
 * Apply a wiki origin from the Set button (not on every keystroke).
 * Clears the session when switching away from the logged-in wiki.
 */
export function applyWikiOrigin(raw: string): void {
  let next: string;
  try {
    next = parseOrigin(raw);
  } catch {
    loginError.value = "Invalid wiki origin URL";
    return;
  }

  const prevSession = sessionOrigin.value;
  wikiOrigin.value = next;

  if (prevSession && prevSession !== next) {
    clearSession();
    loginError.value = "Wiki origin changed — log in again";
  } else {
    loginError.value = null;
  }

  void persistWikiConfig();
}

function isAlreadyLoggedInError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already logged in/i.test(message);
}

function assertNamedAccount(
  info: WikiUserInfo | null | undefined,
  expectedBotUser?: string,
): string {
  if (!info || info.id === 0 || info.anon === true) {
    throw new Error("No active wiki session (anonymous)");
  }
  if (info.temp === true) {
    throw new Error(
      "Session is a temporary (logged-out) account — log in again",
    );
  }
  const name =
    typeof info.name === "string" && info.name && info.name !== "0"
      ? info.name
      : "";
  if (!name) {
    throw new Error("No active wiki session");
  }
  if (expectedBotUser) {
    const expectedBase = expectedBotUser.split("@")[0]!.toLowerCase();
    if (name.toLowerCase() !== expectedBase) {
      throw new Error(
        `Logged in as “${name}”, expected “${expectedBase}” — logout and re-login`,
      );
    }
  }
  return name;
}

async function attachSession(expectedBotUser?: string): Promise<void> {
  await client.getTokensAndSiteInfo();
  namespaceEpoch.value += 1;
  const info = await client.userinfo();
  const name = assertNamedAccount(
    info,
    expectedBotUser || username.value.trim() || undefined,
  );
  loggedIn.value = true;
  loggedInAs.value = name;
  sessionOrigin.value = normalizedWikiOrigin();
}

function clearSession(): void {
  client.clearTokens();
  client.clearAuthAssert();
  void import("./prefetch").then((m) => m.clearPrefetch());
  loggedIn.value = false;
  loggedInAs.value = null;
  sessionOrigin.value = null;
  password.value = "";
}

function requireLoggedIn(): void {
  if (!loggedIn.value) {
    throw new Error("Not logged in");
  }
}

/** Re-check named (non-temp) session before editing. */
async function assertEditableSession(): Promise<void> {
  requireLoggedIn();
  if (sessionOrigin.value && sessionOrigin.value !== normalizedWikiOrigin()) {
    clearSession();
    throw new Error("Wiki origin changed — log in again");
  }
  const info = await client.userinfo();
  const name = assertNamedAccount(info, username.value.trim() || undefined);
  loggedInAs.value = name;
  loggedIn.value = true;
}

/** Resolve title + fetch wikitext (requires an attached session / siteinfo). */
export async function getPage(title: string): Promise<WikiPage> {
  requireLoggedIn();
  return client.getPage(title);
}

/** Save wikitext after verifying a named session. */
export async function savePage(
  title: string,
  text: string,
  summary = "",
  minor = false,
): Promise<EditResult> {
  await assertEditableSession();
  const result = await client.save(title, text, summary, minor);
  if (!result || result.result !== "Success") {
    throw new Error(
      result
        ? `Edit failed: ${JSON.stringify(result)}`
        : "Edit returned no result",
    );
  }
  return result;
}

/** Generate titles from an AWB-style list source (requires login/siteinfo). */
export async function generateQueueTitles(
  source: QueueSource,
  namespaces: number[],
): Promise<string[]> {
  requireLoggedIn();
  return listFromSource(client.actionSession(), source, namespaces);
}

export function listNamespaceOptions(): Array<{ id: number; label: string }> {
  void namespaceEpoch.value;
  try {
    return namespaceOptions();
  } catch {
    return [{ id: 0, label: "(main)" }];
  }
}

export async function loadWikiConfig(): Promise<void> {
  const db = await openPillbugDB();
  const record = await db.get("wikiConfig", "default");
  if (!record) return;
  wikiOrigin.value = record.wikiOrigin || DEFAULT_WIKI_ORIGIN;
  username.value = record.username;
  prefetchMode.value = record.prefetchMode === "B" ? "B" : "A";
}

/** Resume an existing MediaWiki session cookie (survives page reload). */
export async function restoreSession(): Promise<void> {
  loginError.value = null;
  try {
    await attachSession(username.value.trim() || undefined);
  } catch {
    clearSession();
  }
}

export async function persistWikiConfig(): Promise<void> {
  const db = await openPillbugDB();
  const record: WikiConfigRecord = {
    id: "default",
    wikiOrigin: normalizedWikiOrigin(),
    username: username.value.trim(),
    userAgent: DEFAULT_USER_AGENT,
    prefetchMode: prefetchMode.value,
  };
  wikiOrigin.value = record.wikiOrigin;
  await db.put("wikiConfig", record);
}

export async function login(): Promise<void> {
  if (!canLogin.value) return;

  loginBusy.value = true;
  loginError.value = null;

  const user = username.value.trim();
  const pass = password.value;

  try {
    await persistWikiConfig();
    try {
      await client.login(user, pass);
      await attachSession(user);
    } catch (error) {
      if (isAlreadyLoggedInError(error)) {
        await attachSession(user);
      } else {
        throw error;
      }
    }
  } catch (error) {
    clearSession();
    loginError.value = error instanceof Error ? error.message : String(error);
  } finally {
    password.value = "";
    loginBusy.value = false;
  }
}

export async function logout(): Promise<void> {
  loginError.value = null;
  try {
    await client.logout();
  } catch {
    // Still clear local session if logout request fails.
  } finally {
    clearSession();
  }
}
