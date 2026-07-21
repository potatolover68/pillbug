<script setup lang="ts">
import { Diff } from "vue-diff";
import "vue-diff/dist/index.css";
import { nextTick, useTemplateRef, watch } from "vue";
import DiffOverviewRuler from "../shared/DiffOverviewRuler.vue";
import { currentAfter, currentBefore, manualEditing } from "./state";

const LINE_MIN_HEIGHT = 24;

const containerRef = useTemplateRef<HTMLElement>("container");

function scrollToFirstDiff(): void {
  if (manualEditing.value) return;
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

watch([currentBefore, currentAfter, manualEditing], async () => {
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
