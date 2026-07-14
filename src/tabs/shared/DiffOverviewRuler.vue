<script setup lang="ts">
import { useElementSize, useEventListener } from "@vueuse/core";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import {
  buildDiffOverview,
  type DiffOverviewRow,
  type LineChangeKind,
} from "./diffLines";

const props = withDefaults(
  defineProps<{
    prev: string;
    current: string;
    /** Element that contains `.vue-diff-viewer`. */
    root: HTMLElement | null;
    lineMinHeight?: number;
  }>(),
  { lineMinHeight: 24 },
);

const MARK_COLORS: Record<LineChangeKind, string> = {
  added: "#3d8f5a",
  removed: "#c45c5c",
  modified: "#449ee3",
};

const rulerRef = useTemplateRef<HTMLElement>("ruler");
const canvasRef = useTemplateRef<HTMLCanvasElement>("canvas");
const { height: rulerHeight, width: rulerWidth } = useElementSize(rulerRef);

const viewer = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const scrollHeight = ref(0);
const clientHeight = ref(0);
const contentWidth = ref(800);
const dragging = ref(false);
/** Live row geometry from the DOM when available. */
const domRows = ref<DiffOverviewRow[] | null>(null);

const overview = computed(() =>
  buildDiffOverview(
    props.prev,
    props.current,
    props.lineMinHeight,
    contentWidth.value,
  ),
);

const overflowing = computed(() => scrollHeight.value > clientHeight.value + 1);

const thumbStyle = computed(() => {
  const rh = rulerHeight.value;
  const sh = scrollHeight.value;
  const ch = clientHeight.value;
  if (rh <= 0 || sh <= 0) return { top: "0px", height: "0px" };
  const thumbH = Math.max(8, (ch / sh) * rh);
  const maxScroll = Math.max(1, sh - ch);
  const maxTop = Math.max(0, rh - thumbH);
  const top = (scrollTop.value / maxScroll) * maxTop;
  return {
    top: `${top}px`,
    height: `${thumbH}px`,
  };
});

function findViewer(): HTMLElement | null {
  return (
    (props.root?.querySelector(".vue-diff-viewer") as HTMLElement | null) ??
    null
  );
}

function syncScrollMetrics(): void {
  const el = viewer.value;
  if (!el) {
    scrollTop.value = 0;
    scrollHeight.value = 0;
    clientHeight.value = 0;
    return;
  }
  scrollTop.value = el.scrollTop;
  scrollHeight.value = el.scrollHeight;
  clientHeight.value = el.clientHeight;
  contentWidth.value = el.clientWidth || contentWidth.value;
}

function measureDomRows(): void {
  const el = viewer.value;
  if (!el) {
    domRows.value = null;
    return;
  }
  const nodes = el.querySelectorAll(".vue-diff-row");
  if (nodes.length === 0) {
    domRows.value = null;
    return;
  }
  const rows: DiffOverviewRow[] = [];
  for (const node of nodes) {
    const row = node as HTMLElement;
    const removed = !!row.querySelector(".vue-diff-cell-removed");
    const added = !!row.querySelector(".vue-diff-cell-added");
    if (!removed && !added) continue;
    const kind: LineChangeKind =
      removed && added ? "modified" : removed ? "removed" : "added";
    rows.push({
      top: row.offsetTop,
      height: Math.max(1, row.offsetHeight),
      kind,
      left: undefined,
      right: undefined,
    });
  }
  domRows.value = rows;
}

function bindViewer(): void {
  viewer.value = findViewer();
  syncScrollMetrics();
  measureDomRows();
  paint();
}

function scrollViewerToRatio(ratio: number): void {
  const el = viewer.value;
  if (!el) return;
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
  el.scrollTop = Math.min(1, Math.max(0, ratio)) * maxScroll;
  syncScrollMetrics();
}

function ratioFromPointer(clientY: number): number {
  const el = rulerRef.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  return (clientY - rect.top) / rect.height;
}

function onPointerDown(e: PointerEvent): void {
  if (!overflowing.value) return;
  dragging.value = true;
  rulerRef.value?.setPointerCapture(e.pointerId);
  scrollViewerToRatio(ratioFromPointer(e.clientY));
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging.value) return;
  scrollViewerToRatio(ratioFromPointer(e.clientY));
}

function onPointerUp(e: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  try {
    rulerRef.value?.releasePointerCapture(e.pointerId);
  } catch {
    /* already released */
  }
}

function paint(): void {
  const canvas = canvasRef.value;
  const el = rulerRef.value;
  if (!canvas || !el) return;

  const cssW = Math.max(1, rulerWidth.value || el.clientWidth || 4);
  const cssH = Math.max(1, rulerHeight.value || el.clientHeight || 1);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const measured = domRows.value;
  const model = overview.value;
  const marks =
    measured && measured.length > 0
      ? measured
      : model.rows.filter((r) => r.kind !== "equal");
  const total =
    measured && measured.length > 0
      ? Math.max(1, scrollHeight.value || 1)
      : Math.max(model.totalHeight, scrollHeight.value || 0, 1);
  const scale = cssH / total;

  for (const row of marks) {
    const y = row.top * scale;
    const h = Math.max(2, row.height * scale);
    ctx.fillStyle = MARK_COLORS[row.kind as LineChangeKind];
    ctx.fillRect(0, y, cssW, h);
  }
}

watch(
  () => props.root,
  async () => {
    await nextTick();
    requestAnimationFrame(() => bindViewer());
  },
  { immediate: true },
);

watch(
  () => [props.prev, props.current, props.lineMinHeight] as const,
  async () => {
    await nextTick();
    requestAnimationFrame(() => bindViewer());
  },
);

watch([rulerHeight, rulerWidth, overview, scrollHeight, domRows], () => {
  paint();
});

useEventListener(
  viewer,
  "scroll",
  () => {
    syncScrollMetrics();
  },
  { passive: true },
);

let resizeObserver: ResizeObserver | null = null;
watch(viewer, (el, _prev, onCleanup) => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el) return;
  resizeObserver = new ResizeObserver(() => {
    syncScrollMetrics();
    measureDomRows();
    paint();
  });
  resizeObserver.observe(el);
  const inner = el.querySelector(".vue-diff-viewer-inner");
  if (inner) resizeObserver.observe(inner);
  onCleanup(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
  });
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <div
    v-show="overflowing"
    ref="ruler"
    class="overview-ruler"
    role="scrollbar"
    :aria-valuenow="Math.round(scrollTop)"
    :aria-valuemin="0"
    :aria-valuemax="Math.max(0, scrollHeight - clientHeight)"
    aria-orientation="vertical"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <canvas ref="canvas" class="overview-canvas" />
    <div class="overview-thumb" :style="thumbStyle" />
  </div>
</template>

<style scoped>
.overview-ruler {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  width: 4px;
  background: rgba(26, 28, 32, 0.85);
  cursor: pointer;
  touch-action: none;
  user-select: none;
}

.overview-canvas {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.overview-thumb {
  position: absolute;
  left: 0;
  right: 0;
  background: rgba(255, 255, 255, 0.22);
  pointer-events: none;
}
</style>
