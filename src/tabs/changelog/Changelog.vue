<script setup lang="ts">
import { loadChangelogs } from "./load";
import { closeChangelog } from "../../shell/tabs";

const entries = loadChangelogs();

function onBackdrop(event: MouseEvent): void {
  if (event.target === event.currentTarget) {
    closeChangelog();
  }
}
</script>

<template>
  <div class="changelog-overlay" @click="onBackdrop">
    <div
      class="changelog-window"
      role="dialog"
      aria-modal="true"
      aria-label="Changelog"
    >
      <header class="changelog-header">
        <h1 class="changelog-title">Changelog</h1>
        <button
          class="close-btn"
          type="button"
          title="Close"
          aria-label="Close"
          @click="closeChangelog"
        >
          x
        </button>
      </header>
      <div class="changelog-scroll">
        <p v-if="entries.length === 0" class="empty">No changelog entries yet.</p>
        <template v-else>
          <section
            v-for="(entry, index) in entries"
            :key="entry.version"
            class="entry"
          >
            <div class="entry-body" v-html="entry.html" />
            <hr v-if="index < entries.length - 1" class="separator" />
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.changelog-overlay {
  --panel-bg: #2a2d34;
  --panel-text: #eee;
  --panel-muted: rgba(238, 238, 238, 0.55);
  --panel-border: rgba(0, 0, 0, 0.35);
  --accent: #f5a623;
  --row-h: 20px;
  --pad: 8px;

  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.45);
  font-family: sans-serif;
  font-size: 14px;
  color: var(--panel-text);
}

.changelog-window {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(80vh, 720px);
  overflow: hidden;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 2px;
  font-family: sans-serif;
}

.changelog-header {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 4px 4px 4px 8px;
  border-bottom: 1px solid var(--panel-border);
}

.changelog-title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: normal;
  line-height: var(--row-h);
  color: var(--panel-text);
  font-family: sans-serif;
}

.close-btn {
  flex: none;
  width: 20px;
  height: var(--row-h);
  padding: 0;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-family: sans-serif;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.close-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
}

.changelog-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--pad);
  box-sizing: border-box;
}

.empty {
  margin: 0;
  color: var(--panel-muted);
  line-height: 1.45;
}

.entry-body {
  line-height: 1.45;
  font-family: sans-serif;
}

.entry-body :deep(h1),
.entry-body :deep(h2),
.entry-body :deep(h3),
.entry-body :deep(h4) {
  margin: 0 0 0.5em;
  font-weight: 600;
  line-height: 1.35;
  color: var(--panel-text);
  font-family: sans-serif;
}

.entry-body :deep(h1) {
  font-size: 18px;
}

.entry-body :deep(h2) {
  font-size: 16px;
}

.entry-body :deep(h3) {
  font-size: 15px;
}

.entry-body :deep(h4) {
  font-size: 14px;
}

.entry-body :deep(p),
.entry-body :deep(ul),
.entry-body :deep(ol) {
  margin: 0 0 0.75em;
}

.entry-body :deep(ul),
.entry-body :deep(ol) {
  padding-left: 1.4em;
}

.entry-body :deep(li) {
  margin: 0.15em 0;
}

.entry-body :deep(a) {
  color: var(--accent);
}

.entry-body :deep(code) {
  font-family: monospace;
}

.separator {
  margin: 12px 0;
  border: none;
  border-top: 1px solid var(--panel-border);
}
</style>
