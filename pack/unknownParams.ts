import { asString, templateName } from "./coerce.ts";
import {
  luaMatch,
  loadTemplateSourceAsync,
  loadTemplateSourceSync,
  maskProtectedRegions,
  resolveTemplatePageTitle,
} from "./deprecatedParams.ts";
import { isAbortError } from "./pageContents.ts";
import {
  chunksToString,
  hitToTemplate,
  mapTemplatesInContentAsync,
  renameTemplateParameterKey,
  scanAllTemplateHits,
  type Template,
  type TemplateParam,
} from "./wikitext.ts";

export const DROP_SENTINEL = "__DROP__";

const UNKNOWN_INVOKE_NAMES = [
  "#invoke:Check for unknown parameters",
  "#invoke:Module:Check for unknown parameters",
];

const CONFLICT_INVOKE_NAMES = [
  "#invoke:Check for conflicting parameters",
  "#invoke:Module:Check for conflicting parameters",
];

const UNKNOWN_META = new Set([
  "unknown",
  "preview",
  "ignoreblank",
  "showblankpositional",
  "mapframe_args",
  "pushpin_map_args",
]);

const CONFLICT_META = new Set(["nested", "template", "cat", "delimiter"]);

const REGEXP_KEY = /^regexp[1-9][0-9]*$/i;

/** Copied from enwiki Module:Check for unknown parameters (do not scrape Lua). */
export const PUSHPIN_MAP_PARAMS = [
  "coordinates",
  "pushpin_caption",
  "pushpin_relief",
  "pushpin_label",
  "pushpin_label_position",
  "pushpin_label_size",
  "pushpin_map",
  "pushpin_mark",
  "pushpin_mark_size",
  "pushpin_alt",
  "pushpin_background",
  "pushpin_map_size",
] as const;

export const MAPFRAME_PARAMS = [
  "coord",
  "coordinates",
  "id",
  "qid",
  "mapframe",
  "mapframe-area_km2",
  "mapframe-area_mi2",
  "mapframe-caption",
  "mapframe-coord",
  "mapframe-coordinates",
  "mapframe-custom",
  "mapframe-frame-coord",
  "mapframe-frame-coordinates",
  "mapframe-frame-height",
  "mapframe-frame-width",
  "mapframe-geomask",
  "mapframe-geomask-fill",
  "mapframe-geomask-fill-opacity",
  "mapframe-geomask-stroke-color",
  "mapframe-geomask-stroke-colour",
  "mapframe-geomask-stroke-width",
  "mapframe-height",
  "mapframe-id",
  "mapframe-length_km",
  "mapframe-length_mi",
  "mapframe-line",
  "mapframe-line-stroke-color",
  "mapframe-line-stroke-colour",
  "mapframe-marker",
  "mapframe-marker-color",
  "mapframe-marker-colour",
  "mapframe-point",
  "mapframe-population",
  "mapframe-shape",
  "mapframe-shape-fill",
  "mapframe-shape-fill-opacity",
  "mapframe-shape-stroke-color",
  "mapframe-shape-stroke-colour",
  "mapframe-stroke-color",
  "mapframe-stroke-colour",
  "mapframe-stroke-width",
  "mapframe-switcher",
  "mapframe-type",
  "mapframe-width",
  "mapframe-wikidata",
  "mapframe-zoom",
] as const;

export type UnknownParamRules = {
  known: string[];
  regexps: string[];
  ignoreblank: boolean;
  showblankpositional: boolean;
};

export type ConflictingParamRules = {
  groups: string[][];
  nested: boolean;
  delimiter: string;
};

export type UnknownParamPageRules = {
  unknown: UnknownParamRules;
  conflicting: ConflictingParamRules;
  matchNames: string[];
};

export type UnknownParamAction =
  | { kind: "rename"; from: string; to: string }
  | { kind: "drop"; from: string };

export type UnknownParamChooserInput = {
  templateName: string;
  unknownKey: string;
  value: string;
  options: string[];
  known: string[];
  conflictGroups: string[][];
  siblingKeys: string[];
};

