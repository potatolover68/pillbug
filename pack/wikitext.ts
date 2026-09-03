import { categoryName, normName, templateName } from "./coerce.ts";

export type TemplateHit = {
  /** Full `{{...}}` including braces. */
  raw: string;
  /** Start index in content. */
  start: number;
  /** End index (exclusive). */
  end: number;
  /** Name as written (after `{{`, before `|` or `}}`), trimmed. */
  name: string;
  /** Body between braces without outer `{{` `}}`. */
  inner: string;
};

/** Text or nested template inside a param value / page. */
export type WikitextChunk =
  | { kind: "text"; text: string }
  | { kind: "template"; template: Template };

/** Top-level page as an alternating forest of text and root templates. */
export type PageChunks = WikitextChunk[];

export type TemplateNamedParam = {
  kind: "named";
  name: string;
  value: WikitextChunk[];
  wsBefore: string;
  wsAfterName: string;
};

export type TemplatePositionalParam = {
  kind: "positional";
  /** 1-based positional index among positional params only. */
  index: number;
  value: WikitextChunk[];
};

export type TemplateParam = TemplateNamedParam | TemplatePositionalParam;

/** Structured template invocation (forest root or nested in a param). */
export type Template = {
  name: string;
  params: TemplateParam[];
  start: number;
  end: number;
  /** Original `{{…}}`; used when `pristine` is true. */
  raw: string;
  nameWsLeading: string;
  nameWsTrailing: string;
  /** When true, `serializeTemplate` returns `raw` unchanged. */
  pristine: boolean;
};

/** Split template inner on first-level `|` (respects nested `{{ }}` and `[[ ]]`). */
export function splitFirstLevelPipes(inner: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let tplDepth = 0;
  let linkDepth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "{" && inner[i + 1] === "{") {
      tplDepth += 1;
      buf += "{{";
      i += 1;
      continue;
    }
    if (ch === "}" && inner[i + 1] === "}") {
      tplDepth = Math.max(0, tplDepth - 1);
      buf += "}}";
      i += 1;
      continue;
    }
    if (ch === "[" && inner[i + 1] === "[") {
      linkDepth += 1;
      buf += "[[";
      i += 1;
      continue;
    }
    if (ch === "]" && inner[i + 1] === "]") {
      linkDepth = Math.max(0, linkDepth - 1);
      buf += "]]";
      i += 1;
      continue;
    }
    if (ch === "|" && tplDepth === 0 && linkDepth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}

export function chunksToString(chunks: WikitextChunk[]): string {
  let out = "";
  for (const c of chunks) {
    out += c.kind === "text" ? c.text : serializeTemplate(c.template);
  }
  return out;
}

export function parseValueChunks(
  value: string,
  baseOffset = 0,
): WikitextChunk[] {
  const chunks: WikitextChunk[] = [];
  let i = 0;
  let textStart = 0;
  while (i < value.length) {
    if (i < value.length - 1 && value[i] === "{" && value[i + 1] === "{") {
      if (value[i + 2] === "{") {
        i += 3;
        continue;
      }
      if (i > textStart) {
        chunks.push({ kind: "text", text: value.slice(textStart, i) });
      }
      const start = i;
      let depth = 2;
      i += 2;
      while (i < value.length && depth > 0) {
        if (value[i] === "{" && value[i + 1] === "{") {
          depth += 2;
          i += 2;
          continue;
        }
        if (value[i] === "}" && value[i + 1] === "}") {
          depth -= 2;
          i += 2;
          continue;
        }
        i += 1;
      }
      if (depth === 0) {
        const raw = value.slice(start, i);
        const inner = raw.slice(2, -2);
        const nameMatch = /^([^|{}\n]+)/.exec(inner);
        const name = (nameMatch?.[1] ?? "").trim();
        if (name) {
          chunks.push({
            kind: "template",
            template: hitToTemplate({
              raw,
              start: baseOffset + start,
              end: baseOffset + i,
              name,
              inner,
            }),
          });
        } else {
          chunks.push({ kind: "text", text: raw });
        }
        textStart = i;
        continue;
      }
      // Unbalanced. treat remainder as text.
      break;
    }
    i += 1;
  }
  if (textStart < value.length) {
    chunks.push({ kind: "text", text: value.slice(textStart) });
  }
  if (chunks.length === 0) return [{ kind: "text", text: "" }];
  return chunks;
}

