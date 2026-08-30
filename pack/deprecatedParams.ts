import { asString, isWikiTitle, normName, templateName } from "./coerce.ts";
import { fetchPageContents, fetchPageContentsAsync } from "./pageContents.ts";
import { WikiTitle } from "../src/wiki/title.ts";
import {
  applyTemplatesToContent,
  findTemplates,
  hitToTemplate,
  indentTemplate,
  removeTemplateParameter,
  renameTemplateParameterKey,
  templateNamesMatch,
  templatesFromContent,
  type Template,
} from "./wikitext.ts";

export type DeprecatedParamsRules = {
  renames: Array<{ from: string; to: string }>;
  remove: string[];
  regexps: Array<{ find: string; replace: string }>;
};

const EMPTY_RULES: DeprecatedParamsRules = {
  renames: [],
  remove: [],
  regexps: [],
};

/** Session cache for sync (nodish) path. */
const rulesCache = new Map<string, DeprecatedParamsRules>();

/** In-memory L1 for async path (TTL-aware). */
type TimedRules = { rules: DeprecatedParamsRules; cachedAt: number };
const asyncMemoryCache = new Map<string, TimedRules>();

/** IndexedDB rules cache TTL. */
export const RULES_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const IDB_NAME = "pillbug-rdp";
const IDB_VERSION = 1;
const IDB_STORE = "deprecated-rules";

const META_PARAMS = new Set(["_category", "preview", "ignoreblank"]);
const REGEXP_KEY = /^_regexp[1-9][0-9]*$/i;
const INVOKE_NAMES = [
  "#invoke:Check for deprecated parameters",
  "#invoke:Module:Check for deprecated parameters",
];

function isDeprecatedInvokeName(name: string): boolean {
  const n = normName(name);
  return INVOKE_NAMES.some((want) => normName(want) === n);
}

function isFresh(cachedAt: number): boolean {
  return Date.now() - cachedAt < RULES_CACHE_TTL_MS;
}

function openRulesDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onerror = () => resolve(null);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
    } catch {
      resolve(null);
    }
  });
}

async function idbGetRules(key: string): Promise<TimedRules | null> {
  const db = await openRulesDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onerror = () => {
        db.close();
        resolve(null);
      };
      req.onsuccess = () => {
        db.close();
        const row = req.result as
          | { key: string; rules: DeprecatedParamsRules; cachedAt: number }
          | undefined;
        if (!row || !row.rules || typeof row.cachedAt !== "number") {
          resolve(null);
          return;
        }
        resolve({ rules: row.rules, cachedAt: row.cachedAt });
      };
    } catch {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve(null);
    }
  });
}

async function idbSetRules(key: string, entry: TimedRules): Promise<void> {
  const db = await openRulesDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.objectStore(IDB_STORE).put({ key, ...entry });
    } catch {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve();
    }
  });
}

async function idbClearRules(): Promise<void> {
  const db = await openRulesDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
      tx.objectStore(IDB_STORE).clear();
    } catch {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      resolve();
    }
  });
}

/** Blank out nowiki/noinclude stuff so invokes inside are ignored. */
export function maskProtectedRegions(text: string): string {
  const re = /<(nowiki|noinclude)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  return text.replace(re, (full) => " ".repeat(full.length));
}

