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
  contentHasSignificantChanges,
  contentHasTemplate,
  contentHasTemplateParameter,
  deleteTemplatesByNameInContent,
  filterTemplatesByName,
  findCategories,
  findTemplates,
  findTemplatesByNameDeep,
  findWikilinks,
  formatWikilink,
  getNthTemplate,
  getParameterInContent,
  getTemplateParameter,
  indentTemplate,
  indentTemplates,
  indentTemplatesInContent,
  isRedirectTargetWikilink,
  isStubTemplateName,
  joinTemplates,
  mapAllTemplates,
  mapTemplatesByName,
  mapTemplatesInContent,
  removeParameterInContent,
  removeTemplateParameter,
  removeTemplatesFromContent,
  renameParameterInContent,
  renameTemplateInContent,
  renameTemplateParameterKey,
  setParameterInContent,
  setTemplateName,
  setTemplateParameter,
  sliceTemplates,
  swapParametersInContent,
  swapTemplateParameters,
  templateHasParameter,
  templatesFromContent,
  type Template,
} from "./wikitext.ts";
import { replaceDeprecatedParametersInContent } from "./deprecatedParams.ts";
import { fetchPageContents } from "./pageContents.ts";
import { applyAwbTypos } from "./typos.ts";

const MW_COLOR = "#3d8bfd";
const GROUP_ON_PAGE = ["MediaWiki", "templates", "on the page"];
const GROUP_PARAMS = ["MediaWiki", "templates", "parameters"];
const GROUP_LIST = ["MediaWiki", "templates", "list"];
const GROUP_DEPRECATED = ["MediaWiki", "templates", "deprecated"];
const GROUP_CATEGORIES = ["MediaWiki", "categories"];
const GROUP_WIKILINKS = ["MediaWiki", "wikilinks"];
const GROUP_TITLE = ["MediaWiki", "title"];
const GROUP_PAGE = ["MediaWiki", "page"];
const GROUP_TEXT = ["MediaWiki", "text"];

const wikitextPort: GraphPortSpec = {
  type: "string",
  label: "Wikitext",
  description: "Page source ({{templates}} and prose).",
};

const updatedWikitextPort: GraphPortSpec = {
  type: "string",
  label: "Updated wikitext",
  description: "Page source after this node.",
};

const titleOrString: GraphPortSpec = {
  type: "string" as const,
  types: ["wiki/title", "string"] as string[],
  label: "Title",
  description: "Page title (string or parsed Title).",
};

const templateNamePort: GraphPortSpec = {
  type: "string" as const,
  types: ["wiki/title", "string"] as string[],
  label: "Template name",
  description: "Template name (Template: prefix optional).",
};

const oldNamePort: GraphPortSpec = {
  ...templateNamePort,
  label: "Old name",
};

const newNamePort: GraphPortSpec = {
  ...templateNamePort,
  label: "New name",
};

const pageOrTemplatesPort: GraphPortSpec = {
  type: "string" as const,
  types: ["string", TEMPLATES_TYPE] as string[],
  label: "Page or templates",
  description:
    "Wikitext or a Parsed templates list. Output kind matches the input.",
};

const templatesPort: GraphPortSpec = {
  type: TEMPLATES_TYPE,
  label: "Templates",
  description:
    "Root invocations (from Parse). Nested ones are inside parameters.",
};

const parameterPort: GraphPortSpec = {
  type: "string",
  label: "Parameter",
  description: 'Named key (education) or positional index ("1").',
};

const oldParameterPort: GraphPortSpec = {
  type: "string",
  label: "Old parameter",
  description: "Parameter name to rename.",
};

const newParameterPort: GraphPortSpec = {
  type: "string",
  label: "New parameter",
  description: "Replacement parameter name.",
};

const paramValuePort: GraphPortSpec = {
  type: "string",
  label: "Value",
  description: "Parameter wikitext (nested {{templates}} allowed).",
};

const categoryPort: GraphPortSpec = {
  ...titleOrString,
  label: "Category",
  description: "Category name (Category: prefix optional).",
};

function requireContent(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected string content");
  }
  return value;
}

