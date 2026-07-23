import type { GraphPortSpec, NodeSpec, NodeSpecRegistry } from "@nodish/core";
import { WikiTitle } from "../src/wiki/title.ts";
import { asString, categoryName, normName, templateName } from "./coerce.ts";
import {
  contentHasCategory,
  contentHasTemplate,
  findCategories,
  findTemplates,
  findWikilinks,
  formatWikilink,
  isStubTemplateName,
  renameFirstLevelParams,
  writeTemplateName,
} from "./wikitext.ts";

const MW_COLOR = "#3d8bfd";
const GROUP = ["MediaWiki"];

const titleOrString: GraphPortSpec = {
  type: "string" as const,
  types: ["mwn/title", "string"] as string[],
};

function requireContent(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected string content");
  }
  return value;
}

function replaceSpans(
  content: string,
  replacements: Array<{ start: number; end: number; text: string }>,
): string {
  const ordered = [...replacements].sort((a, b) => b.start - a.start);
  let out = content;
  for (const r of ordered) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

function renameTemplateInContent(
  content: string,
  oldT: unknown,
  newT: unknown,
): string {
  const want = templateName(oldT);
  const next = writeTemplateName(templateName(newT));
  const hits = findTemplates(content).filter(
    (t) => normName(templateName(t.name)) === normName(want),
  );
  return replaceSpans(
    content,
    hits.map((t) => {
      const pipe = t.inner.indexOf("|");
      const rest = pipe === -1 ? "" : t.inner.slice(pipe);
      const namePart = pipe === -1 ? t.inner : t.inner.slice(0, pipe);
      const leading = /^\s*/.exec(namePart)?.[0] ?? "";
      const trailing = pipe === -1 ? (/\s*$/.exec(namePart)?.[0] ?? "") : "";
      const inner = `${leading}${next}${trailing}${rest}`;
      return { start: t.start, end: t.end, text: `{{${inner}}}` };
    }),
  );
}

function renameTemplateParamInContent(
  content: string,
  template: unknown,
  oldParam: unknown,
  newParam: unknown,
): string {
  const want = templateName(template);
  const oldP = asString(oldParam);
  const newP = asString(newParam);
  const hits = findTemplates(content).filter(
    (t) => normName(templateName(t.name)) === normName(want),
  );
  return replaceSpans(
    content,
    hits.map((t) => ({
      start: t.start,
      end: t.end,
      text: `{{${renameFirstLevelParams(t.inner, oldP, newP)}}}`,
    })),
  );
}

function addCategoryToContent(content: string, category: unknown): string {
  if (contentHasCategory(content, category)) return content;
  const name = categoryName(category);
  const link = `[[Category:${name}]]`;
  const stubs = findTemplates(content).filter((t) =>
    isStubTemplateName(t.name),
  );
  if (stubs.length === 0) {
    const trimmed = content.replace(/\s*$/, "");
    return `${trimmed}\n${link}\n`;
  }
  const firstStub = Math.min(...stubs.map((t) => t.start));
  const before = content.slice(0, firstStub).replace(/\s*$/, "");
  const after = content.slice(firstStub);
  return `${before}\n${link}\n${after}`;
}

function removeCategoryFromContent(content: string, category: unknown): string {
  const want = normName(categoryName(category));
  const hits = findCategories(content).filter((c) => normName(c.name) === want);
  if (hits.length === 0) return content;
  let out = replaceSpans(
    content,
    hits.map((h) => ({ start: h.start, end: h.end, text: "" })),
  );
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return out;
}

/** Rewrite [[Category:from…]] → [[Category:to…]], keeping sort keys; drop duplicate `to`. */
function replaceCategoryInContent(
  content: string,
  from: unknown,
  to: unknown,
): string {
  const fromName = normName(categoryName(from));
  const toName = categoryName(to);
  if (!fromName || !toName) return content;
  if (fromName === normName(toName)) return content;

  const hits = findCategories(content).filter(
    (c) => normName(c.name) === fromName,
  );
  if (hits.length === 0) return content;

  let out = replaceSpans(
    content,
    hits.map((h) => {
      const sortMatch = /\|([^\]]*)\]\]\s*$/.exec(h.raw);
      const sortPart = sortMatch ? `|${sortMatch[1]}` : "";
      return {
        start: h.start,
        end: h.end,
        text: `[[Category:${toName}${sortPart}]]`,
      };
    }),
  );

  const toHits = findCategories(out).filter(
    (c) => normName(c.name) === normName(toName),
  );
  if (toHits.length > 1) {
    out = replaceSpans(
      out,
      toHits.slice(1).map((h) => ({ start: h.start, end: h.end, text: "" })),
    );
    out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  }
  return out;
}

