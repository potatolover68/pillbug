<script setup lang="ts">
import { Diff } from "vue-diff";
import "vue-diff/dist/index.css";
import { NodeViewer } from "@nodish/core";
import { computed, useTemplateRef } from "vue";

import DiffOverviewRuler from "../shared/DiffOverviewRuler.vue";
import { map, skipMap } from "../shared/maps";
import {
  activeCodeGraph,
  testAfter,
  testBefore,
  testError,
  testPanelOpen,
  testSkip,
} from "./state";
import { startCodeTour } from "./codeTour";

const LINE_MIN_HEIGHT = 24;

const activeMap = computed(() =>
  activeCodeGraph.value === "process" ? map.value : skipMap.value,
);

const diffPaneRef = useTemplateRef<HTMLElement>("diffPane");
</script>

<template>
  <div class="code-main" :class="{ 'with-test': testPanelOpen }">
    <div v-if="testPanelOpen" class="test-pane">
      <p v-if="testError" class="test-error">{{ testError }}</p>
      <p v-else-if="testSkip !== null" class="test-meta">
        Skip graph result:
        <strong>{{ testSkip ? "skip (process aborted)" : "continue" }}</strong>
      </p>
      <div v-if="!testError" ref="diffPane" class="diff-with-ruler">
        <Diff :current="testAfter" :prev="testBefore" />
        <DiffOverviewRuler
          :root="diffPaneRef"
          :prev="testBefore"
          :current="testAfter"
          :line-min-height="LINE_MIN_HEIGHT"
        />
      </div>
    </div>
    <div class="editor-pane" data-tour="code-canvas">
      <button
        type="button"
        class="tour-help"
        data-tour="code-tour-help"
        title="Code tour"
        aria-label="Start Code tour"
        @click="startCodeTour"
      >
        ?
      </button>
      <NodeViewer :map="activeMap" />
    </div>
  </div>
</template>

<style scoped>
.code-main {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.test-pane {
  display: flex;
  flex-direction: column;
  flex: 0 0 40%;
  min-height: 140px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.35);
  overflow: hidden;
  background: #1a1c20;
}

.diff-with-ruler {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.test-pane :deep(.vue-diff-wrapper) {
  flex: 1;
  min-height: 0;
  height: 100%;
  margin: 0;
  border-radius: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.test-pane :deep(.vue-diff-viewer) {
  flex: 1;
  min-height: 0;
  height: 100%;
  padding: 0 12px 0 0;
  overflow-y: auto;
  scrollbar-width: none;
}

.test-pane :deep(.vue-diff-viewer::-webkit-scrollbar) {
  display: none;
}

.test-error,
.test-meta {
  margin: 0;
  padding: 6px 8px;
  font-family: sans-serif;
  font-size: 11px;
  color: #eee;
  flex: none;
}

.test-error {
  color: #ff8a80;
}

.editor-pane {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tour-help {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 5;
  box-sizing: border-box;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 2px;
  background: #2a2d34;
  color: #f5a623;
  font-family: sans-serif;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  text-align: center;
  text-shadow: none;
  -webkit-font-smoothing: antialiased;
  cursor: pointer;
}

.tour-help:hover {
  color: #ffb84a;
  background: #32363f;
}

.code-main:not(.with-test) .editor-pane {
  flex: 1;
}
</style>
