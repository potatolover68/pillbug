import { computed, ref } from "vue";
import { loggedIn, savePage } from "../../wiki/session";
import { pageQueue, removeFromQueue } from "../../wiki/queue";
import {
  configurePrefetchHooks,
  dropPrep,
  ensurePrefetch,
  stopPrefetch,
  takeNextPrepared,
} from "../../wiki/prefetch";

interface ReviewLogEntry {
  id: string;
  page: string;
  before: string;
  after: string;
  applied: boolean;
  skipped: boolean;
  undone: boolean;
  timestamp: number;
}

export const editSummary = ref("");
export const reviewLogs = ref<ReviewLogEntry[]>([]);
const currentPage = ref<string | null>(null);
export const currentBefore = ref("");
export const currentAfter = ref("");
export const selectedLogId = ref<string | null>(null);
export const batchRunning = ref(false);
export const saveError = ref<string | null>(null);
export const saveBusy = ref(false);
export const batchError = ref<string | null>(null);

export const canSkip = computed(() => currentPage.value !== null);

const selectedEntry = computed(() =>
  reviewLogs.value.find((entry) => entry.id === selectedLogId.value),
);

export const primaryAction = computed<"save" | "undo">(() => {
  const entry = selectedEntry.value;
  if (entry?.applied && !entry.undone) return "undo";
  return "save";
});

const canAct = computed(
  () =>
    currentPage.value !== null && currentBefore.value !== currentAfter.value,
);

export const canPrimaryAction = computed(() => {
  if (saveBusy.value) return false;
  if (primaryAction.value === "undo") {
    const entry = selectedEntry.value;
    return Boolean(
      loggedIn.value &&
        entry?.applied &&
        !entry.undone &&
        currentPage.value,
    );
  }
  return canAct.value && loggedIn.value;
});
configurePrefetchHooks({
  onAutoSkip(entry) {
    appendLogEntry(entry);
  },
  onAutoError(message) {
    batchError.value = message;
  },
});

function findLogByPage(page: string): ReviewLogEntry | undefined {
  return reviewLogs.value.find((entry) => entry.page === page);
}

function markApplied(page: string): void {
  const now = Date.now();
  const existing = findLogByPage(page);

  if (existing) {
    existing.before = currentBefore.value;
    existing.after = currentAfter.value;
    existing.applied = true;
    existing.skipped = false;
    existing.undone = false;
    existing.timestamp = now;
    selectedLogId.value = existing.id;
    return;
  }

  const entry: ReviewLogEntry = {
    id: crypto.randomUUID(),
    page,
    before: currentBefore.value,
    after: currentAfter.value,
    applied: true,
    skipped: false,
    undone: false,
    timestamp: now,
  };
  reviewLogs.value.unshift(entry);
  selectedLogId.value = entry.id;
}

function setCurrentReview(
  page: string,
  before: string,
  after: string,
): void {
  currentPage.value = page;
  currentBefore.value = before;
  currentAfter.value = after;
  selectedLogId.value = null;
  saveError.value = null;
}

export function selectLogEntry(id: string): void {
  const entry = reviewLogs.value.find((row) => row.id === id);
  if (!entry) return;

  selectedLogId.value = id;
  currentPage.value = entry.page;
  currentBefore.value = entry.before;
  currentAfter.value = entry.after;
  saveError.value = null;
}

function dequeueCurrent(rawHead: string | null, prefixed: string): void {
  if (rawHead) removeFromQueue(rawHead, prefixed);
  else removeFromQueue(prefixed);
  dropPrep(rawHead ?? "", prefixed);
}

export async function applyCurrent(): Promise<void> {
  const page = currentPage.value;
  if (!page || !canAct.value || !loggedIn.value) {
    saveError.value = loggedIn.value ? null : "Log in before saving";
    return;
  }

  saveBusy.value = true;
  saveError.value = null;

  try {
    await savePage(page, currentAfter.value, editSummary.value);
    markApplied(page);
    dequeueCurrent(pageQueue.value[0] ?? null, page);
    if (batchRunning.value) {
      await processNextInQueue();
    }
  } catch (error) {
    saveError.value =
      error instanceof Error ? error.message : String(error);
  } finally {
    saveBusy.value = false;
  }
}