export function luaPatternToJsSource(pattern: string): string {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "%") {
      const next = pattern[i + 1];
      if (next == null) {
        out += "%";
        i += 1;
        continue;
      }
      i += 2;
      switch (next) {
        case "%":
          out += "%";
          break;
        case "d":
          out += "\\d";
          break;
        case "a":
          out += "[A-Za-z]";
          break;
        case "w":
          out += "[A-Za-z0-9_]";
          break;
        case "s":
          out += "\\s";
          break;
        case ".":
        case "(":
        case ")":
        case "+":
        case "*":
        case "-":
        case "?":
        case "[":
        case "]":
        case "^":
        case "$":
          out += "\\" + next;
          break;
        default:
          out += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          break;
      }
      continue;
    }
    if (ch === ".") {
      out += "[\\s\\S]";
      i += 1;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "?" || ch === "*" || ch === "+") {
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "-") {
      out += "\\-";
      i += 1;
      continue;
    }
    if (ch === "[") {
      let j = i + 1;
      let cls = "[";
      while (j < pattern.length) {
        const c = pattern[j]!;
        if (c === "%" && pattern[j + 1]) {
          const esc = pattern[j + 1]!;
          j += 2;
          if (esc === "d") cls += "\\d";
          else if (esc === "a") cls += "A-Za-z";
          else if (esc === "w") cls += "A-Za-z0-9_";
          else if (esc === "s") cls += "\\s";
          else cls += esc;
          continue;
        }
        if (c === "]") {
          cls += "]";
          j += 1;
          break;
        }
        cls += c;
        j += 1;
      }
      out += cls;
      i = j;
      continue;
    }
    if (/[\\^$|{}]/.test(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
    i += 1;
  }
  return out;
}

function luaReplacementToJs(replacement: string): string {
  return replacement.replace(/%([1-9])/g, (_m, n: string) => `$${n}`);
}

export function luaMatch(subject: string, pattern: string): boolean {
  try {
    const re = new RegExp(`^(?:${luaPatternToJsSource(pattern)})$`);
    return re.test(subject);
  } catch {
    return false;
  }
}

export function luaGsub(
  subject: string,
  pattern: string,
  replacement: string,
): string {
  try {
    const re = new RegExp(`^(?:${luaPatternToJsSource(pattern)})$`);
    return subject.replace(re, luaReplacementToJs(replacement));
  } catch {
    return subject;
  }
}

export function parseDeprecatedInvokeInner(
  params: Template["params"],
): DeprecatedParamsRules {
  const renames: Array<{ from: string; to: string }> = [];
  const remove: string[] = [];
  const regexps: Array<{ find: string; replace: string }> = [];

  for (const p of params) {
    if (p.kind !== "named") continue;
    const key = p.name.trim();
    const value = p.value.trim();
    if (!key) continue;

    if (META_PARAMS.has(key.toLowerCase())) continue;

    if (key.toLowerCase() === "_remove") {
      for (const part of value.split(";")) {
        const name = part.trim();
        if (name) remove.push(name);
      }
      continue;
    }

    if (REGEXP_KEY.test(key)) {
      if (!value.includes("=")) continue;
      const split = value.split(/\s*=\s*/);
      if (split.length < 2) continue;
      const find = (split[0] ?? "").trim();
      const replace = split.slice(1).join("=").trim();
      if (find) regexps.push({ find, replace });
      continue;
    }

    if (!value) continue;
    renames.push({ from: key, to: value });
  }

  return { renames, remove, regexps };
}

export function parseDeprecatedRulesFromTemplateSource(
  source: string,
): DeprecatedParamsRules {
  const masked = maskProtectedRegions(source);
  const hit = findTemplates(masked).find((t) => isDeprecatedInvokeName(t.name));
  if (!hit) return { ...EMPTY_RULES, renames: [], remove: [], regexps: [] };
  const template = hitToTemplate({
    ...hit,
    raw: source.slice(hit.start, hit.end),
    inner: source.slice(hit.start + 2, hit.end - 2),
  });
  return parseDeprecatedInvokeInner(template.params);
}

export function resolveTemplatePageTitle(title: unknown): string {
  if (isWikiTitle(title)) {
    return title.getPrefixedText();
  }
  const raw = asString(title).trim();
  if (!raw) throw new Error("Template title is empty");
  try {
    const templateNs = WikiTitle.nameIdMap["template"];
    if (templateNs !== undefined) {
      return new WikiTitle(raw, templateNs).getPrefixedText();
    }
    return new WikiTitle(raw).getPrefixedText();
  } catch {
    if (/^Template\s*:/i.test(raw) || /^[^:\s]+:/.test(raw)) {
      return raw.replace(/_/g, " ");
    }
    return `Template:${raw.replace(/_/g, " ")}`;
  }
}