export function parsePage(content: string): PageChunks {
  return parseValueChunks(content, 0);
}

export function serializePage(chunks: PageChunks): string {
  return chunksToString(chunks);
}

export function pageRoots(chunks: PageChunks): Template[] {
  const roots: Template[] = [];
  for (const c of chunks) {
    if (c.kind === "template") roots.push(c.template);
  }
  return roots;
}

function trimChunks(chunks: WikitextChunk[]): WikitextChunk[] {
  return parseValueChunks(chunksToString(chunks).trim());
}

export function hitToTemplate(hit: TemplateHit): Template {
  const parts = splitFirstLevelPipes(hit.inner);
  const namePart = parts[0] ?? "";
  const nameWsLeading = /^\s*/.exec(namePart)?.[0] ?? "";
  const nameWsTrailing =
    namePart.length === 0
      ? ""
      : (/\s*$/.exec(namePart.slice(nameWsLeading.length))?.[0] ?? "");
  const params: TemplateParam[] = [];
  let positionalIndex = 0;
  // Absolute offset of `inner` within the page.
  const innerBase = hit.start + 2;
  let cursor = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const partStart = cursor;
    cursor += part.length;
    if (i < parts.length - 1) cursor += 1; // account for `|`
    if (i === 0) continue;
    const m = /^(\s*)([^=|]+?)(\s*)=(.*)$/s.exec(part);
    if (m) {
      const valueStr = m[4]!;
      const valueOffsetInPart = part.length - valueStr.length;
      params.push({
        kind: "named",
        name: m[2]!.trim(),
        value: parseValueChunks(
          valueStr,
          innerBase + partStart + valueOffsetInPart,
        ),
        wsBefore: m[1]!,
        wsAfterName: m[3]!,
      });
    } else {
      positionalIndex += 1;
      params.push({
        kind: "positional",
        index: positionalIndex,
        value: parseValueChunks(part, innerBase + partStart),
      });
    }
  }
  return {
    name: hit.name,
    params,
    start: hit.start,
    end: hit.end,
    raw: hit.raw,
    nameWsLeading,
    nameWsTrailing,
    pristine: true,
  };
}

export function serializeTemplate(t: Template): string {
  if (t.pristine) return t.raw;
  const nameSeg = `${t.nameWsLeading}${t.name}${t.nameWsTrailing}`;
  const paramSegs = t.params.map((p) => {
    if (p.kind === "named") {
      return `${p.wsBefore}${p.name}${p.wsAfterName}=${chunksToString(p.value)}`;
    }
    return chunksToString(p.value);
  });
  const inner =
    paramSegs.length === 0 ? nameSeg : `${nameSeg}|${paramSegs.join("|")}`;
  return `{{${inner}}}`;
}

/**
 * Multi-line indented form (AWB-style): name on first line, one `| name = value`
 * per param with aligned `=`, closing `}}` on its own line.
 * Nested templates serialize recursively; they are not re-split as Outer params.
 */
export function formatIndentedTemplate(t: Template): string {
  const namedWidths = t.params
    .filter((p): p is TemplateNamedParam => p.kind === "named")
    .map((p) => p.name.length);
  const width = namedWidths.length > 0 ? Math.max(...namedWidths) : 0;

  const lines: string[] = [`{{${t.name}`];
  for (const p of t.params) {
    const valueText = chunksToString(p.value).trim();
    if (p.kind === "named") {
      const pad = " ".repeat(Math.max(0, width - p.name.length));
      lines.push(`| ${p.name}${pad} = ${valueText}`);
    } else {
      lines.push(`| ${valueText}`);
    }
  }
  lines.push("}}");
  return lines.join("\n");
}

