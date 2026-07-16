<script setup lang="ts">
import { loggedIn } from "../../wiki/session";
import {
  applyCurrent,
  batchError,
  batchRunning,
  canPrimaryAction,
  canSkip,
  editSummary,
  markMinor,
  logStatus,
  primaryAction,
  reviewLogs,
  saveBusy,
  saveError,
  selectLogEntry,
  selectedLogId,
  skipCurrent,
  startBatch,
  stopBatch,
  undoCurrent,
} from "./state";
import { pageQueue } from "../../wiki/queue";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

async function onPrimaryAction(): Promise<void> {
  if (primaryAction.value === "undo") {
    await undoCurrent();
  } else {
    await applyCurrent();
  }
}

async function onBatchToggle(): Promise<void> {
  if (batchRunning.value) {
    stopBatch();
  } else {
    await startBatch();
  }
}
</script>

<template>
  <div class="review-sidebar">
    <textarea
      id="edit-summary"
      v-model="editSummary"
      class="panel-textarea"
      placeholder="Edit summary…"
      rows="2"
    />

    <label class="minor-toggle">
      <input v-model="markMinor" type="checkbox" />
      <span>Minor edit</span>
    </label>

    <div class="panel-actions">
      <button
        class="panel-btn"
        type="button"
        :disabled="(!loggedIn && !batchRunning) || (!batchRunning && pageQueue.length === 0)"
        @click="onBatchToggle"
      >
        {{ batchRunning ? "Stop" : "Start" }}
      </button>
      <button
        class="panel-btn"
        type="button"
        :disabled="!canPrimaryAction"
        @click="onPrimaryAction"
      >
        {{ saveBusy ? "…" : primaryAction === "undo" ? "Undo" : "Save" }}
      </button>
      <button
        class="panel-btn"
        type="button"
        :disabled="!canSkip"
        @click="skipCurrent"
      >
        Skip
      </button>
    </div>

    <p class="panel-muted">{{ pageQueue.length }} left in queue</p>
    <p v-if="saveError" class="panel-status error">{{ saveError }}</p>
    <p v-if="batchError" class="panel-status error">{{ batchError }}</p>

    <ul v-if="reviewLogs.length > 0" class="log-list">
      <li
        v-for="entry in reviewLogs"
        :key="entry.id"
        class="log-item"
        :class="{ selected: entry.id === selectedLogId }"
      >
        <button
          class="log-button"
          type="button"
          @click="selectLogEntry(entry.id)"
        >
          <span class="log-page">{{ entry.page }}</span>
          <span class="log-meta">
            <span class="chip" :data-status="logStatus(entry)">
              {{ logStatus(entry) }}
            </span>
            <time class="log-time" :datetime="String(entry.timestamp)">
              {{ formatTime(entry.timestamp) }}
            </time>
          </span>
        </button>
      </li>
    </ul>
    <p v-else class="empty">No edits yet</p>
  </div>
</template>

<style scoped>
.review-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--pad);
  flex: 1;
  min-height: 0;
}

.minor-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--panel-muted);
  line-height: var(--row-h);
  cursor: pointer;
  user-select: none;
}

.minor-toggle input {
  margin: 0;
  accent-color: var(--accent);
}

.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.log-item.selected .log-button {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
  background: rgba(245, 166, 35, 0.08);
}

.log-button {
  display: block;
  width: 100%;
  padding: 2px 4px;
  text-align: left;
  background: none;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.log-button:hover {
  background: rgba(255, 255, 255, 0.06);
}

.log-page {
  display: block;
  line-height: var(--row-h);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  line-height: var(--row-h);
}

.chip {
  padding: 0 4px;
  font-size: inherit;
  line-height: 1.3;
  text-transform: uppercase;
  border-radius: 2px;
}

.chip[data-status="applied"] {
  color: #b8f0c8;
  background: rgba(76, 175, 80, 0.25);
}

.chip[data-status="skipped"] {
  color: var(--panel-muted);
  background: rgba(255, 255, 255, 0.08);
}

.chip[data-status="undone"] {
  color: #ffd08a;
  background: rgba(245, 166, 35, 0.2);
}

.chip[data-status="pending"] {
  color: #9ec5ff;
  background: rgba(66, 133, 244, 0.2);
}

.log-time {
  color: var(--panel-muted);
  font-size: 10px;
}

.empty {
  margin: 0;
  color: var(--panel-muted);
}
</style>
