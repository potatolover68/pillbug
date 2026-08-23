<script setup lang="ts">
import { Diff } from "vue-diff";
import "vue-diff/dist/index.css";
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import DiffLineDiscard from "../shared/DiffLineDiscard.vue";
import DiffOverviewRuler from "../shared/DiffOverviewRuler.vue";
import {
  discardLineCapturing,
  restoreLineFromRecord,
  shiftRestoresAfterDiscard,
  shiftRestoresAfterRestore,
  type LineRestoreRecord,
} from "../shared/diffLines";
import {
  currentAfter,
  currentBefore,
  manualEditing,
  previewError,
  previewHtml,
  previewing,
} from "./state";
import { useReviewKeybinds } from "./useReviewKeybinds";

const LINE_MIN_HEIGHT = 24;

const containerRef = useTemplateRef<HTMLElement>("container");
const lineRestores = ref<LineRestoreRecord[]>([]);

const previewDoc = computed(() => {
  const body = previewHtml.value;
  // Minimal document so relative wiki resources fail closed; sandboxed iframe
  // blocks scripts. Parser output is already HTML from MediaWiki.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank" rel="noopener"><style>
html,body{margin:0;padding:12px;background:#fff;color:#202122;font:14px/1.6 sans-serif;}
.mw-parser-output a{color:#0645ad;}
img,video{max-width:100%;height:auto;}
</style></head><body><div class="mw-parser-output">${body}</div></body></html>`;
});

function getViewer(): HTMLElement | null {
  return (
    (containerRef.value?.querySelector(
      ".vue-diff-viewer",
    ) as HTMLElement | null) ?? null
  );
}

function scrollToFirstDiff(): void {
  if (manualEditing.value || previewing.value) return;
  const viewer = getViewer();
  if (!viewer) return;
  if (viewer.scrollHeight <= viewer.clientHeight + 1) return;

  const cell = viewer.querySelector(
    ".vue-diff-cell-removed, .vue-diff-cell-added",
  ) as HTMLElement | null;
  const row = cell?.closest(".vue-diff-row") as HTMLElement | null;
  if (!row) return;

  const top = row.offsetTop - viewer.clientHeight * 0.2;
  viewer.scrollTop = Math.max(0, top);
}

function collectHunkRows(viewer: HTMLElement): HTMLElement[] {
  const cells = viewer.querySelectorAll(
    ".vue-diff-cell-removed, .vue-diff-cell-added",
  );
  const rows: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const cell of cells) {
    const row = cell.closest(".vue-diff-row") as HTMLElement | null;
    if (!row || seen.has(row)) continue;
    seen.add(row);
    rows.push(row);
  }
  return rows;
}

function scrollByLines(lines: number): void {
  const viewer = getViewer();
  if (!viewer) return;
  viewer.scrollTop += lines * LINE_MIN_HEIGHT;
}

function scrollByPages(pages: number): void {
  const viewer = getViewer();
  if (!viewer) return;
  viewer.scrollTop += pages * viewer.clientHeight * 0.9;
}

function jumpHunk(direction: 1 | -1): void {
  const viewer = getViewer();
  if (!viewer) return;
  const rows = collectHunkRows(viewer);
  if (rows.length === 0) return;

  const anchor = viewer.scrollTop + viewer.clientHeight * 0.2;
  let target: HTMLElement | null = null;

  if (direction > 0) {
    for (const row of rows) {
      if (row.offsetTop > anchor + 1) {
        target = row;
        break;
      }
    }
    target ??= rows[0] ?? null;
  } else {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]!;
      if (row.offsetTop < anchor - 1) {
        target = row;
        break;
      }
    }
    target ??= rows[rows.length - 1] ?? null;
  }

  if (!target) return;
  viewer.scrollTop = Math.max(0, target.offsetTop - viewer.clientHeight * 0.2);
}

function onDiscardLine(rowIndex: number): void {
  const result = discardLineCapturing(
    currentBefore.value,
    currentAfter.value,
    rowIndex,
  );
  if (!result) return;
  lineRestores.value = [
    ...shiftRestoresAfterDiscard(lineRestores.value, result.record),
    result.record,
  ];
  currentAfter.value = result.text;
}

function onRestoreLine(id: string): void {
  const index = lineRestores.value.findIndex((r) => r.id === id);
  if (index < 0) return;
  const record = lineRestores.value[index]!;
  const next = restoreLineFromRecord(currentAfter.value, record);
  if (next === null) return;
  const remaining = lineRestores.value.filter((r) => r.id !== id);
  lineRestores.value = shiftRestoresAfterRestore(remaining, record);
  currentAfter.value = next;
}

useReviewKeybinds({
  scrollByLines,
  scrollByPages,
  jumpHunk,
});

// Jump on baseline / mode change only — not on every ContentAfter edit
// (manual typing or per-line discard).
watch([currentBefore, manualEditing, previewing], async () => {
  lineRestores.value = [];
  await nextTick();
  requestAnimationFrame(() => scrollToFirstDiff());
});

watch(manualEditing, async (editing) => {
  if (!editing) return;
  await nextTick();
  const textarea = containerRef.value?.querySelector(
    "textarea.manual-edit",
  ) as HTMLTextAreaElement | null;
  textarea?.focus();
});
</script>

<template>
  <div ref="container" class="review-diff">
    <textarea
      v-if="manualEditing"
      v-model="currentAfter"
      class="manual-edit"
      spellcheck="false"
    />
    <div v-else-if="previewing" class="preview-pane">
      <p v-if="previewError" class="preview-error">{{ previewError }}</p>
      <iframe
        v-else
        class="preview-frame"
        title="ContentAfter preview"
        sandbox=""
        :srcdoc="previewDoc"
      />
    </div>
    <template v-else>
      <Diff :current="currentAfter" :prev="currentBefore" />
      <DiffLineDiscard
        :root="containerRef"
        :prev="currentBefore"
        :current="currentAfter"
        :restores="lineRestores"
        @discard="onDiscardLine"
        @restore="onRestoreLine"
      />
      <DiffOverviewRuler
        :root="containerRef"
        :prev="currentBefore"
        :current="currentAfter"
        :line-min-height="LINE_MIN_HEIGHT"
      />
    </template>
  </div>
</template>

<style scoped>
.review-diff {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.manual-edit {
  flex: 1;
  min-height: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 8px 12px;
  border: none;
  resize: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 16px;
  line-height: 1.5;
  color: #ddd;
  background: #272822;
  white-space: pre;
  overflow: auto;
}

.manual-edit:focus {
  outline: none;
}

.preview-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.preview-frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
  background: #fff;
}

.preview-error {
  margin: 12px;
  color: #b32424;
  font: 13px/1.4 sans-serif;
}

.review-diff :deep(.vue-diff-wrapper) {
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
  margin: 0;
  border-radius: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.review-diff :deep(.vue-diff-viewer) {
  flex: 1;
  min-height: 0;
  height: 100%;
  padding: 0 12px 0 0;
  box-sizing: border-box;
  overflow-y: auto;
  scrollbar-width: none;
}

.review-diff :deep(.vue-diff-viewer::-webkit-scrollbar) {
  display: none;
}

.review-diff :deep(pre code.hljs) {
  padding: 0;
}
</style>