/** Reformat this template to indented multi-line wikitext (children serialize as-is). */
export function indentTemplate(t: Template): Template {
  const params = t.params.map((p) =>
    p.kind === "named"
      ? {
          ...p,
          value: trimChunks(p.value),
          wsBefore: " ",
          wsAfterName: " ",
        }
      : { ...p, value: trimChunks(p.value) },
  );
  const next: Template = {
    ...t,
    params,
    nameWsLeading: "",
    nameWsTrailing: "",
    pristine: false,
  };
  return {
    ...next,
    raw: formatIndentedTemplate(next),
    pristine: true,
  };
}

export function indentTemplates(templates: Template[]): Template[] {
  return templates.map(indentTemplate);
}

function renumberPositionals(params: TemplateParam[]): TemplateParam[] {
  let index = 0;
  return params.map((p) => {
    if (p.kind !== "positional") return p;
    index += 1;
    return { ...p, index };
  });
}

function paramKeyMatches(param: TemplateParam, key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  if (param.kind === "named") {
    return param.name.toLowerCase() === k.toLowerCase();
  }
  return String(param.index) === k;
}

export function templateHasParameter(t: Template, parameter: string): boolean {
  return t.params.some((p) => paramKeyMatches(p, parameter));
}

export function getTemplateParameter(t: Template, parameter: string): string {
  const k = parameter.trim();
  if (!k) return "";
  const named = t.params.find(
    (p) => p.kind === "named" && p.name.toLowerCase() === k.toLowerCase(),
  );
  if (named) return chunksToString(named.value);
  const positional = t.params.find(
    (p) => p.kind === "positional" && String(p.index) === k,
  );
  return positional ? chunksToString(positional.value) : "";
}

export function removeTemplateParameter(
  t: Template,
  parameter: string,
): Template {
  const k = parameter.trim();
  if (!k) return t;
  const next = t.params.filter((p) => !paramKeyMatches(p, k));
  if (next.length === t.params.length) return t;
  return {
    ...t,
    params: renumberPositionals(next),
    pristine: false,
  };
}

export function setTemplateParameter(
  t: Template,
  parameter: string,
  value: string,
): Template {
  const k = parameter.trim();
  if (!k) return t;
  const chunks = parseValueChunks(value);
  const params = [...t.params];
  const namedIdx = params.findIndex(
    (p) => p.kind === "named" && p.name.toLowerCase() === k.toLowerCase(),
  );
  if (namedIdx >= 0) {
    const prev = params[namedIdx]! as TemplateNamedParam;
    params[namedIdx] = { ...prev, value: chunks };
    return { ...t, params, pristine: false };
  }
  if (/^\d+$/.test(k)) {
    const posIdx = params.findIndex(
      (p) => p.kind === "positional" && String(p.index) === k,
    );
    if (posIdx >= 0) {
      const prev = params[posIdx]! as TemplatePositionalParam;
      params[posIdx] = { ...prev, value: chunks };
      return { ...t, params, pristine: false };
    }
    params.push({ kind: "positional", index: Number(k), value: chunks });
    return { ...t, params: renumberPositionals(params), pristine: false };
  }
  params.push({
    kind: "named",
    name: k,
    value: chunks,
    wsBefore: "",
    wsAfterName: "",
  });
  return { ...t, params, pristine: false };
}

/** Swap two parameter values (named or positional). Missing keys are created blank first. */
export function swapTemplateParameters(
  t: Template,
  parameterA: string,
  parameterB: string,
): Template {
  const a = parameterA.trim();
  const b = parameterB.trim();
  if (!a || !b) return t;
  const aPos = /^\d+$/.test(a);
  const bPos = /^\d+$/.test(b);
  if (aPos && bPos ? a === b : a.toLowerCase() === b.toLowerCase()) return t;
  const valA = getTemplateParameter(t, a);
  const valB = getTemplateParameter(t, b);
  return setTemplateParameter(setTemplateParameter(t, a, valB), b, valA);
}

