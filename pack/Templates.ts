import type { TypeSpec } from "@nodish/core";
import type { Template, TemplateParam, WikitextChunk } from "./wikitext.ts";
import {
  chunksToString,
  getTemplateParameter,
  setTemplateParameter,
} from "./wikitext.ts";

export const TEMPLATES_TYPE = "wiki/templates";
const TEMPLATES_COLOR = "#3d8bfd";

function isWikitextChunk(value: unknown): value is WikitextChunk {
  if (typeof value !== "object" || value === null) return false;
  const c = value as WikitextChunk;
  if (c.kind === "text") return typeof c.text === "string";
  if (c.kind === "template") return isTemplate(c.template);
  return false;
}

function isTemplateParam(value: unknown): value is TemplateParam {
  if (typeof value !== "object" || value === null) return false;
  const p = value as TemplateParam;
  if (!Array.isArray(p.value) || !p.value.every(isWikitextChunk)) return false;
  if (p.kind === "named") {
    return (
      typeof p.name === "string" &&
      typeof p.wsBefore === "string" &&
      typeof p.wsAfterName === "string"
    );
  }
  if (p.kind === "positional") {
    return typeof p.index === "number";
  }
  return false;
}

export function isTemplate(value: unknown): value is Template {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Template;
  return (
    typeof t.name === "string" &&
    Array.isArray(t.params) &&
    t.params.every(isTemplateParam) &&
    typeof t.start === "number" &&
    typeof t.end === "number" &&
    typeof t.raw === "string" &&
    typeof t.nameWsLeading === "string" &&
    typeof t.nameWsTrailing === "string" &&
    typeof t.pristine === "boolean"
  );
}

export function isTemplates(value: unknown): value is Template[] {
  return Array.isArray(value) && value.every(isTemplate);
}

export function requireTemplates(value: unknown): Template[] {
  if (!isTemplates(value)) {
    throw new Error("Expected wiki/templates");
  }
  return value;
}

/** Nodes that need a single template throw when the collection is not length 1. */
export function requireSingularTemplate(value: unknown): Template {
  const templates = requireTemplates(value);
  if (templates.length !== 1) {
    throw new Error("Expected exactly one template");
  }
  return templates[0]!;
}

/** String form of a named/positional param (nested templates serialized). */
export function paramValueString(t: Template, key: string): string {
  return getTemplateParameter(t, key);
}

/** Set a param from a wikitext string (re-parsed into chunks). */
export function setParamValueString(
  t: Template,
  key: string,
  value: string,
): Template {
  return setTemplateParameter(t, key, value);
}

/** Serialize param chunks to string (for rule parsers, etc.). */
export function paramChunksToString(value: TemplateParam["value"]): string {
  return chunksToString(value);
}

export const Templates: TypeSpec = {
  id: TEMPLATES_TYPE,
  label: "Parsed templates",
  color: TEMPLATES_COLOR,
  description:
    "A list of top-level {{template}} invocations from the page. Nested templates live inside parameter values, not as extra list items. Everyday edits use the wikitext nodes (Rename/Set/Indent on the page). Write templates back needs this root list — do not Apply a nested Find-by-name result. An empty list is valid.",
  widgets: {
    default: {
      kind: "none",
    },
  },
  validate: (value: unknown) => value === null || isTemplates(value),
  defaultValue: [],
  format: (value: unknown) => {
    if (!isTemplates(value) || value.length === 0) return "(empty)";
    const shown = value.slice(0, 3).map((t) => t.name);
    const extra = value.length > 3 ? ` +${value.length - 3}` : "";
    const noun = value.length === 1 ? "root" : "roots";
    return `${value.length} ${noun}: ${shown.join(", ")}${extra}`;
  },
};
