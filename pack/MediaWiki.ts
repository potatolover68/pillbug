import type { GraphPortSpec, NodeSpec, NodeSpecRegistry } from "@nodish/core";
import { WikiTitle } from "../src/wiki/title.ts";
import { asString, categoryName, normName, templateName } from "./coerce.ts";
import {
  isTemplates,
  requireSingularTemplate,
  requireTemplates,
  TEMPLATES_TYPE,
} from "./Templates.ts";
import {
  applyTemplatesToContent,
  assertRootTemplateList,
  contentHasCategory,
  contentHasTemplate,
  filterTemplatesByName,
  findCategories,
  findTemplates,
  findTemplatesByNameDeep,
  findWikilinks,
  formatWikilink,
  getNthTemplate,
  getTemplateParameter,
  indentTemplate,
  indentTemplates,
  isStubTemplateName,
  joinTemplates,
  mapAllTemplates,
  mapTemplatesByName,
  mapTemplatesInContent,
  removeTemplateParameter,
  removeTemplatesFromContent,
  renameTemplateParameterKey,
  setTemplateName,
  setTemplateParameter,
  sliceTemplates,
  templateHasParameter,
  templatesFromContent,
  writeTemplateName,
  type Template,
} from "./wikitext.ts";
import { replaceDeprecatedParametersInContent } from "./deprecatedParams.ts";
import { fetchPageContents } from "./pageContents.ts";
import { applyAwbTypos } from "./typos.ts";

const MW_COLOR = "#3d8bfd";
const GROUP_FIND = ["MediaWiki", "templates", "find"];
const GROUP_COLLECTION = ["MediaWiki", "templates", "collection"];
const GROUP_PARAMS = ["MediaWiki", "templates", "parameters"];
const GROUP_EDIT = ["MediaWiki", "templates", "edit"];
const GROUP_CATEGORIES = ["MediaWiki", "categories"];
const GROUP_WIKILINKS = ["MediaWiki", "wikilinks"];
const GROUP_TITLE = ["MediaWiki", "title"];
const GROUP_PAGE = ["MediaWiki", "page"];
const GROUP_TEXT = ["MediaWiki", "text"];

const titleOrString: GraphPortSpec = {
  type: "string" as const,
  types: ["wiki/title", "string"] as string[],
};

/** Content string or Templates collection (same kind in → same kind out). */
const contentOrTemplates: GraphPortSpec = {
  type: "string" as const,
  types: ["string", TEMPLATES_TYPE] as string[],
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
  return mapTemplatesInContent(content, want, (t) => setTemplateName(t, next));
}

function renameTemplatesCollection(
  templates: Template[],
  oldT: unknown,
  newT: unknown,
): Template[] {
  const want = templateName(oldT);
  return mapTemplatesByName(templates, want, (t) => setTemplateName(t, newT));
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
  return mapTemplatesInContent(content, want, (t) =>
    renameTemplateParameterKey(t, oldP, newP),
  );
}