/** Rename a named parameter key (positional keys like "1" are not renamed).
 * Matching is case-sensitive — MW template args are (`Name` ≠ `name`).
 */
export function renameTemplateParameterKey(
  t: Template,
  oldParameter: string,
  newParameter: string,
): Template {
  const oldN = oldParameter.trim();
  const newN = newParameter.trim();
  if (!oldN || !newN || oldN === newN) return t;
  let changed = false;
  const params = t.params.map((p) => {
    if (p.kind !== "named") return p;
    if (p.name !== oldN) return p;
    changed = true;
    return { ...p, name: newN };
  });
  if (!changed) return t;
  return { ...t, params, pristine: false };
}

export function setTemplateName(t: Template, newName: unknown): Template {
  const next = writeTemplateName(templateName(newName));
  if (t.name === next) return t;
  return {
    ...t,
    name: next,
    pristine: false,
  };
}

/** Preorder walk of every template in a forest (roots + nested). */
export function walkTemplates(
  roots: Template[],
  fn: (t: Template) => void,
): void {
  const walk = (t: Template): void => {
    fn(t);
    for (const p of t.params) {
      for (const c of p.value) {
        if (c.kind === "template") walk(c.template);
      }
    }
  };
  for (const r of roots) walk(r);
}

/** Bottom-up map over a single template tree. */
export function mapTemplateTree(
  t: Template,
  fn: (t: Template) => Template,
): Template {
  let anyChildChanged = false;
  const params = t.params.map((p) => {
    let valueChanged = false;
    const value = p.value.map((c) => {
      if (c.kind === "text") return c;
      const next = mapTemplateTree(c.template, fn);
      if (next !== c.template) {
        valueChanged = true;
        anyChildChanged = true;
        return { kind: "template" as const, template: next };
      }
      return c;
    });
    return valueChanged ? { ...p, value } : p;
  });
  const base = anyChildChanged ? { ...t, params, pristine: false } : t;
  return fn(base);
}

/** Map every node in the forest (deep). */
export function mapAllTemplates(
  roots: Template[],
  fn: (t: Template) => Template,
): Template[] {
  return roots.map((r) => mapTemplateTree(r, fn));
}

/** Map every node whose name matches any of `names` (deep). Returns updated roots. */
export function mapTemplatesByName(
  roots: Template[],
  names: string | string[],
  fn: (t: Template) => Template,
): Template[] {
  const list = Array.isArray(names) ? names : [names];
  return roots.map((r) =>
    mapTemplateTree(r, (t) => {
      if (list.some((n) => templateNamesMatch(t.name, n))) return fn(t);
      return t;
    }),
  );
}

/** Unique template names (Template: stripped) at all depths. Skips `#…` parser functions. */
export function collectTemplateNames(roots: Template[]): string[] {
  const names = new Set<string>();
  walkTemplates(roots, (t) => {
    const n = t.name.trim();
    if (!n || n.startsWith("#")) return;
    names.add(templateName(n));
  });
  return [...names];
}

/** Deep find: all matching nodes (may be nested — not safe to Apply as a list). */
export function findTemplatesByNameDeep(
  content: string,
  name: unknown,
): Template[] {
  const want = templateName(name);
  const out: Template[] = [];
  walkTemplates(templatesFromContent(content), (t) => {
    if (templateNamesMatch(t.name, want)) out.push(t);
  });
  return out;
}

/**
 * Parse content, deep-map matching templates, write roots back.
 * Prefer this over find-nested + applyTemplatesToContent.
 */
export function mapTemplatesInContent(
  content: string,
  names: string | string[],
  fn: (t: Template) => Template,
): string {
  const roots = templatesFromContent(content);
  const mapped = mapTemplatesByName(roots, names, fn);
  return applyTemplatesToContent(content, mapped);
}

export function templatesFromContent(content: string): Template[] {
  return pageRoots(parsePage(content));
}

