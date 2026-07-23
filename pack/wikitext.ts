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

function templateNamesMatch(written: string, want: string): boolean {
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

  // Split on first-level pipes (depth of {{ }}).
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
