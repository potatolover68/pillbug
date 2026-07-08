<script setup lang="ts">
import { Diff } from "vue-diff";
import "vue-diff/dist/index.css";
import { useElementSize } from "@vueuse/core";
import { computed, useTemplateRef } from "vue";
import { currentAfter, currentBefore } from "./state";

const { height: containerHeight } = useElementSize(useTemplateRef("container"));

const height = computed(() => containerHeight.value || window.innerHeight);
</script>

<template>
  <div ref="container" class="review-diff">
    <Diff
      :current="currentAfter"
      :prev="currentBefore"
      :virtual-scroll="{ height, lineMinHeight: 24, delay: 100 }"
    />
  </div>
</template>

<style scoped>
.review-diff {
  width: 100%;
  height: 100%;
}

.review-diff :deep(.vue-diff-wrapper) {
  margin: 0;
  border-radius: 0;
}

.review-diff :deep(.vue-diff-viewer) {
  padding: 0;
}

.review-diff :deep(pre code.hljs) {
  padding: 0;
}
</style>
