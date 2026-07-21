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
/** When true, saves are marked minor on the wiki. */
export const markMinor = ref(false);
export const reviewLogs = ref<ReviewLogEntry[]>([]);
const currentPage = ref<string | null>(null);
export const currentBefore = ref("");
export const currentAfter = ref("");
export const selectedLogId = ref<string | null>(null);
export const batchRunning = ref(false);
export const saveError = ref<string | null>(null);
export const saveBusy = ref(false);
export const batchError = ref<string | null>(null);

/** Diff replaced by a ContentAfter textarea while true. */
export const manualEditing = ref(false);
/** ContentAfter when the current manual-edit session began; used for one-step Skip restore. */
const preManualAfter = ref<string | null>(null);

/** Aborted on Stop so in-flight takeNextPrepared exits promptly. */
let batchAbort: AbortController | null = null;

export const canSkip = computed(() => {
  if (currentPage.value === null) return false;
  const canRestore =
    preManualAfter.value !== null &&
    currentAfter.value !== preManualAfter.value;
  // Log view: Skip only restores a dirty manual edit (does not dequeue).
  if (selectedLogId.value !== null) return canRestore;
  return true;
});

export const canManualEdit = computed(() => currentPage.value !== null);

function clearManualEditState(): void {
  manualEditing.value = false;
  preManualAfter.value = null;
}

export function toggleManualEdit(): void {
  if (!canManualEdit.value) return;
  if (manualEditing.value) {
    manualEditing.value = false;
    if (
      preManualAfter.value !== null &&
      currentAfter.value === preManualAfter.value
    ) {
      preManualAfter.value = null;
    }
    return;
  }
  if (preManualAfter.value === null) {
    preManualAfter.value = currentAfter.value;
  }
  manualEditing.value = true;
}

const selectedEntry = computed(() =>
  reviewLogs.value.find((entry) => entry.id === selectedLogId.value),
);

/** Live queue review saved while browsing a log entry. */
let liveReview: {
  page: string;
  before: string;
  after: string;
} | null = null;

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
      loggedIn.value && entry?.applied && !entry.undone && currentPage.value,
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

function setCurrentReview(page: string, before: string, after: string): void {
  currentPage.value = page;
  currentBefore.value = before;
  currentAfter.value = after;
  selectedLogId.value = null;
  liveReview = null;
  clearManualEditState();
  saveError.value = null;
}

export function clearLogSelection(): void {
  selectedLogId.value = null;
  saveError.value = null;
  clearManualEditState();
  if (liveReview) {
    currentPage.value = liveReview.page;
    currentBefore.value = liveReview.before;
    currentAfter.value = liveReview.after;
    return;
  }
  // No stashed live review (e.g. opened a log after the queue was empty).
  currentPage.value = null;
  currentBefore.value = "";
  currentAfter.value = "";
}

export function selectLogEntry(id: string): void {
  const entry = reviewLogs.value.find((row) => row.id === id);
  if (!entry) return;

  if (selectedLogId.value === id) {
    clearLogSelection();
    return;
  }

  if (selectedLogId.value === null && currentPage.value !== null) {
    liveReview = {
      page: currentPage.value,
      before: currentBefore.value,
      after: currentAfter.value,
    };
  }

  clearManualEditState();
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
    await savePage(
      page,
      currentAfter.value,
      editSummary.value,
      markMinor.value,
    );
    clearManualEditState();
    markApplied(page);
    dequeueCurrent(pageQueue.value[0] ?? null, page);
    if (batchRunning.value) {
      await processNextInQueue();
    }
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error);
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
    await savePage(entry.page, entry.before, summary, markMinor.value);
    entry.applied = false;
    entry.undone = true;
    entry.timestamp = Date.now();
    selectedLogId.value = entry.id;
    currentPage.value = entry.page;
    currentBefore.value = entry.before;
    currentAfter.value = entry.after;
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error);
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

  manualEditing.value = false;
  if (
    preManualAfter.value !== null &&
    currentAfter.value !== preManualAfter.value
  ) {
    currentAfter.value = preManualAfter.value;
    preManualAfter.value = null;
    return;
  }
  preManualAfter.value = null;

  // Historical log view: never dequeue / mark skipped via Skip.
  if (selectedLogId.value !== null) return;

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

async function processNextInQueue(signal?: AbortSignal): Promise<void> {
  if (!batchRunning.value || !loggedIn.value) return;

  const activeSignal = signal ?? batchAbort?.signal;
  batchError.value = null;

  while (batchRunning.value && pageQueue.value.length > 0) {
    if (activeSignal?.aborted) break;

    const rawHead = pageQueue.value[0];
    if (!rawHead) break;

    try {
      const prepared = await takeNextPrepared(activeSignal);
      if (!prepared || activeSignal?.aborted) break;

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
          ...pageQueue.value
            .slice(1)
            .filter(
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
      if (activeSignal?.aborted) break;
      batchError.value =
        `${rawHead}: ` +
        (error instanceof Error ? error.message : String(error));
      removeFromQueue(rawHead);
      dropPrep(rawHead);
    }
  }

  batchRunning.value = false;
  batchAbort = null;
  stopPrefetch();
}

export async function startBatch(): Promise<void> {
  if (!loggedIn.value) return;
  if (pageQueue.value.length === 0) {
    batchError.value = "Page queue is empty — add titles in Config";
    return;
  }
  batchAbort?.abort();
  batchAbort = new AbortController();
  batchRunning.value = true;
  batchError.value = null;
  ensurePrefetch();
  await processNextInQueue(batchAbort.signal);
}

export function stopBatch(): void {
  batchRunning.value = false;
  batchAbort?.abort();
  batchAbort = null;
  stopPrefetch();
}