export type UnknownParamChooser = (
  input: UnknownParamChooserInput,
) => string | Promise<string>;

const rulesCache = new Map<string, UnknownParamPageRules>();

function invokeNameMatches(written: string, wants: string[]): boolean {
  const n = written.replace(/_/g, " ").trim().toLowerCase();
  return wants.some(
    (want) => want.replace(/_/g, " ").trim().toLowerCase() === n,
  );
}

function namedValue(t: Template, key: string): string {
  const p = t.params.find(
    (x) => x.kind === "named" && x.name.toLowerCase() === key.toLowerCase(),
  );
  return p ? chunksToString(p.value).trim() : "";
}

function isNotEmpty(value: string): boolean {
  return /\S/.test(value);
}

function paramKey(p: TemplateParam): string {
  return p.kind === "named" ? p.name : String(p.index);
}

function paramValue(p: TemplateParam): string {
  return chunksToString(p.value);
}

function findInvokeTemplate(source: string, names: string[]): Template | null {
  const masked = maskProtectedRegions(source);
  const hits = scanAllTemplateHits(masked).filter((t) =>
    invokeNameMatches(t.name, names),
  );
  if (hits.length === 0) return null;
  // Prefer the longest span if a truncated ghost hit remains.
  const hit = hits.reduce((best, t) =>
    t.end - t.start > best.end - best.start ? t : best,
  );
  return hitToTemplate({
    ...hit,
    raw: source.slice(hit.start, hit.end),
    inner: source.slice(hit.start + 2, hit.end - 2),
  });
}

/** `#invoke:Module|function|…` — first positional is the Lua function name. */
function isInvokeFunctionName(p: TemplateParam): boolean {
  return p.kind === "positional" && p.index === 1;
}

export function parseUnknownRulesFromTemplateSource(
  source: string,
): UnknownParamRules | null {
  const invoke = findInvokeTemplate(source, UNKNOWN_INVOKE_NAMES);
  if (!invoke) return null;

  const known: string[] = [];
  const regexps: string[] = [];
  if (isNotEmpty(namedValue(invoke, "mapframe_args"))) {
    known.push(...MAPFRAME_PARAMS);
  }
  if (isNotEmpty(namedValue(invoke, "pushpin_map_args"))) {
    known.push(...PUSHPIN_MAP_PARAMS);
  }

  for (const p of invoke.params) {
    if (p.kind === "positional") {
      if (isInvokeFunctionName(p)) continue;
      const name = chunksToString(p.value).trim();
      if (name) known.push(name);
      continue;
    }
    const key = p.name.trim();
    if (UNKNOWN_META.has(key.toLowerCase())) continue;
    if (REGEXP_KEY.test(key)) {
      const pattern = chunksToString(p.value).trim();
      if (pattern) regexps.push(pattern);
    }
  }

  return {
    known,
    regexps,
    ignoreblank: isNotEmpty(namedValue(invoke, "ignoreblank")),
    showblankpositional: isNotEmpty(namedValue(invoke, "showblankpositional")),
  };
}

export function parseConflictingRulesFromTemplateSource(
  source: string,
): ConflictingParamRules {
  const invoke = findInvokeTemplate(source, CONFLICT_INVOKE_NAMES);
  if (!invoke) {
    return { groups: [], nested: false, delimiter: ";" };
  }
  const delimiter = namedValue(invoke, "delimiter") || ";";
  const nested = isNotEmpty(namedValue(invoke, "nested"));
  const groups: string[][] = [];
  for (const p of invoke.params) {
    if (p.kind !== "positional") {
      if (CONFLICT_META.has(p.name.toLowerCase())) continue;
      continue;
    }
    if (isInvokeFunctionName(p)) continue;
    const raw = chunksToString(p.value);
    const parts = raw
      .split(delimiter)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) groups.push(parts);
  }
  return { groups, nested, delimiter };
}

