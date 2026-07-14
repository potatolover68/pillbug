import type { WikiTitle } from "../src/wiki/title.ts";

export function isWikiTitle(value: unknown): value is WikiTitle {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WikiTitle).getNamespaceId === "function" &&
    typeof (value as WikiTitle).getPrefixedDb === "function"
  );
}

/** Coerce Title or string to a display/prefixed string. */
export function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (isWikiTitle(value)) return value.getPrefixedText();
  throw new Error("Expected string or mwn/title");
}

function stripNs(name: string, ns: string): string {
  const re = new RegExp(`^${ns}\\s*:\\s*`, "i");
  return name.replace(re, "").trim();
}

/** Template name without Template: prefix (spaces preserved). */
export function templateName(value: unknown): string {
  return stripNs(asString(value).replace(/_/g, " ").trim(), "Template");
}

/** Category name without Category: prefix (spaces preserved). */
export function categoryName(value: unknown): string {
  return stripNs(asString(value).replace(/_/g, " ").trim(), "Category");
}

/** Case-fold for loose MW name compares. */
export function normName(name: string): string {
  return name.replace(/_/g, " ").trim().toLowerCase();
}
