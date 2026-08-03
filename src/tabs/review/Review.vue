<script setup lang="ts">
import { Diff } from "vue-diff";
import "vue-diff/dist/index.css";
import { computed, nextTick, useTemplateRef, watch } from "vue";
import DiffOverviewRuler from "../shared/DiffOverviewRuler.vue";
import {
  currentAfter,
  currentBefore,
  manualEditing,
  previewError,
  previewHtml,
  previewing,
} from "./state";

const LINE_MIN_HEIGHT = 24;

const containerRef = useTemplateRef<HTMLElement>("container");

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

function scrollToFirstDiff(): void {
  if (manualEditing.value || previewing.value) return;
  const viewer = containerRef.value?.querySelector(
    ".vue-diff-viewer",
  ) as HTMLElement | null;
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

watch([currentBefore, currentAfter, manualEditing, previewing], async () => {
  await nextTick();
  requestAnimationFrame(() => scrollToFirstDiff());
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