export function parseUnknownParamRulesFromTemplateSource(
  source: string,
  matchNames: string[] = [],
): UnknownParamPageRules {
  const unknown = parseUnknownRulesFromTemplateSource(source);
  if (!unknown) {
    throw new Error(
      "Template source has no {{#invoke:Check for unknown parameters}}",
    );
  }
  return {
    unknown,
    conflicting: parseConflictingRulesFromTemplateSource(source),
    matchNames,
  };
}

export function resolveUnknownParamRulesSync(
  title: unknown,
): UnknownParamPageRules {
  const key = resolveTemplatePageTitle(title);
  const cached = rulesCache.get(key);
  if (cached) return cached;
  const loaded = loadTemplateSourceSync(key);
  const rules = parseUnknownParamRulesFromTemplateSource(
    loaded.source,
    loaded.matchNames,
  );
  rulesCache.set(key, rules);
  return rules;
}

export async function resolveUnknownParamRulesAsync(
  title: unknown,
  signal?: AbortSignal,
): Promise<UnknownParamPageRules> {
  const key = resolveTemplatePageTitle(title);
  const cached = rulesCache.get(key);
  if (cached) return cached;
  const loaded = await loadTemplateSourceAsync(key, signal);
  const rules = parseUnknownParamRulesFromTemplateSource(
    loaded.source,
    loaded.matchNames,
  );
  rulesCache.set(key, rules);
  return rules;
}

export function isKnownParamName(
  key: string,
  rules: UnknownParamRules,
): boolean {
  if (rules.known.includes(key)) return true;
  return rules.regexps.some((pattern) => luaMatch(key, pattern));
}

function isUnknownOnInvocation(
  p: TemplateParam,
  rules: UnknownParamRules,
): boolean {
  const key = paramKey(p);
  if (isKnownParamName(key, rules)) return false;
  const value = paramValue(p);
  if (p.kind === "positional") {
    return rules.showblankpositional || isNotEmpty(value);
  }
  return !rules.ignoreblank || isNotEmpty(value);
}

export function listUnknownParamKeys(
  t: Template,
  rules: UnknownParamRules,
): string[] {
  const out: string[] = [];
  for (const p of t.params) {
    if (isUnknownOnInvocation(p, rules)) out.push(paramKey(p));
  }
  return out;
}

export function hasExactParam(t: Template, key: string): boolean {
  return t.params.some((p) => paramKey(p) === key);
}

export function isParamPresent(
  t: Template,
  key: string,
  nested: boolean,
): boolean {
  const p = t.params.find((x) => paramKey(x) === key);
  if (!p) return false;
  if (nested) return true;
  return isNotEmpty(paramValue(p));
}

export function uniqueCaseInsensitiveKnown(
  unknownKey: string,
  known: string[],
): string | null {
  const want = unknownKey.toLowerCase();
  const hits = known.filter((k) => k.toLowerCase() === want);
  return hits.length === 1 ? hits[0]! : null;
}

function conflictsWithPresent(
  target: string,
  t: Template,
  groups: string[][],
  nested: boolean,
  ignoreKey?: string,
): boolean {
  for (const group of groups) {
    if (!group.includes(target)) continue;
    for (const other of group) {
      if (other === target) continue;
      if (ignoreKey && other === ignoreKey) continue;
      if (isParamPresent(t, other, nested)) return true;
    }
  }
  return false;
}

/** Known names this unknown may be renamed to (plus always DROP). */
export function eligibleRenameTargets(
  t: Template,
  rules: UnknownParamPageRules,
  ignoreKey?: string,
): string[] {
  const out: string[] = [];
  for (const name of rules.unknown.known) {
    if (ignoreKey && name === ignoreKey) continue;
    if (hasExactParam(t, name)) continue;
    if (
      conflictsWithPresent(
        name,
        t,
        rules.conflicting.groups,
        rules.conflicting.nested,
        ignoreKey,
      )
    ) {
      continue;
    }
    out.push(name);
  }
  return out;
}

export function formatUnknownActions(actions: UnknownParamAction[]): string {
  if (actions.length === 0) return "(none)";
  return actions
    .map((a) =>
      a.kind === "rename" ? `rename ${a.from}→${a.to}` : `drop ${a.from}`,
    )
    .join("; ");
}