function requireTemplateName(value: unknown): string {
  const name = templateName(value).trim();
  if (!name) throw new Error("Template name is required");
  return name;
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

function renameTemplatesCollection(
  templates: Template[],
  oldT: unknown,
  newT: unknown,
): Template[] {
  const want = templateName(oldT);
  return mapTemplatesByName(templates, want, (t) => setTemplateName(t, newT));
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
 * Page-leading `#REDIRECT [[Foo]]` always becomes `#REDIRECT [[Baz]]` (never piped).
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
      if (isRedirectTargetWikilink(content, h.start)) {
        label = null;
      } else if (label == null && !replaceOn) {
        label = h.target;
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
  description:
    "Parse a string into a Title. Login is required. Empty strings will error.",
  color: MW_COLOR,
  group: GROUP_TITLE,
  keywords: ["parse", "wiki/title"],
  inputs: {
    text: {
      type: "string",
      label: "Text",
      description: "Page name, with or without a namespace prefix.",
    },
  },
  outputs: {
    title: {
      type: "wiki/title",
      label: "Title",
      description: "Parsed MediaWiki title.",
    },
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
    content: wikitextPort,
    category: categoryPort,
  },
  outputs: {
    result: {
      type: "boolean",
      label: "Result",
      description: "True if that category link is already on the page.",
    },
  },
  execute: (inputs) => ({
    result: contentHasCategory(requireContent(inputs.content), inputs.category),
  }),
};

const contentHasTemplateNode: NodeSpec = {
  typeId: "wiki/content-has-template",
  displayName: "Page has template",
  description:
    "True if the page contains a {{template}} with this name, including nested inside other templates. Useful on the skip graph.",
  color: MW_COLOR,
  group: GROUP_ON_PAGE,
  keywords: ["skip", "contains", "has template"],
  inputs: {
    content: wikitextPort,
    name: templateNamePort,
  },
  outputs: {
    result: {
      type: "boolean",
      label: "Result",
      description: "True if a matching invocation exists (nested included).",
    },
  },
  execute: (inputs) => ({
    result: contentHasTemplate(requireContent(inputs.content), inputs.name),
  }),
};

const renameTemplate: NodeSpec = {
  typeId: "wiki/rename-template",
  displayName: "Rename template (deprecated)",
  description:
    "Deprecated until v1.0.0. Use Rename template (wikitext in/out). This node accepts wikitext or a Parsed templates list; the output is the same kind.",
  color: MW_COLOR,
  group: GROUP_DEPRECATED,
  keywords: ["retarget", "rename invocation", "deprecated"],
  inputs: {
    source: pageOrTemplatesPort,
    oldName: oldNamePort,
    newName: newNamePort,
  },
  outputs: {
    result: pageOrTemplatesPort,
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
  displayName: "Rename parameter (deprecated)",
  description:
    "Deprecated until v1.0.0. Use Rename parameter (wikitext in/out). On a Parsed templates list, leave Template name empty to update every node.",
  color: MW_COLOR,
  group: GROUP_DEPRECATED,
  keywords: ["rdp", "rename key", "deprecated"],
  inputs: {
    source: pageOrTemplatesPort,
    template: templateNamePort,
    oldParameter: oldParameterPort,
    newParameter: newParameterPort,
  },
  outputs: {
    result: pageOrTemplatesPort,
  },
  execute: (inputs) => {
    const source = asContentOrTemplates(inputs.source);
    if (source.kind === "content") {
      return {
        result: renameParameterInContent(
          source.content,
          inputs.template,
          asString(inputs.oldParameter),
          asString(inputs.newParameter),
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

const pageRenameTemplate: NodeSpec = {
  typeId: "wiki/page-rename-template",
  displayName: "Rename template",
  description:
    "Rename {{Old}} to {{New}} at any depth, including nested invocations. Wikitext in, wikitext out.",
  color: MW_COLOR,
  group: GROUP_ON_PAGE,
  keywords: ["retarget", "rename invocation"],
  inputs: {
    content: wikitextPort,
    oldName: oldNamePort,
    newName: newNamePort,
  },
  outputs: {
    content: updatedWikitextPort,
  },
  execute: (inputs) => {
    requireTemplateName(inputs.oldName);
    requireTemplateName(inputs.newName);
    return {
      content: renameTemplateInContent(
        requireContent(inputs.content),
        inputs.oldName,
        inputs.newName,
      ),
    };
  },
};

const pageIndentTemplates: NodeSpec = {
  typeId: "wiki/page-indent-templates",
  displayName: "Indent templates",
  description:
    "Reformat matching {{templates}} to multi-line | name = value, including nested invocations. Leave Template name empty to indent every invocation on the page.",
  color: MW_COLOR,
  group: GROUP_ON_PAGE,
  keywords: ["pretty", "format", "awb", "indent"],
  inputs: {
    content: wikitextPort,
    name: {
      ...templateNamePort,
      description:
        "Template name to indent (Template: prefix optional). Empty = all invocations.",
    },
  },
  outputs: {
    content: updatedWikitextPort,
  },
  execute: (inputs) => ({
    content: indentTemplatesInContent(
      requireContent(inputs.content),
      inputs.name ?? "",
    ),
  }),
};

const pageDeleteTemplates: NodeSpec = {
  typeId: "wiki/page-delete-templates",
  displayName: "Delete templates",
  description:
    "Remove every {{template}} with this name from the page, including nested invocations inside other templates.",
  color: MW_COLOR,
  group: GROUP_ON_PAGE,
  keywords: ["remove", "delete", "strip"],
  inputs: {
    content: wikitextPort,
    name: templateNamePort,
  },
  outputs: {
    content: updatedWikitextPort,
  },
  execute: (inputs) => {
    requireTemplateName(inputs.name);
    return {
      content: deleteTemplatesByNameInContent(
        requireContent(inputs.content),
        inputs.name,
      ),
    };
  },
};

const pageRenameParameter: NodeSpec = {
  typeId: "wiki/page-rename-parameter",
  displayName: "Rename parameter",
  description:
    "Rename a parameter key on every matching {{template}}, including nested invocations. Wikitext in, wikitext out.",
  color: MW_COLOR,
  group: GROUP_PARAMS,
  keywords: ["rdp", "rename key"],
  inputs: {
    content: wikitextPort,
    name: templateNamePort,
    oldParameter: oldParameterPort,
    newParameter: newParameterPort,
  },
  outputs: {
    content: updatedWikitextPort,
  },
  execute: (inputs) => {
    requireTemplateName(inputs.name);
    return {
      content: renameParameterInContent(
        requireContent(inputs.content),
        inputs.name,
        asString(inputs.oldParameter),
        asString(inputs.newParameter),
      ),
    };
  },
};

const pageSetParameter: NodeSpec = {
  typeId: "wiki/page-set-parameter",
  displayName: "Set parameter",
  description:
    "Set or add a named or positional parameter on every matching {{template}}, including nested invocations. The value is parsed as wikitext.",
  color: MW_COLOR,
  group: GROUP_PARAMS,
  keywords: ["set arg", "add param"],
  inputs: {
    content: wikitextPort,
    name: templateNamePort,
    parameter: parameterPort,
    value: paramValuePort,
  },
  outputs: {
    content: updatedWikitextPort,
  },
  execute: (inputs) => {
    requireTemplateName(inputs.name);
    return {
      content: setParameterInContent(
        requireContent(inputs.content),
        inputs.name,
        asString(inputs.parameter),
        asString(inputs.value),
      ),
    };
  },
};

const pageRemoveParameter: NodeSpec = {
  typeId: "wiki/page-remove-parameter",
  displayName: "Remove parameter",
  description:
    "Remove a named or positional parameter from every matching {{template}}, including nested invocations.",
  color: MW_COLOR,
  group: GROUP_PARAMS,
  keywords: ["delete param", "drop"],
  inputs: {
    content: wikitextPort,
    name: templateNamePort,
    parameter: parameterPort,
  },
  outputs: {
    content: updatedWikitextPort,
  },
  execute: (inputs) => {
    requireTemplateName(inputs.name);
    return {
      content: removeParameterInContent(
        requireContent(inputs.content),
        inputs.name,
        asString(inputs.parameter),
      ),
    };
  },
};

const pageSwapParameters: NodeSpec = {
  typeId: "wiki/page-swap-parameters",
  displayName: "Swap parameters",
  description:
    "Swap two parameter values on every matching {{template}}, including nested invocations. Missing parameters are created blank, then swapped.",
  color: MW_COLOR,
  group: GROUP_PARAMS,
  keywords: ["swap", "exchange", "positional"],
  inputs: {
    content: wikitextPort,
    name: templateNamePort,
    parameterA: {
      ...parameterPort,
      label: "Parameter A",
      description: "First parameter (named key or positional index).",
    },
    parameterB: {
      ...parameterPort,
      label: "Parameter B",
      description: "Second parameter (named key or positional index).",
    },
  },
  outputs: {
    content: updatedWikitextPort,
  },
  execute: (inputs) => {
    requireTemplateName(inputs.name);
    return {
      content: swapParametersInContent(
        requireContent(inputs.content),
        inputs.name,
        asString(inputs.parameterA),
        asString(inputs.parameterB),
      ),
    };
  },
};

const pageGetParameter: NodeSpec = {
  typeId: "wiki/page-get-parameter",
  displayName: "Get parameter",
  description:
    'Parameter value from the nth matching {{template}} (1-based, nested included). Missing invocation or parameter → empty string.',
  color: MW_COLOR,
  group: GROUP_PARAMS,
  keywords: ["get arg", "read param", "skip"],
  inputs: {
    content: wikitextPort,
    name: templateNamePort,
    parameter: parameterPort,
    n: {
      type: "number",
      defaultValue: 1,
      userOnly: true,
      label: "Index",
      description:
        "1-based match among invocations of this template name (preorder).",
    },
  },
  outputs: {
    result: {
      type: "string",
      label: "Value",
      description: "Parameter wikitext, or empty if missing.",
    },
  },
  execute: (inputs) => {
    requireTemplateName(inputs.name);
    return {
      result: getParameterInContent(
        requireContent(inputs.content),
        inputs.name,
        asString(inputs.parameter),
        Number(inputs.n),
      ),
    };
  },
};

const pageHasParameter: NodeSpec = {
  typeId: "wiki/page-has-parameter",
  displayName: "Has parameter",
  description:
    "True if any matching {{template}} on the page (nested included) has the given parameter. Useful on the skip graph.",
  color: MW_COLOR,
  group: GROUP_PARAMS,
  keywords: ["contains param", "skip"],
  inputs: {
    content: wikitextPort,
    name: templateNamePort,
    parameter: parameterPort,
  },
  outputs: {
    result: {
      type: "boolean",
      label: "Result",
      description: "True if at least one matching invocation has that parameter.",
    },
  },
  execute: (inputs) => {
    requireTemplateName(inputs.name);
    return {
      result: contentHasTemplateParameter(
        requireContent(inputs.content),
        inputs.name,
        asString(inputs.parameter),
      ),
    };
  },
};

const replaceDeprecatedParameters: NodeSpec = {
  typeId: "wiki/replace-deprecated-parameters",
  displayName: "Replace deprecated parameters",
  description:
    "Load #invoke:Check for deprecated parameters for Template name and apply those rules to matching invocations, including nested ones. Also runs enwiki alma_mater/education swaps where that RFC applies.",
  color: MW_COLOR,
  group: GROUP_ON_PAGE,
  keywords: ["rdp", "deprecated", "infobox"],
  inputs: {
    title: templateNamePort,
    content: wikitextPort,
    fixindent: {
      type: "boolean",
      userOnly: true,
      defaultValue: false,
      label: "Fix indent",
      description:
        "Reformat matching infobox-style invocations to aligned | name = value.",
    },
  },
  outputs: {
    contentAfter: updatedWikitextPort,
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
    "Append [[Category:…]] if it is not already present. Inserts before stub templates when those exist.",
  color: MW_COLOR,
  group: GROUP_CATEGORIES,
  inputs: {
    content: wikitextPort,
    category: categoryPort,
  },
  outputs: {
    content: updatedWikitextPort,
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
    content: wikitextPort,
    category: categoryPort,
  },
  outputs: {
    content: updatedWikitextPort,
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
    "Replace [[Category:from]] with [[Category:to]]. Keeps sort keys and drops a duplicate target.",
  color: MW_COLOR,
  group: GROUP_CATEGORIES,
  inputs: {
    content: wikitextPort,
    from: { ...categoryPort, label: "From" },
    to: { ...categoryPort, label: "To" },
  },
  outputs: {
    content: updatedWikitextPort,
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
    "Change free wikilink targets. Off: [[Foo]]→[[Baz|Foo]]. On (replace on): [[Foo]]→[[Baz]]. Piped labels are kept. #REDIRECT [[Foo]] becomes #REDIRECT [[Baz]] (never piped). Skips Category/File links.",
  color: MW_COLOR,
  group: GROUP_WIKILINKS,
  inputs: {
    content: wikitextPort,
    from: {
      ...titleOrString,
      label: "From",
      description: "Current link target.",
    },
    to: {
      ...titleOrString,
      label: "To",
      description: "New link target.",
    },
    replaceOn: {
      type: "boolean",
      defaultValue: false,
      label: "Replace on",
      description:
        "When on, bare [[Foo]] becomes [[Baz]] instead of [[Baz|Foo]].",
    },
  },
  outputs: {
    content: updatedWikitextPort,
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
    content: wikitextPort,
    target: {
      ...titleOrString,
      label: "Target",
      description: "Link target to unlink.",
    },
  },
  outputs: {
    content: updatedWikitextPort,
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
    "Naive MOS reorder of lead templates and the trailer (categories, stubs, and similar).",
  color: MW_COLOR,
  group: GROUP_PAGE,
  inputs: {
    content: wikitextPort,
  },
  outputs: {
    content: updatedWikitextPort,
  },
  execute: (inputs) => ({
    content: orderArticle(requireContent(inputs.content)),
  }),
};

const getPageContents: NodeSpec = {
  typeId: "wiki/get-page-contents",
  displayName: "Get page contents",
  description:
    "Fetch wikitext for a title. Missing pages yield empty wikitext and exists=false. Uses a blocking wiki read.",
  color: MW_COLOR,
  group: GROUP_PAGE,
  keywords: ["fetch", "read", "load page"],
  inputs: {
    title: titleOrString,
  },
  outputs: {
    content: wikitextPort,
    exists: {
      type: "boolean",
      label: "Exists",
      description: "False if the page is missing or the title is empty.",
    },
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
  displayName: "Parse templates",
  description:
    "Turn page wikitext into a list of top-level {{template}} invocations. Nested templates stay inside parameter values, not as extra list items. For everyday edits prefer the wikitext nodes under on the page / parameters.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["forest", "extract", "parse"],
  inputs: {
    content: wikitextPort,
  },
  outputs: {
    result: templatesPort,
  },
  execute: (inputs) => ({
    result: templatesFromContent(requireContent(inputs.content)),
  }),
};

const findTemplatesByNameInContent: NodeSpec = {
  typeId: "wiki/find-templates-by-name",
  displayName: "Find by name (deprecated)",
  description:
    "Deprecated until v1.0.0. List matching invocations anywhere on the page, including nested. Do not Write templates back if this list includes nested hits. Prefer Get parameter or Has parameter on the page.",
  color: MW_COLOR,
  group: GROUP_DEPRECATED,
  keywords: ["nested", "search", "find", "deprecated"],
  inputs: {
    content: wikitextPort,
    name: templateNamePort,
  },
  outputs: {
    result: {
      ...templatesPort,
      description:
        "Matching invocations (may be nested — not safe to Write templates back).",
    },
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
  displayName: "Filter by name",
  description:
    "Keep items in the wired list whose name matches. Does not walk inside parameters.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["filter", "shallow"],
  inputs: {
    templates: templatesPort,
    name: templateNamePort,
  },
  outputs: {
    result: templatesPort,
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
  displayName: "Slice templates",
  description:
    "1-based inclusive slice (From…To) of a Parsed templates list. Does not re-parse the page.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["slice", "range"],
  inputs: {
    templates: templatesPort,
    n: {
      type: "number",
      defaultValue: 1,
      label: "From",
      description: "1-based start index (inclusive).",
    },
    m: {
      type: "number",
      defaultValue: 1,
      label: "To",
      description: "1-based end index (inclusive).",
    },
  },
  outputs: {
    result: templatesPort,
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
  displayName: "Nth template",
  description:
    "Return a list containing only the nth item (1-based). Empty if the index is out of range.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["nth", "index", "pick"],
  inputs: {
    templates: templatesPort,
    n: {
      type: "number",
      defaultValue: 1,
      label: "Index",
      description: "1-based index into the list.",
    },
  },
  outputs: {
    result: templatesPort,
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
  displayName: "Join templates",
  description:
    "Concatenate two Parsed templates lists (A then B). Does not re-parse the page; offsets stay as they were.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["concat", "merge"],
  inputs: {
    a: { ...templatesPort, label: "A" },
    b: { ...templatesPort, label: "B" },
  },
  outputs: {
    result: templatesPort,
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
  displayName: "Count templates",
  description:
    "Number of items in the wired Parsed templates list (not nested).",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["length", "size"],
  inputs: {
    templates: templatesPort,
  },
  outputs: {
    result: {
      type: "number",
      label: "Count",
      description: "Length of the list.",
    },
  },
  execute: (inputs) => ({
    result: requireTemplates(inputs.templates).length,
  }),
};

const getTemplateName: NodeSpec = {
  typeId: "wiki/get-template-name",
  displayName: "Get template name",
  description:
    "Name of the sole template. Errors if the list is not length 1. Use Nth template first to pick one item.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["name"],
  inputs: {
    templates: templatesPort,
  },
  outputs: {
    result: {
      type: "string",
      label: "Name",
      description: "Template name as written.",
    },
  },
  execute: (inputs) => ({
    result: requireSingularTemplate(inputs.templates).name,
  }),
};

const getParameter: NodeSpec = {
  typeId: "wiki/get-parameter",
  displayName: "Get parameter",
  description:
    'Parameter value from the sole template (named key or positional "1"). Errors if the list is not length 1. Missing → empty string.',
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["get arg", "read param"],
  inputs: {
    templates: templatesPort,
    parameter: parameterPort,
  },
  outputs: {
    result: {
      type: "string",
      label: "Value",
      description: "Parameter wikitext, or empty if missing.",
    },
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
  displayName: "Remove parameter",
  description:
    "Remove a named or positional parameter from each template in the list.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["delete param", "drop"],
  inputs: {
    templates: templatesPort,
    parameter: parameterPort,
  },
  outputs: {
    result: templatesPort,
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
  displayName: "Set parameter",
  description:
    "Set or add a named or positional parameter on each template in the list. The value is parsed as wikitext (nested {{templates}} allowed).",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["set arg", "add param"],
  inputs: {
    templates: templatesPort,
    parameter: parameterPort,
    value: paramValuePort,
  },
  outputs: {
    result: templatesPort,
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

const swapParameters: NodeSpec = {
  typeId: "wiki/swap-parameters",
  displayName: "Swap parameters",
  description:
    "Swap two parameter values on each template in the list. Works for named keys and positional indexes. If a parameter is missing, it is created blank, then the values are swapped.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["swap", "exchange", "positional"],
  inputs: {
    templates: templatesPort,
    parameterA: {
      ...parameterPort,
      label: "Parameter A",
      description: "First parameter (named key or positional index).",
    },
    parameterB: {
      ...parameterPort,
      label: "Parameter B",
      description: "Second parameter (named key or positional index).",
    },
  },
  outputs: {
    result: templatesPort,
  },
  execute: (inputs) => {
    const a = asString(inputs.parameterA);
    const b = asString(inputs.parameterB);
    return {
      result: requireTemplates(inputs.templates).map((t) =>
        swapTemplateParameters(t, a, b),
      ),
    };
  },
};

const hasParameter: NodeSpec = {
  typeId: "wiki/has-parameter",
  displayName: "Has parameter",
  description: "True if any template in the list has the given parameter.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["contains param"],
  inputs: {
    templates: templatesPort,
    parameter: parameterPort,
  },
  outputs: {
    result: {
      type: "boolean",
      label: "Result",
      description: "True if at least one template has that parameter.",
    },
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
  displayName: "Indent templates",
  description:
    "Reformat each item in this list to multi-line | name = value. Nested templates serialize inside parameter values; they are not split into extra parameters.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["pretty", "format", "awb"],
  inputs: {
    templates: templatesPort,
  },
  outputs: {
    result: templatesPort,
  },
  execute: (inputs) => ({
    result: indentTemplates(requireTemplates(inputs.templates)),
  }),
};

const applyTemplates: NodeSpec = {
  typeId: "wiki/apply-templates",
  displayName: "Write templates back",
  description:
    "Replace each root template span in the page with its serialized form. Errors if the list mixes nested spans with their parents — use Parse, not Find by name.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["apply", "serialize", "write back"],
  inputs: {
    content: wikitextPort,
    templates: templatesPort,
  },
  outputs: {
    content: updatedWikitextPort,
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
  displayName: "Indent matching templates (deprecated)",
  description:
    "Deprecated until v1.0.0. Use Indent templates (wikitext in/out). Walk matching names (including nested) and optionally indent them. Wire wikitext or a Parsed templates list; the output is the same kind.",
  color: MW_COLOR,
  group: GROUP_DEPRECATED,
  keywords: ["map", "nested", "indent", "deprecated"],
  inputs: {
    source: pageOrTemplatesPort,
    name: templateNamePort,
    indent: {
      type: "boolean",
      userOnly: true,
      defaultValue: false,
      label: "Indent matches",
      description:
        "Reformat matching invocations to multi-line | name = value.",
    },
  },
  outputs: {
    result: pageOrTemplatesPort,
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
  displayName: "Delete templates",
  description:
    "Strip root template spans from the page. Nested-only lists are rejected — use Parse, not Find by name.",
  color: MW_COLOR,
  group: GROUP_LIST,
  keywords: ["remove", "delete", "strip"],
  inputs: {
    content: wikitextPort,
    templates: templatesPort,
  },
  outputs: {
    content: updatedWikitextPort,
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
  displayName: "RegEx typo fixing",
  description:
    "Apply English Wikipedia AutoWikiBrowser typo rules (Wikipedia:AutoWikiBrowser/Typos). Rules load once at app start.",
  color: MW_COLOR,
  group: GROUP_TEXT,
  keywords: ["retf", "typo", "awb"],
  inputs: {
    content: wikitextPort,
  },
  outputs: {
    content: updatedWikitextPort,
  },
  execute: (inputs) => ({
    content: applyAwbTypos(requireContent(inputs.content)),
  }),
};

const hasSignificantChanges: NodeSpec = {
  typeId: "wiki/has-significant-changes",
  displayName: "Has significant changes",
  description:
    "True if After differs from Before by more than insubstantial whitespace inside {{templates}} (indent and | name = value layout). Changes outside templates, or to names, parameters, or values, count as significant. Content is After when significant, otherwise Before — wire that to ContentAfter so indent-only diffs are treated as unchanged.",
  color: MW_COLOR,
  group: GROUP_TEXT,
  keywords: ["skip", "whitespace", "indent", "substantial", "diff", "noop"],
  inputs: {
    before: {
      ...wikitextPort,
      label: "Before",
      description: "Original page source (usually the graph Content input).",
    },
    after: {
      ...wikitextPort,
      label: "After",
      description: "Candidate page source (usually the last transform).",
    },
  },
  outputs: {
    result: {
      type: "boolean",
      label: "Significant",
      description:
        "True if the difference is more than insubstantial template whitespace.",
    },
    content: {
      ...updatedWikitextPort,
      description:
        "After if significant, otherwise Before (process graph can treat indent-only diffs as unchanged).",
    },
  },
  execute: (inputs) => {
    const before = requireContent(inputs.before);
    const after = requireContent(inputs.after);
    const significant = contentHasSignificantChanges(before, after);
    return {
      result: significant,
      content: significant ? after : before,
    };
  },
};

export const mediaWikiNodes: NodeSpecRegistry = {
  [stringToTitle.typeId]: stringToTitle,
  [inCategory.typeId]: inCategory,
  [contentHasTemplateNode.typeId]: contentHasTemplateNode,
  [pageRenameTemplate.typeId]: pageRenameTemplate,
  [pageIndentTemplates.typeId]: pageIndentTemplates,
  [pageDeleteTemplates.typeId]: pageDeleteTemplates,
  [pageRenameParameter.typeId]: pageRenameParameter,
  [pageSetParameter.typeId]: pageSetParameter,
  [pageRemoveParameter.typeId]: pageRemoveParameter,
  [pageSwapParameters.typeId]: pageSwapParameters,
  [pageGetParameter.typeId]: pageGetParameter,
  [pageHasParameter.typeId]: pageHasParameter,
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
  [swapParameters.typeId]: swapParameters,
  [hasParameter.typeId]: hasParameter,
  [indentTemplatesNode.typeId]: indentTemplatesNode,
  [mapTemplatesByNameNode.typeId]: mapTemplatesByNameNode,
  [applyTemplates.typeId]: applyTemplates,
  [deleteTemplatesFromContent.typeId]: deleteTemplatesFromContent,
  [regexTypoFixing.typeId]: regexTypoFixing,
  [hasSignificantChanges.typeId]: hasSignificantChanges,
};
