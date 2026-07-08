import type { WikiPage } from "./client";
import { pageQueue, removeFromQueue } from "./queue";
import {
  runGraphsForPage,
  runProcessOnly,
  runSkipOnly,
  type GraphRunOutcome,
} from "./runPage";
import { getPage, prefetchMode, type PrefetchMode } from "./session";

const PREFETCH_WINDOW = 3;

type PrepEntry =
  | {
      status: "ready";
      page: WikiPage;
      outcome: Extract<GraphRunOutcome, { kind: "review" }>;
    }
  | { status: "content"; page: WikiPage }
  | { status: "pending" };

const pagePrepCache = new Map<string, PrepEntry>();

let prefetchGeneration = 0;
let prefetchRunning = false;
let shouldPrefetch = false;

type SkipLogFn = (entry: {
  page: string;
  before: string;
  after: string;
  applied: boolean;
  skipped: boolean;
  undone: boolean;
}) => void;

type ErrorFn = (message: string) => void;

let onAutoSkip: SkipLogFn | null = null;
let onAutoError: ErrorFn | null = null;

/** Wire review-state callbacks (avoids circular imports). */
export function configurePrefetchHooks(hooks: {
  onAutoSkip: SkipLogFn;
  onAutoError: ErrorFn;
}): void {
  onAutoSkip = hooks.onAutoSkip;
  onAutoError = hooks.onAutoError;
}

export function clearPrefetch(): void {
  prefetchGeneration += 1;
  shouldPrefetch = false;
  prefetchRunning = false;
  pagePrepCache.clear();
}

export function dropPrep(...titles: string[]): void {
  for (const title of titles) {
    if (!title) continue;
    pagePrepCache.delete(title);
    pagePrepCache.delete(title.replace(/_/g, " "));
    pagePrepCache.delete(title.replace(/ /g, "_"));
  }
}

function cacheKey(prefixed: string): string {
  return prefixed.replace(/_/g, " ");
}

function getPrep(title: string): PrepEntry | undefined {
  return (
    pagePrepCache.get(title) ||
    pagePrepCache.get(title.replace(/_/g, " ")) ||
    pagePrepCache.get(title.replace(/ /g, "_"))
  );
}

function setPrep(prefixed: string, entry: PrepEntry): void {
  pagePrepCache.set(cacheKey(prefixed), entry);
}

function autoRemove(raw: string, prefixed: string): void {
  removeFromQueue(raw, prefixed);
  dropPrep(raw, prefixed);
}

function handleAutoOutcome(
  raw: string,
  outcome: GraphRunOutcome,
): "removed" | "keep" {
  if (outcome.kind === "skip" || outcome.kind === "noop") {
    onAutoSkip?.({
      page: outcome.prefixed,
      before: outcome.before,
      after: outcome.before,
      applied: false,
      skipped: true,
      undone: false,
    });
    autoRemove(raw, outcome.prefixed);
    return "removed";
  }
  if (outcome.kind === "error") {
    onAutoError?.(`${outcome.prefixed}: ${outcome.message}`);
    autoRemove(raw, outcome.prefixed);
    return "removed";
  }
  return "keep";
}

/**
 * Resolve the next queue head using cache when possible.
 * Returns null if the queue was emptied by auto-skips / errors.
 */
export async function takeNextPrepared(): Promise<{
  page: WikiPage;
  outcome: GraphRunOutcome;
} | null> {
  while (pageQueue.value.length > 0) {
    const raw = pageQueue.value[0];
    if (!raw) break;

    const cached = getPrep(raw);
    if (cached?.status === "ready") {
      return { page: cached.page, outcome: cached.outcome };
    }

    if (cached?.status === "content") {
      const outcome = runProcessOnly(
        cached.page.titleObj,
        cached.page.content,
        cached.page.prefixed,
      );
      if (handleAutoOutcome(raw, outcome) === "removed") continue;
      return { page: cached.page, outcome };
    }

    // Miss or still pending — fetch now (wait if pending briefly by refetching).
    try {
      const page = await getPage(raw);
      const mode: PrefetchMode = prefetchMode.value;
      if (mode === "A") {
        const skip = runSkipOnly(page.titleObj, page.content, page.prefixed);
        if (skip.kind !== "continue") {
          if (handleAutoOutcome(raw, skip) === "removed") continue;
        }
        const outcome = runProcessOnly(
          page.titleObj,
          page.content,
          page.prefixed,
        );
        if (handleAutoOutcome(raw, outcome) === "removed") continue;
        return { page, outcome };
      }

      const outcome = runGraphsForPage(
        page.titleObj,
        page.content,
        page.prefixed,
      );
      if (handleAutoOutcome(raw, outcome) === "removed") continue;
      return { page, outcome };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      onAutoError?.(`${raw}: ${message}`);
      removeFromQueue(raw);
      dropPrep(raw);
    }
  }
  return null;
}

/** Start/keep filling the lookahead window while a review is open. */
export function ensurePrefetch(): void {
  shouldPrefetch = true;
  void runPrefetchLoop();
}

export function stopPrefetch(): void {
  shouldPrefetch = false;
  prefetchGeneration += 1;
}

async function runPrefetchLoop(): Promise<void> {
  if (prefetchRunning) return;
  prefetchRunning = true;
  const gen = prefetchGeneration;

  try {
    while (shouldPrefetch && gen === prefetchGeneration) {
      const mode = prefetchMode.value;
      // Titles after the current head (index 0 is under review or about to be).
      const candidates = pageQueue.value.slice(1, 1 + PREFETCH_WINDOW);
      const next = candidates.find((t) => {
        const entry = getPrep(t);
        return !entry || entry.status === "pending";
      });

      if (!next) break;

      setPrep(next, { status: "pending" });
      try {
        const page = await getPage(next);
        if (gen !== prefetchGeneration || !shouldPrefetch) break;

        if (mode === "A") {
          const skip = runSkipOnly(page.titleObj, page.content, page.prefixed);
          if (skip.kind !== "continue") {
            handleAutoOutcome(next, skip);
            continue;
          }
          setPrep(page.prefixed, { status: "content", page });
          // Also key by raw queue string if different
          if (next !== page.prefixed) {
            pagePrepCache.set(cacheKey(next), {
              status: "content",
              page,
            });
          }
        } else {
          const outcome = runGraphsForPage(
            page.titleObj,
            page.content,
            page.prefixed,
          );
          if (handleAutoOutcome(next, outcome) === "removed") continue;
          if (outcome.kind === "review") {
            const entry: PrepEntry = {
              status: "ready",
              page,
              outcome,
            };
            setPrep(page.prefixed, entry);
            if (next !== page.prefixed) {
              pagePrepCache.set(cacheKey(next), entry);
            }
          }
        }
      } catch (error) {
        if (gen !== prefetchGeneration) break;
        const message =
          error instanceof Error ? error.message : String(error);
        onAutoError?.(`${next}: ${message}`);
        removeFromQueue(next);
        dropPrep(next);
      }
    }
  } finally {
    prefetchRunning = false;
    // If more work appeared, schedule another pass.
    if (shouldPrefetch && gen === prefetchGeneration) {
      const needsMore = pageQueue.value
        .slice(1, 1 + PREFETCH_WINDOW)
        .some((t) => {
          const entry = getPrep(t);
          return !entry || entry.status === "pending";
        });
      if (needsMore) {
        void runPrefetchLoop();
      }
    }
  }
}