function linkTargetName(value: unknown): string {
  return asString(value).replace(/_/g, " ").trim();
}

/**
 * Retarget free wikilinks from → to.
 * replaceOn false: [[Foo]]→[[Baz|Foo]], [[Foo|Bar]]→[[Baz|Bar]]
 * replaceOn true:  [[Foo]]→[[Baz]],     [[Foo|Bar]]→[[Baz|Bar]]
 */
function retargetWikilinksInContent(
  content: string,
  from: unknown,
  to: unknown,
  replaceOn: boolean,
): string {
  const want = normName(linkTargetName(from));
  const next = linkTargetName(to);
  if (!want || !next) return content;

  const hits = findWikilinks(content).filter(
    (h) => normName(h.target) === want,
  );
  if (hits.length === 0) return content;

  return replaceSpans(
    content,
    hits.map((h) => {
      let label = h.label;
      if (label == null && !replaceOn) {
        label = h.target;
      } else if (label == null && replaceOn) {
        label = null;
      }
      // If replaceOn and label equals new target, drop the pipe.
      if (
        replaceOn &&
        label != null &&
        normName(label) === normName(next)
      ) {
        label = null;
      }
      return {
        start: h.start,
        end: h.end,
        text: formatWikilink(next, h.fragment, label),
      };
    }),
  );
}

/** Turn [[Foo]] / [[Foo|Bar]] into Foo / Bar (skips Category/File links). */
function unlinkWikilinksInContent(content: string, target: unknown): string {
  const want = normName(linkTargetName(target));
  if (!want) return content;
  const hits = findWikilinks(content).filter(
    (h) => normName(h.target) === want,
  );
  if (hits.length === 0) return content;
  return replaceSpans(
    content,
    hits.map((h) => ({
      start: h.start,
      end: h.end,
      text: h.label != null ? h.label : h.target,
    })),
  );
}

type LeadKind =
  | "shortDesc"
  | "displayTitle"
  | "hatnote"
  | "status"
  | "deletion"
  | "maintenance"
  | "engvar"
  | "infobox"
  | "langMaint"
  | "otherLead";

type TrailerKind =
  | "taxonbar"
  | "authority"
  | "coord"
  | "defaultsort"
  | "category"
  | "catMaint"
  | "stub"
  | "otherTrailer";

const LEAD_ORDER: LeadKind[] = [
  "shortDesc",
  "displayTitle",
  "hatnote",
  "status",
  "deletion",
  "maintenance",
  "engvar",
  "infobox",
  "langMaint",
  "otherLead",
];

const TRAILER_ORDER: TrailerKind[] = [
  "taxonbar",
  "authority",
  "coord",
  "defaultsort",
  "category",
  "catMaint",
  "otherTrailer",
  "stub",
];

const HATNOTES = new Set(
  [
    "about",
    "distinguish",
    "for",
    "other uses",
    "other uses of",
    "redirect",
    "redirect-multi",
    "see also",
    "hatnote",
  ].map((s) => s.toLowerCase()),
);

const DISPLAY_TITLE = new Set(
  [
    "displaytitle",
    "lowercase title",
    "italic title",
    "italic disambiguation",
  ].map((s) => s.toLowerCase()),
);

const STATUS = new Set(
  ["featured list", "featured article", "good article"].map((s) =>
    s.toLowerCase(),
  ),
);

const ENGVAR = new Set(
  [
    "use dmy dates",
    "use mdy dates",
    "use british english",
    "use american english",
    "use canadian english",
    "use australian english",
    "use indian english",
    "use list-defined references",
    "use shortened footnotes",
    "cs1 config",
    "force cite load",
  ].map((s) => s.toLowerCase()),
);

function classifyLeadTemplate(name: string): LeadKind {
  const n = normName(templateName(name));
  if (n === "short description" || n === "shortdescription") return "shortDesc";
  if (DISPLAY_TITLE.has(n)) return "displayTitle";
  if (HATNOTES.has(n) || n.startsWith("other uses")) return "hatnote";
  if (STATUS.has(n)) return "status";
  if (
    n.startsWith("db-") ||
    n.startsWith("pp-") ||
    n.includes("deletion") ||
    n === "prod" ||
    n.startsWith("afd")
  ) {
    return "deletion";
  }
  if (ENGVAR.has(n) || n.startsWith("use ")) return "engvar";
  if (n.startsWith("infobox") || n.includes("infobox")) return "infobox";
  if (n.includes("english") && n.includes("variety")) return "langMaint";
  return "maintenance";
}