function asContentOrTemplates(
  value: unknown,
):
  | { kind: "content"; content: string }
  | { kind: "templates"; templates: Template[] } {
  if (typeof value === "string") return { kind: "content", content: value };
  if (isTemplates(value)) return { kind: "templates", templates: value };
  throw new Error("Expected string content or wiki/templates");
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
      if (replaceOn && label != null && normName(label) === normName(next)) {
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
  typeId: "wiki/string-to-title",
  displayName: "String to Title",
  description: "Parse a string into a wiki/title (requires siteinfo / login).",
  color: MW_COLOR,
  group: GROUP_TITLE,
  inputs: {
    text: { type: "string" },
  },
  outputs: {
    title: { type: "wiki/title" },
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
  typeId: "wiki/in-category",
  displayName: "In Category",
  description:
    "True if the wikitext already contains [[Category:…]] for the given category.",
  color: MW_COLOR,
  group: GROUP_CATEGORIES,
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

const contentHasTemplateNode: NodeSpec = {
  typeId: "wiki/content-has-template",
  displayName: "Content Has Template",
  description:
    "True if wikitext contains a {{…}} invocation matching the template name (searches nested templates).",
  color: MW_COLOR,
  group: GROUP_FIND,
  inputs: {
    content: { type: "string" },
    name: titleOrString,
  },
  outputs: {
    result: { type: "boolean" },
  },
  execute: (inputs) => ({
    result: contentHasTemplate(requireContent(inputs.content), inputs.name),
  }),
};

const renameTemplate: NodeSpec = {
  typeId: "wiki/rename-template",
  displayName: "Rename Template",
  description:
    "Rename matching {{Old}} → {{New}} at any depth. Accepts content (returns content) or Templates (returns Templates).",
  color: MW_COLOR,
  group: GROUP_EDIT,
  inputs: {
    source: contentOrTemplates,
    oldName: titleOrString,
    newName: titleOrString,
  },
  outputs: {
    result: contentOrTemplates,
  },
  execute: (inputs) => {
    const source = asContentOrTemplates(inputs.source);
    if (source.kind === "content") {
      return {
        result: renameTemplateInContent(
          source.content,
          inputs.oldName,
          inputs.newName,
        ),
      };
    }
    return {
      result: renameTemplatesCollection(
        source.templates,
        inputs.oldName,
        inputs.newName,
      ),
    };
  },
};

const renameParameter: NodeSpec = {
  typeId: "wiki/rename-parameter",
  displayName: "Rename Parameter",
  description:
    "Rename a named parameter key (deep). On content, only invocations matching template name are updated. On Templates, empty template name → all nodes.",
  color: MW_COLOR,
  group: GROUP_PARAMS,
  inputs: {
    source: contentOrTemplates,
    template: titleOrString,
    oldParameter: { type: "string" },
    newParameter: { type: "string" },
  },
  outputs: {
    result: contentOrTemplates,
  },
  execute: (inputs) => {
    const source = asContentOrTemplates(inputs.source);
    if (source.kind === "content") {
      return {
        result: renameTemplateParamInContent(
          source.content,
          inputs.template,
          inputs.oldParameter,
          inputs.newParameter,
        ),
      };
    }
    const filterName = asString(inputs.template).trim();
    const oldP = asString(inputs.oldParameter);
    const newP = asString(inputs.newParameter);
    if (!filterName) {
      return {
        result: mapAllTemplates(source.templates, (t) =>
          renameTemplateParameterKey(t, oldP, newP),
        ),
      };
    }
    return {
      result: mapTemplatesByName(source.templates, filterName, (t) =>
        renameTemplateParameterKey(t, oldP, newP),
      ),
    };
  },
};

const replaceDeprecatedParameters: NodeSpec = {
  typeId: "wiki/replace-deprecated-parameters",
  displayName: "Replace Deprecated Parameters",
  description:
    "Fetch and cache a template's #invoke:Check for deprecated parameters rules, then apply the relevant fixes to parameters to that template.",
  color: MW_COLOR,
  group: GROUP_PARAMS,
  inputs: {
    title: titleOrString,
    content: { type: "string" },
    fixindent: {
      type: "boolean",
      userOnly: true,
      defaultValue: false,
    },
  },
  outputs: {
    contentAfter: { type: "string" },
  },
  execute: (inputs) => ({
    contentAfter: replaceDeprecatedParametersInContent(
      inputs.title,
      requireContent(inputs.content),
      inputs.fixindent === true,
    ),
  }),
};

const addCategory: NodeSpec = {
  typeId: "wiki/add-category",
  displayName: "Add Category",
  description:
    "Append [[Category:…]] only if that category is not already present (before stub templates when present).",
  color: MW_COLOR,
  group: GROUP_CATEGORIES,
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
  typeId: "wiki/remove-category",
  displayName: "Remove Category",
  description: "Remove matching [[Category:…]] links from wikitext.",
  color: MW_COLOR,
  group: GROUP_CATEGORIES,
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
  typeId: "wiki/replace-category",
  displayName: "Replace Category",
  description:
    "Replace [[Category:from]] with [[Category:to]] (keeps sort keys; dedupes target).",
  color: MW_COLOR,
  group: GROUP_CATEGORIES,
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
  typeId: "wiki/retarget-wikilink",
  displayName: "Retarget Wikilink",
  description:
    "Change free wikilink targets. Off: [[Foo]]→[[Baz|Foo]]. On (replace on): [[Foo]]→[[Baz]]. Piped labels are kept. Skips Category/File links.",
  color: MW_COLOR,
  group: GROUP_WIKILINKS,
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
  typeId: "wiki/unlink-wikilink",
  displayName: "Unlink Wikilink",
  description:
    "Replace matching free wikilinks with their visible text ([[Foo]]→Foo, [[Foo|Bar]]→Bar). Skips Category/File links.",
  color: MW_COLOR,
  group: GROUP_WIKILINKS,
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
  typeId: "wiki/order-article",
  displayName: "Order Article",
  description:
    "Naive MOS layout reorder of lead templates and trailer (cats/stubs/etc.).",
  color: MW_COLOR,
  group: GROUP_PAGE,
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

const getPageContents: NodeSpec = {
  typeId: "wiki/get-page-contents",
  displayName: "Get Page Contents",
  description:
    "Fetch wikitext for a title (or string). Missing pages yield empty content and exists=false. Uses a blocking wiki read (graph execute is sync).",
  color: MW_COLOR,
  group: GROUP_PAGE,
  inputs: {
    title: titleOrString,
  },
  outputs: {
    content: { type: "string" },
    exists: { type: "boolean" },
  },
  execute: (inputs) => {
    const raw = asString(inputs.title).trim();
    if (!raw) {
      return { content: "", exists: false };
    }
    let titleText = raw;
    try {
      titleText = new WikiTitle(raw).getPrefixedText();
    } catch {
      // Siteinfo may be unloaded; fall back to the raw string.
    }
    const result = fetchPageContents(titleText);
    return { content: result.content, exists: result.exists };
  },
};

const parseTemplates: NodeSpec = {
  typeId: "wiki/parse-templates",
  displayName: "Parse Templates From Content",
  description:
    "Parse top-level {{…}} invocations into a Templates forest (nested templates live inside param values).",
  color: MW_COLOR,
  group: GROUP_FIND,
  inputs: {
    content: { type: "string" },
  },
  outputs: {
    result: { type: TEMPLATES_TYPE },
  },
  execute: (inputs) => ({
    result: templatesFromContent(requireContent(inputs.content)),
  }),
};

const findTemplatesByNameInContent: NodeSpec = {
  typeId: "wiki/find-templates-by-name",
  displayName: "Find Templates By Name In Content",
  description:
    "Deep-find matching {{…}} nodes (including nested). For edits prefer map-templates-by-name; Apply expects root spans only.",
  color: MW_COLOR,
  group: GROUP_FIND,
  inputs: {
    content: { type: "string" },
    name: titleOrString,
  },
  outputs: {
    result: { type: TEMPLATES_TYPE },
  },
  execute: (inputs) => ({
    result: findTemplatesByNameDeep(
      requireContent(inputs.content),
      inputs.name,
    ),
  }),
};

const filterTemplatesByNameNode: NodeSpec = {
  typeId: "wiki/filter-templates-by-name",
  displayName: "Filter Templates By Name",
  description: "Keep items in a Templates collection whose name matches.",
  color: MW_COLOR,
  group: GROUP_FIND,
  inputs: {
    templates: { type: TEMPLATES_TYPE },
    name: titleOrString,
  },
  outputs: {
    result: { type: TEMPLATES_TYPE },
  },
  execute: (inputs) => ({
    result: filterTemplatesByName(
      requireTemplates(inputs.templates),
      inputs.name,
    ),
  }),
};

const sliceTemplatesNode: NodeSpec = {
  typeId: "wiki/slice-templates",
  displayName: "Slice Templates",
  description: "1-based inclusive slice (n…m) of a Templates collection.",
  color: MW_COLOR,
  group: GROUP_COLLECTION,
  inputs: {
    templates: { type: TEMPLATES_TYPE },
    n: { type: "number", defaultValue: 1 },
    m: { type: "number", defaultValue: 1 },
  },
  outputs: {
    result: { type: TEMPLATES_TYPE },
  },
  execute: (inputs) => ({
    result: sliceTemplates(
      requireTemplates(inputs.templates),
      Number(inputs.n),
      Number(inputs.m),
    ),
  }),
};

const getNthTemplateNode: NodeSpec = {
  typeId: "wiki/get-nth-template",
  displayName: "Get Nth Template",
  description:
    "1-based: return a Templates collection with only the nth item (empty if out of range).",
  color: MW_COLOR,
  group: GROUP_COLLECTION,
  inputs: {
    templates: { type: TEMPLATES_TYPE },
    n: { type: "number", defaultValue: 1 },
  },
  outputs: {
    result: { type: TEMPLATES_TYPE },
  },
  execute: (inputs) => ({
    result: getNthTemplate(
      requireTemplates(inputs.templates),
      Number(inputs.n),
    ),
  }),
};

const joinTemplatesNode: NodeSpec = {
  typeId: "wiki/join-templates",
  displayName: "Join Templates",
  description: "Concatenate two Templates collections (a then b).",
  color: MW_COLOR,
  group: GROUP_COLLECTION,
  inputs: {
    a: { type: TEMPLATES_TYPE },
    b: { type: TEMPLATES_TYPE },
  },
  outputs: {
    result: { type: TEMPLATES_TYPE },
  },
  execute: (inputs) => ({
    result: joinTemplates(
      requireTemplates(inputs.a),
      requireTemplates(inputs.b),
    ),
  }),
};

const countTemplates: NodeSpec = {
  typeId: "wiki/count-templates",
  displayName: "Count Templates",
  description: "Number of items in a Templates collection.",
  color: MW_COLOR,
  group: GROUP_COLLECTION,
  inputs: {
    templates: { type: TEMPLATES_TYPE },
  },
  outputs: {
    result: { type: "number" },
  },
  execute: (inputs) => ({
    result: requireTemplates(inputs.templates).length,
  }),
};

const getTemplateName: NodeSpec = {
  typeId: "wiki/get-template-name",
  displayName: "Get Template Name",
  description:
    "Name of the sole template. Errors if the Templates collection is not length 1.",
  color: MW_COLOR,
  group: GROUP_FIND,
  inputs: {
    templates: { type: TEMPLATES_TYPE },
  },
  outputs: {
    result: { type: "string" },
  },
  execute: (inputs) => ({
    result: requireSingularTemplate(inputs.templates).name,
  }),
};

const getParameter: NodeSpec = {
  typeId: "wiki/get-parameter",
  displayName: "Get Parameter",
  description:
    'Parameter value from the sole template (named key or positional "1"). Errors if Templates is not length 1. Missing → empty string.',
  color: MW_COLOR,
  group: GROUP_PARAMS,
  inputs: {
    templates: { type: TEMPLATES_TYPE },
    parameter: { type: "string" },
  },
  outputs: {
    result: { type: "string" },
  },
  execute: (inputs) => ({
    result: getTemplateParameter(
      requireSingularTemplate(inputs.templates),
      asString(inputs.parameter),
    ),
  }),
};

const removeParameter: NodeSpec = {
  typeId: "wiki/remove-parameter",
  displayName: "Remove Parameter",
  description:
    "Remove a named or positional parameter from each template in the collection.",
  color: MW_COLOR,
  group: GROUP_PARAMS,
  inputs: {
    templates: { type: TEMPLATES_TYPE },
    parameter: { type: "string" },
  },
  outputs: {
    result: { type: TEMPLATES_TYPE },
  },
  execute: (inputs) => {
    const parameter = asString(inputs.parameter);
    return {
      result: requireTemplates(inputs.templates).map((t) =>
        removeTemplateParameter(t, parameter),
      ),
    };
  },
};

const setParameter: NodeSpec = {
  typeId: "wiki/set-parameter",
  displayName: "Set Parameter",
  description:
    "Set or add a named/positional parameter on each template in the collection.",
  color: MW_COLOR,
  group: GROUP_PARAMS,
  inputs: {
    templates: { type: TEMPLATES_TYPE },
    parameter: { type: "string" },
    value: { type: "string" },
  },
  outputs: {
    result: { type: TEMPLATES_TYPE },
  },
  execute: (inputs) => {
    const parameter = asString(inputs.parameter);
    const value = asString(inputs.value);
    return {
      result: requireTemplates(inputs.templates).map((t) =>
        setTemplateParameter(t, parameter, value),
      ),
    };
  },
};

const hasParameter: NodeSpec = {
  typeId: "wiki/has-parameter",
  displayName: "Has Parameter",
  description:
    "True if any template in the collection has the given parameter.",
  color: MW_COLOR,
  group: GROUP_PARAMS,
  inputs: {
    templates: { type: TEMPLATES_TYPE },
    parameter: { type: "string" },
  },
  outputs: {
    result: { type: "boolean" },
  },
  execute: (inputs) => {
    const parameter = asString(inputs.parameter);
    return {
      result: requireTemplates(inputs.templates).some((t) =>
        templateHasParameter(t, parameter),
      ),
    };
  },
};

const indentTemplatesNode: NodeSpec = {
  typeId: "wiki/indent-templates",
  displayName: "Indent Templates",
  description:
    "Reformat each template to multi-line indented wikitext (aligned | name = value).",
  color: MW_COLOR,
  group: GROUP_EDIT,
  inputs: {
    templates: { type: TEMPLATES_TYPE },
  },
  outputs: {
    result: { type: TEMPLATES_TYPE },
  },
  execute: (inputs) => ({
    result: indentTemplates(requireTemplates(inputs.templates)),
  }),
};

const applyTemplates: NodeSpec = {
  typeId: "wiki/apply-templates",
  displayName: "Apply Templates To Content",
  description:
    "Write root Templates back into content (recursive serialize). Errors if the list mixes nested spans with their parents.",
  color: MW_COLOR,
  group: GROUP_EDIT,
  inputs: {
    content: { type: "string" },
    templates: { type: TEMPLATES_TYPE },
  },
  outputs: {
    content: { type: "string" },
  },
  execute: (inputs) => ({
    content: applyTemplatesToContent(
      requireContent(inputs.content),
      requireTemplates(inputs.templates),
    ),
  }),
};

const mapTemplatesByNameNode: NodeSpec = {
  typeId: "wiki/map-templates-by-name",
  displayName: "Map Templates By Name",
  description:
    "Deep-walk content or a Templates forest and optionally indent matching names. Prefer this over find-nested + apply.",
  color: MW_COLOR,
  group: GROUP_EDIT,
  inputs: {
    source: contentOrTemplates,
    name: titleOrString,
    indent: {
      type: "boolean",
      userOnly: true,
      defaultValue: false,
    },
  },
  outputs: {
    result: contentOrTemplates,
  },
  execute: (inputs) => {
    const source = asContentOrTemplates(inputs.source);
    const name = templateName(inputs.name);
    const doIndent = inputs.indent === true;
    const fn = (t: Template): Template => (doIndent ? indentTemplate(t) : t);
    if (source.kind === "content") {
      return {
        result: mapTemplatesInContent(source.content, name, fn),
      };
    }
    return {
      result: mapTemplatesByName(source.templates, name, fn),
    };
  },
};

const deleteTemplatesFromContent: NodeSpec = {
  typeId: "wiki/delete-templates-from-content",
  displayName: "Delete Templates From Content",
  description:
    "Remove root template spans from content. Nested-only lists are rejected.",
  color: MW_COLOR,
  group: GROUP_EDIT,
  inputs: {
    content: { type: "string" },
    templates: { type: TEMPLATES_TYPE },
  },
  outputs: {
    content: { type: "string" },
  },
  execute: (inputs) => {
    const templates = requireTemplates(inputs.templates);
    assertRootTemplateList(templates);
    return {
      content: removeTemplatesFromContent(
        requireContent(inputs.content),
        templates,
      ),
    };
  },
};

const regexTypoFixing: NodeSpec = {
  typeId: "wiki/regex-typo-fixing",
  displayName: "RegEx Typo Fixing",
  description:
    "Apply enwiki AutoWikiBrowser Typo rules (Wikipedia:AutoWikiBrowser/Typos), loaded once at app start.",
  color: MW_COLOR,
  group: GROUP_TEXT,
  inputs: {
    content: { type: "string" },
  },
  outputs: {
    content: { type: "string" },
  },
  execute: (inputs) => ({
    content: applyAwbTypos(requireContent(inputs.content)),
  }),
};

export const mediaWikiNodes: NodeSpecRegistry = {
  [stringToTitle.typeId]: stringToTitle,
  [inCategory.typeId]: inCategory,
  [contentHasTemplateNode.typeId]: contentHasTemplateNode,
  [renameTemplate.typeId]: renameTemplate,
  [renameParameter.typeId]: renameParameter,
  [replaceDeprecatedParameters.typeId]: replaceDeprecatedParameters,
  [addCategory.typeId]: addCategory,
  [removeCategory.typeId]: removeCategory,
  [replaceCategory.typeId]: replaceCategory,
  [retargetWikilink.typeId]: retargetWikilink,
  [unlinkWikilink.typeId]: unlinkWikilink,
  [orderArticleNode.typeId]: orderArticleNode,
  [getPageContents.typeId]: getPageContents,
  [parseTemplates.typeId]: parseTemplates,
  [findTemplatesByNameInContent.typeId]: findTemplatesByNameInContent,
  [filterTemplatesByNameNode.typeId]: filterTemplatesByNameNode,
  [sliceTemplatesNode.typeId]: sliceTemplatesNode,
  [getNthTemplateNode.typeId]: getNthTemplateNode,
  [joinTemplatesNode.typeId]: joinTemplatesNode,
  [countTemplates.typeId]: countTemplates,
  [getTemplateName.typeId]: getTemplateName,
  [getParameter.typeId]: getParameter,
  [removeParameter.typeId]: removeParameter,
  [setParameter.typeId]: setParameter,
  [hasParameter.typeId]: hasParameter,
  [indentTemplatesNode.typeId]: indentTemplatesNode,
  [mapTemplatesByNameNode.typeId]: mapTemplatesByNameNode,
  [applyTemplates.typeId]: applyTemplates,
  [deleteTemplatesFromContent.typeId]: deleteTemplatesFromContent,
  [regexTypoFixing.typeId]: regexTypoFixing,
};