function dropExactParam(t: Template, key: string): Template {
  const params = t.params.filter((p) => paramKey(p) !== key);
  if (params.length === t.params.length) return t;
  let index = 0;
  const next = params.map((p) => {
    if (p.kind !== "positional") return p;
    index += 1;
    return { ...p, index };
  });
  return { ...t, params: next, pristine: false };
}

export function applyUnknownAction(
  t: Template,
  action: UnknownParamAction,
): Template {
  if (action.kind === "drop") {
    return dropExactParam(t, action.from);
  }
  return renameTemplateParameterKey(t, action.from, action.to);
}

function truncateValue(value: string, max = 200): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export function clampMaxCalls(raw: unknown, fallback = 8): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

export async function resolveUnknownsOnTemplate(
  t: Template,
  rules: UnknownParamPageRules,
  choose: UnknownParamChooser,
  maxCalls: number,
): Promise<{
  template: Template;
  actions: UnknownParamAction[];
  callsUsed: number;
}> {
  let next = t;
  const actions: UnknownParamAction[] = [];
  let callsUsed = 0;
  const seen = new Set<string>();

  for (const key of listUnknownParamKeys(next, rules.unknown)) {
    if (seen.has(key)) continue;
    seen.add(key);
    const unique = uniqueCaseInsensitiveKnown(key, rules.unknown.known);
    if (unique && unique !== key && !hasExactParam(next, unique)) {
      if (
        !conflictsWithPresent(
          unique,
          next,
          rules.conflicting.groups,
          rules.conflicting.nested,
          key,
        )
      ) {
        const action: UnknownParamAction = {
          kind: "rename",
          from: key,
          to: unique,
        };
        next = applyUnknownAction(next, action);
        actions.push(action);
        continue;
      }
    }

    if (callsUsed >= maxCalls) continue;

    const options = [DROP_SENTINEL, ...eligibleRenameTargets(next, rules, key)];
    if (options.length === 1) {
      const action: UnknownParamAction = { kind: "drop", from: key };
      next = applyUnknownAction(next, action);
      actions.push(action);
      continue;
    }

    const value = getExactParamValue(next, key);
    let choice = DROP_SENTINEL;
    try {
      choice = await choose({
        templateName: t.name,
        unknownKey: key,
        value: truncateValue(value),
        options,
        known: rules.unknown.known,
        conflictGroups: rules.conflicting.groups,
        siblingKeys: next.params.map(paramKey),
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      choice = DROP_SENTINEL;
    }
    callsUsed += 1;
    const picked = options.includes(choice) ? choice : DROP_SENTINEL;
    const action: UnknownParamAction =
      picked === DROP_SENTINEL
        ? { kind: "drop", from: key }
        : { kind: "rename", from: key, to: picked };
    next = applyUnknownAction(next, action);
    actions.push(action);
  }

  return { template: next, actions, callsUsed };
}

function getExactParamValue(t: Template, key: string): string {
  const p = t.params.find((x) => paramKey(x) === key);
  return p ? paramValue(p) : "";
}

export async function resolveUnknownParametersInContent(
  content: string,
  rules: UnknownParamPageRules,
  choose: UnknownParamChooser,
  maxCalls: number,
): Promise<{ content: string; actions: UnknownParamAction[] }> {
  const all: UnknownParamAction[] = [];
  let remaining = clampMaxCalls(maxCalls, 0);
  const names =
    rules.matchNames.length > 0 ? rules.matchNames : ["__never__"];

  const next = await mapTemplatesInContentAsync(content, names, async (t) => {
    const result = await resolveUnknownsOnTemplate(
      t,
      rules,
      choose,
      remaining,
    );
    remaining -= result.callsUsed;
    all.push(...result.actions);
    return result.template;
  });
  return { content: next, actions: all };
}

export function asTemplateName(value: unknown): string {
  const n = templateName(asString(value)).trim();
  if (!n) throw new Error("Template name is required");
  return n;
}
