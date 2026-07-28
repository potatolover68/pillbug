import type { TypeSpec } from "@nodish/core";
import type { Template, TemplateParam } from "./wikitext.ts";

export const TEMPLATES_TYPE = "wiki/templates";
const TEMPLATES_COLOR = "#3d8bfd";

function isTemplateParam(value: unknown): value is TemplateParam {
  if (typeof value !== "object" || value === null) return false;
  const p = value as TemplateParam;
  if (p.kind === "named") {
    return (
      typeof p.name === "string" &&
      typeof p.value === "string" &&
      typeof p.wsBefore === "string" &&
      typeof p.wsAfterName === "string"
    );
  }
  if (p.kind === "positional") {
    return typeof p.index === "number" && typeof p.value === "string";
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

export const Templates: TypeSpec = {
  id: TEMPLATES_TYPE,
  label: "Templates",
  color: TEMPLATES_COLOR,
  widgets: {
    default: {
      kind: "none",
    },
  },
  validate: (value: unknown) => value === null || isTemplates(value),
  defaultValue: [],
};
