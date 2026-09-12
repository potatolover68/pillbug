import { runGraphAsync } from "@nodish/core";
import type { WikiTitle } from "./title";
import { map, skipMap } from "../tabs/shared/maps";

export type GraphRunOutcome =
  | { kind: "skip"; before: string; prefixed: string }
  | { kind: "noop"; before: string; prefixed: string }
  | {
      kind: "review";
      before: string;
      after: string;
      prefixed: string;
      reasoning: string | null;
    }
  | { kind: "error"; message: string; prefixed: string };

/**
 * Run skip graph then process graph for one page.
 * Skip=true aborts process and advances to the next queue item.
 */
export async function runGraphsForPage(
  titleObj: WikiTitle,
  content: string,
  prefixed: string,
  signal?: AbortSignal,
): Promise<GraphRunOutcome> {
  const skipOnly = await runSkipOnly(titleObj, content, prefixed, signal);
  if (skipOnly.kind !== "continue") {
    return skipOnly;
  }
  return runProcessOnly(titleObj, content, prefixed, signal);
}

/** Skip graph only — used by prefetch mode A. */
export async function runSkipOnly(
  titleObj: WikiTitle,
  content: string,
  prefixed: string,
  signal?: AbortSignal,
): Promise<
  Extract<GraphRunOutcome, { kind: "skip" | "error" }> | { kind: "continue" }
> {
  const inputs = { Title: titleObj, Content: content };
  const skipResult = await runGraphAsync(skipMap.value, inputs, { signal });
  const skipErrors = Object.values(skipResult.errors);
  if (skipErrors.length > 0) {
    return {
      kind: "error",
      message: `Skip graph: ${skipErrors.join("; ")}`,
      prefixed,
    };
  }
  if (skipResult.values.Skip === true) {
    return { kind: "skip", before: content, prefixed };
  }
  return { kind: "continue" };
}

/** Process graph only (assumes skip already passed). */
export async function runProcessOnly(
  titleObj: WikiTitle,
  content: string,
  prefixed: string,
  signal?: AbortSignal,
): Promise<GraphRunOutcome> {
  const inputs = { Title: titleObj, Content: content };
  const processResult = await runGraphAsync(map.value, inputs, { signal });
  const processErrors = Object.values(processResult.errors);
  if (processErrors.length > 0) {
    return {
      kind: "error",
      message: `Process graph: ${processErrors.join("; ")}`,
      prefixed,
    };
  }

  const after = processResult.values.ContentAfter;
  if (typeof after !== "string") {
    return {
      kind: "error",
      message: "Process graph did not return ContentAfter string",
      prefixed,
    };
  }

  const reasoningRaw = processResult.values.Reasoning;
  const reasoning = typeof reasoningRaw === "string" ? reasoningRaw : null;

  if (after === content) {
    return { kind: "noop", before: content, prefixed };
  }

  return { kind: "review", before: content, after, prefixed, reasoning };
}