function classifyTrailerTemplate(name: string): TrailerKind {
  const n = normName(templateName(name));
  if (n === "taxonbar") return "taxonbar";
  if (n === "authority control") return "authority";
  if (n === "coord" || n === "coord missing" || n.startsWith("coord ")) {
    return "coord";
  }
  if (n === "defaultsort" || n.startsWith("defaultsort")) return "defaultsort";
  if (n === "improve categories" || n === "uncategorized") return "catMaint";
  if (isStubTemplateName(name)) return "stub";
  return "otherTrailer";
}

function isMagicDefaultsort(line: string): boolean {
  return /^\s*\{\{\s*DEFAULTSORT\s*:/i.test(line);
}

function isSubstantialProse(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith("{{") || t.startsWith("[[")) return false;
  if (t.startsWith("<!--")) return false;
  if (t.startsWith("==")) return false;
  if (t.startsWith("{|") || t.startsWith("|") || t.startsWith("!"))
    return false;
  return /[A-Za-z]{3,}/.test(t);
}

type Block = { text: string; kind: string };

function braceDepthDelta(line: string): number {
  const opens = line.match(/\{\{/g)?.length ?? 0;
  const closes = line.match(/\}\}/g)?.length ?? 0;
  return opens - closes;
}

function collectMultilineTemplate(
  lines: string[],
  endIdx: number,
): { start: number; chunk: string } | null {
  let start = endIdx;
  while (start >= 0) {
    const chunk = lines.slice(start, endIdx + 1).join("\n");
    const covering = findTemplates(chunk).find(
      (t) => t.start === 0 && chunk.slice(t.end).trim() === "",
    );
    if (covering) return { start, chunk };
    if (start === 0) return null;
    start -= 1;
  }
  return null;
}

function orderArticle(content: string): string {
  const lines = content.split("\n");
  const leadBlocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    if (isSubstantialProse(line)) break;

    if (trimmed.startsWith("{{") && !trimmed.startsWith("{{{")) {
      const start = i;
      let depth = braceDepthDelta(line);
      i += 1;
      while (i < lines.length && depth > 0) {
        depth += braceDepthDelta(lines[i]!);
        i += 1;
      }
      const chunk = lines.slice(start, i).join("\n");
      const name =
        findTemplates(chunk)[0]?.name ??
        chunk
          .replace(/^\{\{\s*/, "")
          .split(/[|}\n]/)[0]!
          .trim();
      if (isStubTemplateName(name) || findCategories(chunk).length > 0) {
        i = start;
        break;
      }
      if (isMagicDefaultsort(trimmed) || /^\{\{\s*DEFAULTSORT/i.test(trimmed)) {
        i = start;
        break;
      }
      leadBlocks.push({ text: chunk, kind: classifyLeadTemplate(name) });
      continue;
    }

    if (
      /^\[\[\s*[Cc]ategory\s*:/.test(trimmed) ||
      isMagicDefaultsort(trimmed)
    ) {
      break;
    }

    if (trimmed.startsWith("__")) {
      leadBlocks.push({ text: line, kind: "otherLead" });
      i += 1;
      continue;
    }
    break;
  }

  const restLines = lines.slice(i);
  const trailerBlocks: Block[] = [];
  let j = restLines.length - 1;

  while (j >= 0) {
    const line = restLines[j]!;
    const trimmed = line.trim();
    if (!trimmed) {
      j -= 1;
      continue;
    }

    if (/^\[\[\s*[Cc]ategory\s*:/.test(trimmed)) {
      trailerBlocks.unshift({ text: line, kind: "category" });
      j -= 1;
      continue;
    }

    if (isMagicDefaultsort(trimmed) || /^\{\{\s*DEFAULTSORT/i.test(trimmed)) {
      trailerBlocks.unshift({ text: line, kind: "defaultsort" });
      j -= 1;
      continue;
    }

    if (!trimmed.includes("}}")) break;

    const collected = collectMultilineTemplate(restLines, j);
    if (!collected) break;

    const tmpl = findTemplates(collected.chunk).find(
      (t) => t.start === 0 && collected.chunk.slice(t.end).trim() === "",
    );
    if (!tmpl) break;

    const kind = classifyTrailerTemplate(tmpl.name);
    const n = normName(templateName(tmpl.name));
    const isTrailer =
      kind !== "otherTrailer" ||
      isStubTemplateName(tmpl.name) ||
      n === "taxonbar" ||
      n === "authority control" ||
      n.startsWith("coord");

    if (!isTrailer) break;

    trailerBlocks.unshift({ text: collected.chunk, kind });
    j = collected.start - 1;
  }

  const bodyLines = restLines.slice(0, j + 1);
  while (bodyLines.length && !bodyLines[bodyLines.length - 1]!.trim()) {
    bodyLines.pop();
  }

  const leadOut: string[] = [];
  for (const kind of LEAD_ORDER) {
    for (const b of leadBlocks) {
      if (b.kind === kind) leadOut.push(b.text);
    }
  }

  const trailerOut: string[] = [];
  for (const kind of TRAILER_ORDER) {
    for (const b of trailerBlocks) {
      if (b.kind === kind) trailerOut.push(b.text);
    }
  }

  const stubIdx = trailerOut.findIndex((t) => {
    const n = findTemplates(t)[0]?.name;
    return n ? isStubTemplateName(n) : false;
  });

  let parts: string[];
  if (stubIdx > 0) {
    parts = [
      ...leadOut,
      ...bodyLines,
      ...trailerOut.slice(0, stubIdx),
      "",
      ...trailerOut.slice(stubIdx),
    ];
  } else {
    parts = [...leadOut, ...bodyLines, ...trailerOut];
  }

  return parts
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "\n");
}

const stringToTitle: NodeSpec = {
  typeId: "mwn/string-to-title",
  displayName: "String to Title",
  description: "Parse a string into an mwn/title (requires siteinfo / login).",
  color: MW_COLOR,
  group: GROUP,
  inputs: {
    text: { type: "string" },
  },
  outputs: {
    title: { type: "mwn/title" },
  },
  execute: (inputs) => {
    const text = asString(inputs.text).trim();
    if (!text) throw new Error("Empty title string");
    try {
      return { title: new WikiTitle(text) };
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Unable to parse title",
      );
    }
  },
};

const inCategory: NodeSpec = {
  typeId: "mwn/in-category",
  displayName: "In Category",
  description:
    "True if the wikitext already contains [[Category:…]] for the given category.",
  color: MW_COLOR,
  group: GROUP,
  inputs: {
    content: { type: "string" },
    category: titleOrString,
  },
  outputs: {
    result: { type: "boolean" },
  },
  execute: (inputs) => ({
    result: contentHasCategory(requireContent(inputs.content), inputs.category),
  }),
};

const hasTemplate: NodeSpec = {
  typeId: "mwn/has-template",
  displayName: "Has Template",
  description:
    "True if the wikitext transcludes the given template (local scan).",
  color: MW_COLOR,
  group: GROUP,
  inputs: {
    content: { type: "string" },
    template: titleOrString,
  },
  outputs: {
    result: { type: "boolean" },
  },
  execute: (inputs) => ({
    result: contentHasTemplate(requireContent(inputs.content), inputs.template),
  }),
};

const renameTemplate: NodeSpec = {
  typeId: "mwn/rename-template",
  displayName: "Rename Template",
  description:
    "Rename template invocations in wikitext. Template: prefix is omitted in output.",
  color: MW_COLOR,
  group: GROUP,
  inputs: {
    content: { type: "string" },
    oldTemplate: titleOrString,
    newTemplate: titleOrString,
  },
  outputs: {
    content: { type: "string" },
  },
  execute: (inputs) => ({
    content: renameTemplateInContent(
      requireContent(inputs.content),
      inputs.oldTemplate,
      inputs.newTemplate,
    ),
  }),
};

const renameTemplateParam: NodeSpec = {
  typeId: "mwn/rename-template-param",
  displayName: "Rename Template Parameter",
  description: "Rename a named parameter inside matching template invocations.",
  color: MW_COLOR,
  group: GROUP,
  inputs: {
    content: { type: "string" },
    template: titleOrString,
    oldParameter: { type: "string" },
    newParameter: { type: "string" },
  },
  outputs: {
    content: { type: "string" },
  },
  execute: (inputs) => ({
    content: renameTemplateParamInContent(
      requireContent(inputs.content),
      inputs.template,
      inputs.oldParameter,
      inputs.newParameter,
    ),
  }),
};

const addCategory: NodeSpec = {
  typeId: "mwn/add-category",
  displayName: "Add Category",
  description:
    "Append [[Category:…]] only if that category is not already present (before stub templates when present).",
  color: MW_COLOR,
  group: GROUP,
  inputs: {
    content: { type: "string" },
    category: titleOrString,
  },
  outputs: {
    content: { type: "string" },
  },
  execute: (inputs) => ({
    content: addCategoryToContent(
      requireContent(inputs.content),
      inputs.category,
    ),
  }),
};

const removeCategory: NodeSpec = {
  typeId: "mwn/remove-category",
  displayName: "Remove Category",
  description: "Remove matching [[Category:…]] links from wikitext.",
  color: MW_COLOR,
  group: GROUP,
  inputs: {
    content: { type: "string" },
    category: titleOrString,
  },
  outputs: {
    content: { type: "string" },
  },
  execute: (inputs) => ({
    content: removeCategoryFromContent(
      requireContent(inputs.content),
      inputs.category,
    ),
  }),
};

const replaceCategory: NodeSpec = {
  typeId: "mwn/replace-category",
  displayName: "Replace Category",
  description:
    "Replace [[Category:from]] with [[Category:to]] (keeps sort keys; dedupes target).",
  color: MW_COLOR,
  group: GROUP,
  inputs: {
    content: { type: "string" },
    from: titleOrString,
    to: titleOrString,
  },
  outputs: {
    content: { type: "string" },
  },
  execute: (inputs) => ({
    content: replaceCategoryInContent(
      requireContent(inputs.content),
      inputs.from,
      inputs.to,
    ),
  }),
};

const retargetWikilink: NodeSpec = {
  typeId: "mwn/retarget-wikilink",
  displayName: "Retarget Wikilink",
  description:
    "Change free wikilink targets. Off: [[Foo]]→[[Baz|Foo]]. On (replace on): [[Foo]]→[[Baz]]. Piped labels are kept. Skips Category/File links.",
  color: MW_COLOR,
  group: GROUP,
  inputs: {
    content: { type: "string" },
    from: titleOrString,
    to: titleOrString,
    replaceOn: { type: "boolean", defaultValue: false },
  },
  outputs: {
    content: { type: "string" },
  },
  execute: (inputs) => ({
    content: retargetWikilinksInContent(
      requireContent(inputs.content),
      inputs.from,
      inputs.to,
      Boolean(inputs.replaceOn),
    ),
  }),
};

const unlinkWikilink: NodeSpec = {
  typeId: "mwn/unlink-wikilink",
  displayName: "Unlink Wikilink",
  description:
    "Replace matching free wikilinks with their visible text ([[Foo]]→Foo, [[Foo|Bar]]→Bar). Skips Category/File links.",
  color: MW_COLOR,
  group: GROUP,
  inputs: {
    content: { type: "string" },
    target: titleOrString,
  },
  outputs: {
    content: { type: "string" },
  },
  execute: (inputs) => ({
    content: unlinkWikilinksInContent(
      requireContent(inputs.content),
      inputs.target,
    ),
  }),
};

const orderArticleNode: NodeSpec = {
  typeId: "mwn/order-article",
  displayName: "Order Article",
  description:
    "Naive MOS layout reorder of lead templates and trailer (cats/stubs/etc.).",
  color: MW_COLOR,
  group: GROUP,
  inputs: {
    content: { type: "string" },
  },
  outputs: {
    content: { type: "string" },
  },
  execute: (inputs) => ({
    content: orderArticle(requireContent(inputs.content)),
  }),
};

export const mediaWikiNodes: NodeSpecRegistry = {
  [stringToTitle.typeId]: stringToTitle,
  [inCategory.typeId]: inCategory,
  [hasTemplate.typeId]: hasTemplate,
  [renameTemplate.typeId]: renameTemplate,
  [renameTemplateParam.typeId]: renameTemplateParam,
  [addCategory.typeId]: addCategory,
  [removeCategory.typeId]: removeCategory,
  [replaceCategory.typeId]: replaceCategory,
  [retargetWikilink.typeId]: retargetWikilink,
  [unlinkWikilink.typeId]: unlinkWikilink,
  [orderArticleNode.typeId]: orderArticleNode,
};