export function filterTemplatesByName(
  templates: Template[],
  name: unknown,
): Template[] {
  const want = templateName(name);
  return templates.filter((t) => templateNamesMatch(t.name, want));
}

export function sliceTemplates(
  templates: Template[],
  n: number,
  m: number,
): Template[] {
  const start = Math.max(1, Math.floor(n));
  const end = Math.floor(m);
  if (end < start) return [];
  return templates.slice(start - 1, end);
}

export function getNthTemplate(templates: Template[], n: number): Template[] {
  return sliceTemplates(templates, n, n);
}

export function joinTemplates(a: Template[], b: Template[]): Template[] {
  return [...a, ...b];
}

/** True if `inner`’s span is strictly inside `outer`. */
function isStrictlyNested(outer: Template, inner: Template): boolean {
  return (
    inner.start >= outer.start &&
    inner.end <= outer.end &&
    (inner.start > outer.start || inner.end < outer.end)
  );
}

/**
 * Assert the list has no template strictly nested inside another in the list.
 * Apply/Delete only accept root-level spans (children serialize inside parents).
 */
export function assertRootTemplateList(templates: Template[]): void {
  for (let i = 0; i < templates.length; i++) {
    for (let j = 0; j < templates.length; j++) {
      if (i === j) continue;
      if (isStrictlyNested(templates[i]!, templates[j]!)) {
        throw new Error(
          "Expected root templates only; nested spans must not be applied or deleted separately (use map-templates-by-name / mapTemplatesInContent)",
        );
      }
    }
  }
}

/**
 * Replace each root template span with its recursive serialization.
 * Nested templates must not appear as separate list entries.
 */
export function applyTemplatesToContent(
  content: string,
  templates: Template[],
): string {
  assertRootTemplateList(templates);
  const ordered = [...templates].sort((a, b) => b.start - a.start);
  let out = content;
  for (const t of ordered) {
    out = out.slice(0, t.start) + serializeTemplate(t) + out.slice(t.end);
  }
  return out;
}

export function removeTemplatesFromContent(
  content: string,
  templates: Template[],
): string {
  assertRootTemplateList(templates);
  const ordered = [...templates].sort((a, b) => b.start - a.start);
  let out = content;
  for (const t of ordered) {
    out = out.slice(0, t.start) + out.slice(t.end);
  }
  return out;
}

export type CategoryHit = {
  raw: string;
  start: number;
  end: number;
  name: string;
};

function templateToHit(t: Template): TemplateHit {
  const raw = t.pristine ? t.raw : serializeTemplate(t);
  return {
    raw,
    start: t.start,
    end: t.end,
    name: t.name,
    inner: raw.slice(2, -2),
  };
}

/**
 * Top-level `{{...}}` hits (forest roots). Thin view over parsePage.
 * Does not strip nowiki/comments.
 */
export function findTemplates(content: string): TemplateHit[] {
  return templatesFromContent(content).map(templateToHit);
}

/**
 * Every `{{...}}` including nested ones (preorder flatten).
 * Skips `{{{` params. Does not strip nowiki/comments.
 */
export function findAllTemplates(content: string): TemplateHit[] {
  const hits: TemplateHit[] = [];
  walkTemplates(templatesFromContent(content), (t) => {
    hits.push(templateToHit(t));
  });
  return hits;
}

/**
 * Flat scanner for every `{{...}}` including nested (used when content is
 * masked / not a clean tree parse). Prefer findAllTemplates on normal wikitext.
 */
export function scanAllTemplateHits(content: string): TemplateHit[] {
  const hits: TemplateHit[] = [];
  const stack: number[] = [];
  let i = 0;
  while (i < content.length - 1) {
    if (content[i] === "{" && content[i + 1] === "{") {
      if (content[i + 2] === "{") {
        i += 3;
        continue;
      }
      stack.push(i);
      i += 2;
      continue;
    }
    if (content[i] === "}" && content[i + 1] === "}" && stack.length > 0) {
      const start = stack.pop()!;
      const end = i + 2;
      const raw = content.slice(start, end);
      const inner = raw.slice(2, -2);
      const nameMatch = /^([^|{}\n]+)/.exec(inner);
      const name = (nameMatch?.[1] ?? "").trim();
      if (name) {
        hits.push({ raw, start, end, name, inner });
      }
      i += 2;
      continue;
    }
    i += 1;
  }
  return hits;
}

