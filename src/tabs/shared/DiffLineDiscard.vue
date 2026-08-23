<script setup lang="ts">
import { useEventListener } from "@vueuse/core";
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  findRestoreRowIndex,
  listLineDiscards,
  type LineRestoreRecord,
} from "./diffLines";

const props = defineProps<{
  /** Element that contains `.vue-diff-viewer`. */
  root: HTMLElement | null;
  prev: string;
  current: string;
  restores: LineRestoreRecord[];
}>();

const emit = defineEmits<{
  discard: [rowIndex: number];
  restore: [id: string];
}>();

type OverlayItem = {
  key: string;
  rowIndex: number;
  top: number;
  height: number;
  discard: boolean;
  restoreId: string | null;
};

const items = ref<OverlayItem[]>([]);
const scrollTop = ref(0);
let viewerEl: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;

function findViewer(): HTMLElement | null {
  return (
    (props.root?.querySelector(".vue-diff-viewer") as HTMLElement | null) ??
    null
  );
}

function syncOverlay(): void {
  const viewer = findViewer();
  if (viewer !== viewerEl) {
    resizeObserver?.disconnect();
    resizeObserver = null;
    viewerEl = viewer;
    if (viewer) {
      resizeObserver = new ResizeObserver(() => syncOverlay());
      resizeObserver.observe(viewer);
    }
  }

  if (!viewer) {
    items.value = [];
    scrollTop.value = 0;
    return;
  }

  scrollTop.value = viewer.scrollTop;
  const rows = viewer.querySelectorAll(".vue-diff-row");
  const viewerTop = viewer.getBoundingClientRect().top;

  const byRow = new Map<
    number,
    { discard: boolean; restoreId: string | null }
  >();

  for (const target of listLineDiscards(props.prev, props.current)) {
    byRow.set(target.rowIndex, { discard: true, restoreId: null });
  }

  for (const record of props.restores) {
    const rowIndex = findRestoreRowIndex(props.prev, props.current, record);
    if (rowIndex === null) continue;
    const existing = byRow.get(rowIndex);
    if (existing) {
      existing.restoreId = record.id;
    } else {
      byRow.set(rowIndex, { discard: false, restoreId: record.id });
    }
  }

  const next: OverlayItem[] = [];
  for (const [rowIndex, actions] of byRow) {
    const row = rows[rowIndex] as HTMLElement | undefined;
    if (!row) continue;
    if (
      actions.discard &&
      !row.querySelector(".vue-diff-cell-removed, .vue-diff-cell-added")
    ) {
      continue;
    }
    const rowRect = row.getBoundingClientRect();
    next.push({
      key: `${rowIndex}:${actions.restoreId ?? "d"}`,
      rowIndex,
      top: rowRect.top - viewerTop + viewer.scrollTop,
      height: Math.max(1, rowRect.height),
      discard: actions.discard,
      restoreId: actions.restoreId,
    });
  }

  items.value = next;
}

function onDiscard(rowIndex: number, event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  emit("discard", rowIndex);
}

function onRestore(id: string, event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  emit("restore", id);
}

watch(
  () =>
    [props.root, props.prev, props.current, props.restores] as const,
  async () => {
    await nextTick();
    requestAnimationFrame(() => syncOverlay());
  },
  { immediate: true, flush: "post", deep: true },
);

useEventListener(
  () => findViewer(),
  "scroll",
  () => {
    const viewer = findViewer();
    if (viewer) scrollTop.value = viewer.scrollTop;
  },
  { passive: true },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  viewerEl = null;
});
</script>

<template>
  <div
    v-if="root && items.length > 0"
    class="line-action-layer"
  >
    <div
      class="line-action-scroller"
      :style="{ transform: `translateY(${-scrollTop}px)` }"
    >
      <div
        v-for="item in items"
        :key="item.key"
        class="line-action-cluster"
        :style="{
          top: `${item.top + item.height / 2}px`,
        }"
      >
        <button
          v-if="item.discard"
          type="button"
          class="line-action-btn discard"
          title="Discard this line change"
          aria-label="Discard this line change"
          @click="onDiscard(item.rowIndex, $event)"
        >
          ×
        </button>
        <button
          v-if="item.restoreId"
          type="button"
          class="line-action-btn restore"
          title="Restore this line change"
          aria-label="Restore this line change"
          @click="onRestore(item.restoreId, $event)"
        >
          ↩
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-action-layer {
  position: absolute;
  inset: 0 12px 0 0;
  z-index: 3;
  overflow: hidden;
  pointer-events: none;
}

.line-action-scroller {
  position: relative;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.line-action-cluster {
  position: absolute;
  left: 50%;
  z-index: 1;
  display: flex;
  gap: 2px;
  transform: translate(-50%, -50%);
  pointer-events: auto;
}

.line-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 2px;
  font: 12px/1 sans-serif;
  color: rgba(255, 255, 255, 0.75);
  background: #2a2d34;
  cursor: pointer;
}

.line-action-btn:hover,
.line-action-btn:focus-visible {
  color: #fff;
  background: #3a3f48;
  outline: 1px solid #f5a623;
  outline-offset: 0;
}

.line-action-btn.discard:hover,
.line-action-btn.discard:focus-visible {
  color: #ff8a80;
}

.line-action-btn.restore:hover,
.line-action-btn.restore:focus-visible {
  color: #b8f0c8;
}
</style>