export async function undoCurrent(): Promise<void> {
  const entry = selectedEntry.value;
  if (!entry?.applied || entry.undone || !loggedIn.value) {
    saveError.value = loggedIn.value ? null : "Log in before undoing";
    return;
  }

  saveBusy.value = true;
  saveError.value = null;

  try {
    const summary = editSummary.value.trim()
      ? `Undid: ${editSummary.value.trim()}`
      : "Undid previous edit";
    await savePage(entry.page, entry.before, summary);
    entry.applied = false;
    entry.undone = true;
    entry.timestamp = Date.now();
    selectedLogId.value = entry.id;
    currentPage.value = entry.page;
    currentBefore.value = entry.before;
    currentAfter.value = entry.after;
  } catch (error) {
    saveError.value =
      error instanceof Error ? error.message : String(error);
  } finally {
    saveBusy.value = false;
  }
}

function appendLogEntry(
  entry: Omit<ReviewLogEntry, "id" | "timestamp"> & {
    id?: string;
    timestamp?: number;
  },
): ReviewLogEntry {
  const row: ReviewLogEntry = {
    id: entry.id ?? crypto.randomUUID(),
    page: entry.page,
    before: entry.before,
    after: entry.after,
    applied: entry.applied,
    skipped: entry.skipped,
    undone: entry.undone,
    timestamp: entry.timestamp ?? Date.now(),
  };
  reviewLogs.value.unshift(row);
  return row;
}

export function skipCurrent(): void {
  const page = currentPage.value;
  if (!page) return;

  const existing = findLogByPage(page);
  const now = Date.now();

  if (existing) {
    existing.before = currentBefore.value;
    existing.after = currentAfter.value;
    existing.applied = false;
    existing.skipped = true;
    existing.undone = false;
    existing.timestamp = now;
    selectedLogId.value = existing.id;
  } else {
    const entry: ReviewLogEntry = {
      id: crypto.randomUUID(),
      page,
      before: currentBefore.value,
      after: currentAfter.value,
      applied: false,
      skipped: true,
      undone: false,
      timestamp: now,
    };
    reviewLogs.value.unshift(entry);
    selectedLogId.value = entry.id;
  }

  dequeueCurrent(pageQueue.value[0] ?? null, page);
  if (batchRunning.value) {
    void processNextInQueue();
  }
}

export function logStatus(
  entry: ReviewLogEntry,
): "applied" | "skipped" | "undone" | "pending" {
  if (entry.skipped) return "skipped";
  if (entry.undone) return "undone";
  if (entry.applied) return "applied";
  return "pending";
}

async function processNextInQueue(): Promise<void> {
  if (!batchRunning.value || !loggedIn.value) return;

  batchError.value = null;

  while (batchRunning.value && pageQueue.value.length > 0) {
    const rawHead = pageQueue.value[0];
    if (!rawHead) break;

    try {
      const prepared = await takeNextPrepared();
      if (!prepared) break;

      const { outcome } = prepared;

      if (outcome.kind === "skip" || outcome.kind === "noop") {
        // takeNextPrepared already auto-removed these; continue.
        continue;
      }

      if (outcome.kind === "error") {
        continue;
      }

      // Needs human review — pause until Save/Skip/Stop
      // Keep raw head in queue until Save/Skip so prefetch can see slice(1…).
      setCurrentReview(outcome.prefixed, outcome.before, outcome.after);
      // Align queue head key with prefixed form for later dequeue.
      if (pageQueue.value[0] !== outcome.prefixed) {
        pageQueue.value = [
          outcome.prefixed,
          ...pageQueue.value.slice(1).filter(
            (t) =>
              t.toLowerCase() !== outcome.prefixed.toLowerCase() &&
              t.toLowerCase() !== rawHead.toLowerCase(),
          ),
        ];
      }
      dropPrep(outcome.prefixed, rawHead);
      ensurePrefetch();
      return;
    } catch (error) {
      batchError.value =
        `${rawHead}: ` +
        (error instanceof Error ? error.message : String(error));
      removeFromQueue(rawHead);
      dropPrep(rawHead);
    }
  }

  batchRunning.value = false;
  stopPrefetch();
}

export async function startBatch(): Promise<void> {
  if (!loggedIn.value) return;
  if (pageQueue.value.length === 0) {
    batchError.value = "Page queue is empty — add titles in Config";
    return;
  }
  batchRunning.value = true;
  batchError.value = null;
  ensurePrefetch();
  await processNextInQueue();
}

export function stopBatch(): void {
  batchRunning.value = false;
  stopPrefetch();
}