const CATEGORY_RE = /\[\[\s*[Cc]ategory\s*:\s*([^\]|#]+)(?:\|[^\]]*)?\]\]/g;

export function findCategories(content: string): CategoryHit[] {
  const hits: CategoryHit[] = [];
  for (const match of content.matchAll(CATEGORY_RE)) {
    hits.push({
      raw: match[0]!,
      start: match.index!,
      end: match.index! + match[0]!.length,
      name: match[1]!.replace(/_/g, " ").trim(),
    });
  }
  return hits;
}

export function contentHasCategory(
  content: string,
  category: unknown,
): boolean {
  const want = normName(categoryName(category));
  return findCategories(content).some((c) => normName(c.name) === want);
}

export function templateNamesMatch(written: string, want: string): boolean {
  const a = normName(templateName(written));
  const b = normName(templateName(want));
  return a === b;
}

export function contentHasTemplate(
  content: string,
  template: unknown,
): boolean {
  const want = templateName(template);
  let found = false;
  walkTemplates(templatesFromContent(content), (t) => {
    if (templateNamesMatch(t.name, want)) found = true;
  });
  return found;
}

function mergeAdjacentText(chunks: WikitextChunk[]): WikitextChunk[] {
  const out: WikitextChunk[] = [];
  for (const c of chunks) {
    const last = out[out.length - 1];
    if (c.kind === "text" && last?.kind === "text") {
      last.text += c.text;
    } else if (c.kind === "text") {
      out.push({ kind: "text", text: c.text });
    } else {
      out.push(c);
    }
  }
  return out;
}

/** Trim leading/trailing whitespace on a param value; keep internal text as-is. */
function normalizeValueChunks(chunks: WikitextChunk[]): WikitextChunk[] {
  const merged = mergeAdjacentText(chunks);
  if (merged.length === 0) return [];
  const first = merged[0]!;
  if (first.kind === "text") {
    merged[0] = { kind: "text", text: first.text.trimStart() };
  }
  const lastI = merged.length - 1;
  const last = merged[lastI]!;
  if (last.kind === "text") {
    merged[lastI] = { kind: "text", text: last.text.trimEnd() };
  }
  return merged.filter((c) => c.kind !== "text" || c.text.length > 0);
}

function valueChunksEqualIgnoringLayout(
  a: WikitextChunk[],
  b: WikitextChunk[],
): boolean {
  const na = normalizeValueChunks(a);
  const nb = normalizeValueChunks(b);
  if (na.length !== nb.length) return false;
  for (let i = 0; i < na.length; i++) {
    const x = na[i]!;
    const y = nb[i]!;
    if (x.kind !== y.kind) return false;
    if (x.kind === "text" && y.kind === "text") {
      if (x.text !== y.text) return false;
    } else if (x.kind === "template" && y.kind === "template") {
      if (!templatesEqualIgnoringLayout(x.template, y.template)) return false;
    }
  }
  return true;
}

/** Same invocation ignoring indent, `| name = value` alignment, and value trim. */
function templatesEqualIgnoringLayout(a: Template, b: Template): boolean {
  if (!templateNamesMatch(a.name, b.name)) return false;
  if (a.params.length !== b.params.length) return false;
  for (let i = 0; i < a.params.length; i++) {
    const pa = a.params[i]!;
    const pb = b.params[i]!;
    if (pa.kind !== pb.kind) return false;
    if (pa.kind === "named" && pb.kind === "named") {
      if (pa.name !== pb.name) return false;
    } else if (pa.kind === "positional" && pb.kind === "positional") {
      if (pa.index !== pb.index) return false;
    }
    if (!valueChunksEqualIgnoringLayout(pa.value, pb.value)) return false;
  }
  return true;
}

function pageChunksEqualIgnoringTemplateLayout(
  a: PageChunks,
  b: PageChunks,
): boolean {
  const aa = mergeAdjacentText(a);
  const bb = mergeAdjacentText(b);
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    const x = aa[i]!;
    const y = bb[i]!;
    if (x.kind !== y.kind) return false;
    if (x.kind === "text" && y.kind === "text") {
      if (x.text !== y.text) return false;
    } else if (x.kind === "template" && y.kind === "template") {
      if (!templatesEqualIgnoringLayout(x.template, y.template)) return false;
    }
  }
  return true;
}

/**
 * True if wikitext differs by more than insubstantial whitespace inside
 * {{templates}} (indent, `| name = value` layout, leading/trailing value
 * spaces). Prose, added/removed/reordered params, and value text all count.
 */
export function contentHasSignificantChanges(
  before: string,
  after: string,
): boolean {
  if (before === after) return false;
  return !pageChunksEqualIgnoringTemplateLayout(
    parsePage(before),
    parsePage(after),
  );
}

/** First-level `|name=` renames inside a template inner body (string).
 * Prefer renameTemplateParameterKey on a Template tree when possible.
 */
export function renameFirstLevelParams(
  inner: string,
  oldParam: string,
  newParam: string,
): string {
  const oldN = oldParam.trim();
  const newN = newParam.trim();
  if (!oldN || oldN === newN) return inner;

  const parts = splitFirstLevelPipes(inner);
  const renamed = parts.map((part, idx) => {
    if (idx === 0) return part;
    const m = /^(\s*)([^=|]+?)(\s*)=(.*)$/s.exec(part);
    if (!m) return part;
    const [, ws1, name, ws2, rest] = m;
    if (name!.trim() !== oldN) return part;
    return `${ws1}${newN}${ws2}=${rest}`;
  });
  return renamed.join("|");
}

export function isStubTemplateName(name: string): boolean {
  const n = templateName(name);
  return /\bstub$/i.test(n.trim());
}

/** True if the template name looks like an infobox ({{Infobox …}} / …infobox…). */
export function isInfoboxTemplateName(name: string): boolean {
  const n = normName(templateName(name));
  return n.startsWith("infobox") || n.includes("infobox");
}

export function writeTemplateName(name: string): string {
  return templateName(name);
}

export type WikilinkHit = {
  raw: string;
  start: number;
  end: number;
  /** Link target as written (no fragment), spaces normalized from underscores. */
  target: string;
  fragment: string | null;
  /** Piped label, or null for bare `[[Target]]`. */
  label: string | null;
};

const WIKILINK_RE =
  /\[\[([^\[\]|\n#]+)(?:#([^\[\]|\n]*))?(?:\|([^\[\]]*))?\]\]/g;

function isSpecialWikilinkTarget(target: string): boolean {
  return /^(Category|File|Image|Media)\s*:/i.test(target.trim());
}

/** Free wikilinks only (skips Category/File/Image/Media). */
export function findWikilinks(content: string): WikilinkHit[] {
  const hits: WikilinkHit[] = [];
  for (const match of content.matchAll(WIKILINK_RE)) {
    const target = match[1]!.replace(/_/g, " ").trim();
    if (!target || isSpecialWikilinkTarget(target)) continue;
    const fragmentRaw = match[2];
    const fragment =
      fragmentRaw != null && fragmentRaw.length > 0 ? fragmentRaw : null;
    const label = match[3] != null ? match[3] : null;
    hits.push({
      raw: match[0]!,
      start: match.index!,
      end: match.index! + match[0]!.length,
      target,
      fragment,
      label,
    });
  }
  return hits;
}

export function formatWikilink(
  target: string,
  fragment: string | null,
  label: string | null,
): string {
  const frag = fragment ? `#${fragment}` : "";
  if (label == null) return `[[${target}${frag}]]`;
  return `[[${target}${frag}|${label}]]`;
}
