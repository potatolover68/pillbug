<script setup lang="ts">
import { Diff } from "vue-diff";
import "vue-diff/dist/index.css";
import { NodeViewer } from "@nodish/core";
import { useElementSize } from "@vueuse/core";
import { computed, useTemplateRef } from "vue";

import { map, skipMap } from "../shared";
import {
  activeCodeGraph,
  testAfter,
  testBefore,
  testError,
  testPanelOpen,
  testSkip,
} from "./state";

const activeMap = computed(() =>
  activeCodeGraph.value === "process" ? map.value : skipMap.value,
);

const { height: containerHeight } = useElementSize(useTemplateRef("diffPane"));
const diffHeight = computed(() =>
  Math.max(120, containerHeight.value || 200),
);
</script>

<template>
  <div class="code-main" :class="{ 'with-test': testPanelOpen }">
    <div v-if="testPanelOpen" ref="diffPane" class="test-pane">
      <p v-if="testError" class="test-error">{{ testError }}</p>
      <p v-else-if="testSkip !== null" class="test-meta">
        Skip graph result:
        <strong>{{ testSkip ? "skip (process aborted)" : "continue" }}</strong>
      </p>
      <Diff
        v-if="!testError"
        :current="testAfter"
        :prev="testBefore"
        :virtual-scroll="{ height: diffHeight, lineMinHeight: 24, delay: 100 }"
      />
    </div>
    <div class="editor-pane">
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
  flex: 0 0 40%;
  min-height: 140px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.35);
  overflow: hidden;
  background: #1a1c20;
}

.test-pane :deep(.vue-diff-wrapper) {
  margin: 0;
  border-radius: 0;
}

.test-pane :deep(.vue-diff-viewer) {
  padding: 0;
}

.test-error,
.test-meta {
  margin: 0;
  padding: 6px 8px;
  font-family: sans-serif;
  font-size: 11px;
  color: #eee;
}

.test-error {
  color: #ff8a80;
}

.editor-pane {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.code-main:not(.with-test) .editor-pane {
  flex: 1;
}
</style>
