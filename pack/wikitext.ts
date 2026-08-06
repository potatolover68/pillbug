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

export type TemplateNamedParam = {
  kind: "named";
  name: string;
  value: string;
  wsBefore: string;
  wsAfterName: string;
};

export type TemplatePositionalParam = {
  kind: "positional";
  /** 1-based positional index among positional params only. */
  index: number;
  value: string;
};

export type TemplateParam = TemplateNamedParam | TemplatePositionalParam;

/** Structured template invocation (one element of `wiki/templates`). */
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

/** Split template inner on first-level `|` (respects nested `{{ }}`). */
export function splitFirstLevelPipes(inner: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "{" && inner[i + 1] === "{") {
      depth += 1;
      buf += "{{";
      i += 1;
      continue;
    }
    if (ch === "}" && inner[i + 1] === "}") {
      depth = Math.max(0, depth - 1);
      buf += "}}";
      i += 1;
      continue;
    }
    if (ch === "|" && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts;
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
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    const m = /^(\s*)([^=|]+?)(\s*)=(.*)$/s.exec(part);
    if (m) {
      params.push({
        kind: "named",
        name: m[2]!.trim(),
        value: m[4]!,
        wsBefore: m[1]!,
        wsAfterName: m[3]!,
      });
    } else {
      positionalIndex += 1;
      params.push({
        kind: "positional",
        index: positionalIndex,
        value: part,
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
      return `${p.wsBefore}${p.name}${p.wsAfterName}=${p.value}`;
    }
    return p.value;
  });
  const inner =
    paramSegs.length === 0 ? nameSeg : `${nameSeg}|${paramSegs.join("|")}`;
  return `{{${inner}}}`;
}

/**
 * Multi-line indented form (AWB-style): name on first line, one `| name = value`
 * per param with aligned `=`, closing `}}` on its own line.
 */
export function formatIndentedTemplate(t: Template): string {
  const namedWidths = t.params
    .filter((p): p is TemplateNamedParam => p.kind === "named")
    .map((p) => p.name.length);
  const width = namedWidths.length > 0 ? Math.max(...namedWidths) : 0;

  const lines: string[] = [`{{${t.name}`];
  for (const p of t.params) {
    if (p.kind === "named") {
      const pad = " ".repeat(Math.max(0, width - p.name.length));
      lines.push(`| ${p.name}${pad} = ${p.value.trim()}`);
    } else {
      lines.push(`| ${p.value.trim()}`);
    }
  }
  lines.push("}}");
  return lines.join("\n");
}

/** Reformat each template to indented multi-line wikitext (for Apply). */
export function indentTemplate(t: Template): Template {
  const params = t.params.map((p) =>
    p.kind === "named"
      ? {
          ...p,
          value: p.value.trim(),
          wsBefore: " ",
          wsAfterName: " ",
        }
      : { ...p, value: p.value.trim() },
  );
  const next: Template = {
    ...t,
    params,
    nameWsLeading: "",
    nameWsTrailing: "",
    pristine: false,
  };
  // Store indented text as raw and mark pristine so Apply keeps formatting.
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
  if (named) return named.value;
  const positional = t.params.find(
    (p) => p.kind === "positional" && String(p.index) === k,
  );
  return positional?.value ?? "";
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
  const params = [...t.params];
  const namedIdx = params.findIndex(
    (p) => p.kind === "named" && p.name.toLowerCase() === k.toLowerCase(),
  );
  if (namedIdx >= 0) {
    const prev = params[namedIdx]! as TemplateNamedParam;
    params[namedIdx] = { ...prev, value };
    return { ...t, params, pristine: false };
  }
  if (/^\d+$/.test(k)) {
    const posIdx = params.findIndex(
      (p) => p.kind === "positional" && String(p.index) === k,
    );
    if (posIdx >= 0) {
      const prev = params[posIdx]! as TemplatePositionalParam;
      params[posIdx] = { ...prev, value };
      return { ...t, params, pristine: false };
    }
    params.push({ kind: "positional", index: Number(k), value });
    return { ...t, params: renumberPositionals(params), pristine: false };
  }
  params.push({
    kind: "named",
    name: k,
    value,
    wsBefore: "",
    wsAfterName: "",
  });
  return { ...t, params, pristine: false };
}

/** Rename a named parameter key (positional keys like "1" are not renamed). */
export function renameTemplateParameterKey(
  t: Template,
  oldParameter: string,
  newParameter: string,
): Template {
  const oldN = oldParameter.trim();
  const newN = newParameter.trim();
  if (!oldN || !newN || oldN.toLowerCase() === newN.toLowerCase()) return t;
  let changed = false;
  const params = t.params.map((p) => {
    if (p.kind !== "named") return p;
    if (p.name.toLowerCase() !== oldN.toLowerCase()) return p;
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

export function templatesFromContent(content: string): Template[] {
  return findTemplates(content).map(hitToTemplate);
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

export function applyTemplatesToContent(
  content: string,
  templates: Template[],
): string {
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

/**
 * Find top-level `{{...}}` template invocations (skips `{{{` params).
 * Does not strip nowiki/comments.
 */
export function findTemplates(content: string): TemplateHit[] {
  const hits: TemplateHit[] = [];
  let i = 0;
  while (i < content.length - 1) {
    if (content[i] === "{" && content[i + 1] === "{") {
      if (content[i + 2] === "{") {
        i += 3;
        continue;
      }
      const start = i;
      let depth = 2;
      i += 2;
      while (i < content.length && depth > 0) {
        if (content[i] === "{" && content[i + 1] === "{") {
          depth += 2;
          i += 2;
          continue;
        }
        if (content[i] === "}" && content[i + 1] === "}") {
          depth -= 2;
          i += 2;
          continue;
        }
        i += 1;
      }
      if (depth === 0) {
        const raw = content.slice(start, i);
        const inner = raw.slice(2, -2);
        const nameMatch = /^([^|{}\n]+)/.exec(inner);
        const name = (nameMatch?.[1] ?? "").trim();
        if (name) {
          hits.push({ raw, start, end: i, name, inner });
        }
      }
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
  return findTemplates(content).some((t) => templateNamesMatch(t.name, want));
}

/** First-level `|name=` / `| name =` renames inside a template inner body. */
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
    if (idx === 0) return part; // template name segment
    const m = /^(\s*)([^=|]+?)(\s*)=(.*)$/s.exec(part);
    if (!m) return part;
    const [, ws1, name, ws2, rest] = m;
    if (name!.trim().toLowerCase() !== oldN.toLowerCase()) return part;
    return `${ws1}${newN}${ws2}=${rest}`;
  });
  return renamed.join("|");
}

export function isStubTemplateName(name: string): boolean {
  const n = templateName(name);
  return /\bstub$/i.test(n.trim());
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