/** Sync rules load (nodish nodes — session Map only). */
export function getDeprecatedParamsRules(
  title: unknown,
): DeprecatedParamsRules {
  const key = resolveTemplatePageTitle(title);
  const cached = rulesCache.get(key);
  if (cached) return cached;

  const page = fetchPageContents(key);
  if (!page.exists) {
    throw new Error(`Template page not found: ${key}`);
  }
  const rules = parseDeprecatedRulesFromTemplateSource(page.content);
  rulesCache.set(key, rules);
  return rules;
}

/** Async rules load: memory → IndexedDB (1h TTL) → network. */
export async function getDeprecatedParamsRulesAsync(
  title: unknown,
): Promise<DeprecatedParamsRules> {
  const key = resolveTemplatePageTitle(title);

  const mem = asyncMemoryCache.get(key);
  if (mem && isFresh(mem.cachedAt)) return mem.rules;

  const fromIdb = await idbGetRules(key);
  if (fromIdb && isFresh(fromIdb.cachedAt)) {
    asyncMemoryCache.set(key, fromIdb);
    return fromIdb.rules;
  }

  const page = await fetchPageContentsAsync(key);
  if (!page.exists) {
    throw new Error(`Template page not found: ${key}`);
  }
  const rules = parseDeprecatedRulesFromTemplateSource(page.content);
  const entry: TimedRules = { rules, cachedAt: Date.now() };
  asyncMemoryCache.set(key, entry);
  void idbSetRules(key, entry);
  return rules;
}

export function clearDeprecatedParamsCache(): void {
  rulesCache.clear();
  asyncMemoryCache.clear();
  void idbClearRules();
}

export async function clearDeprecatedParamsCacheAsync(): Promise<void> {
  rulesCache.clear();
  asyncMemoryCache.clear();
  await idbClearRules();
}

function applyRulesToTemplate(
  t: Template,
  rules: DeprecatedParamsRules,
): Template {
  let next = t;
  for (const { from, to } of rules.renames) {
    next = renameTemplateParameterKey(next, from, to);
  }
  for (const name of rules.remove) {
    next = removeTemplateParameter(next, name);
  }
  if (rules.regexps.length > 0) {
    const named = next.params.filter((p) => p.kind === "named");
    for (const p of named) {
      if (p.kind !== "named") continue;
      for (const rule of rules.regexps) {
        if (!luaMatch(p.name, rule.find)) continue;
        const newName = luaGsub(p.name, rule.find, rule.replace);
        if (newName && newName !== p.name) {
          next = renameTemplateParameterKey(next, p.name, newName);
        }
        break;
      }
    }
  }
  return next;
}

function applyRulesToContent(
  title: unknown,
  content: string,
  fixindent: boolean,
  rules: DeprecatedParamsRules,
): string {
  const want = templateName(title);
  const all = templatesFromContent(content);
  const targets = all.filter((t) => templateNamesMatch(t.name, want));
  if (targets.length === 0) return content;

  const hasWork =
    rules.renames.length > 0 ||
    rules.remove.length > 0 ||
    rules.regexps.length > 0;

  if (!hasWork && !fixindent) return content;

  const updated = targets.map((t) => {
    let next = hasWork ? applyRulesToTemplate(t, rules) : t;
    if (fixindent) next = indentTemplate(next);
    return next;
  });

  return applyTemplatesToContent(content, updated);
}

/** Sync apply — for nodish nodes. */
export function replaceDeprecatedParametersInContent(
  title: unknown,
  content: string,
  fixindent: boolean,
): string {
  return applyRulesToContent(
    title,
    content,
    fixindent,
    getDeprecatedParamsRules(title),
  );
}

/** Async apply — for RDP / userscripts (IndexedDB-backed rules cache). */
export async function replaceDeprecatedParametersInContentAsync(
  title: unknown,
  content: string,
  fixindent: boolean,
): Promise<string> {
  const rules = await getDeprecatedParamsRulesAsync(title);
  return applyRulesToContent(title, content, fixindent, rules);
}
