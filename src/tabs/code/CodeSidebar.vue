<script setup lang="ts">
import { isAbortError } from "@nodish/core";
import { getPage, loggedIn } from "../../wiki/session";
import { runGraphsForPage } from "../../wiki/runPage";
import {
  activeCodeGraph,
  liveEvaluation,
  setPreviewFromTest,
  testAfter,
  testBefore,
  testBusy,
  testError,
  testPageTitle,
  testPanelOpen,
  testReasoning,
  testSkip,
  type CodeGraphKind,
} from "./state";

let testGeneration = 0;
let testAbort: AbortController | null = null;

async function runTest(): Promise<void> {
  const title = testPageTitle.value.trim();
  if (!title || !loggedIn.value) return;

  const gen = ++testGeneration;
  testAbort?.abort();
  const ac = new AbortController();
  testAbort = ac;

  testBusy.value = true;
  testError.value = null;
  testSkip.value = null;
  testReasoning.value = null;
  testPanelOpen.value = true;

  try {
    const { titleObj, content, prefixed } = await getPage(title);
    if (gen !== testGeneration) return;
    // Keep for NodeViewer live eval even if graphs error / panel is closed later.
    setPreviewFromTest(titleObj, content);
    const outcome = await runGraphsForPage(
      titleObj,
      content,
      prefixed,
      ac.signal,
    );
    if (gen !== testGeneration) return;

    if (outcome.kind === "error") {
      testBefore.value = content;
      testAfter.value = content;
      testError.value = outcome.message;
      testReasoning.value = null;
      return;
    }

    testBefore.value = outcome.before;
    if (outcome.kind === "skip") {
      testSkip.value = true;
      testAfter.value = outcome.before;
      testReasoning.value = null;
    } else if (outcome.kind === "noop") {
      testSkip.value = false;
      testAfter.value = outcome.before;
      testReasoning.value = null;
    } else {
      testSkip.value = false;
      testAfter.value = outcome.after;
      testReasoning.value = outcome.reasoning;
    }
    testPageTitle.value = prefixed;
  } catch (err) {
    if (gen !== testGeneration || isAbortError(err)) return;
    testError.value = err instanceof Error ? err.message : String(err);
    testBefore.value = "";
    testAfter.value = "";
    testReasoning.value = null;
  } finally {
    if (gen === testGeneration) {
      testBusy.value = false;
    }
  }
}

function clearTest(): void {
  testPanelOpen.value = false;
  testBefore.value = "";
  testAfter.value = "";
  testSkip.value = null;
  testError.value = null;
  testReasoning.value = null;
}

function setGraph(kind: CodeGraphKind): void {
  activeCodeGraph.value = kind;
}
</script>

<template>
  <div class="code-sidebar">
    <div class="panel-actions" data-tour="code-graph-toggle">
      <button
        class="panel-btn"
        type="button"
        :class="{ active: activeCodeGraph === 'process' }"
        @click="setGraph('process')"
      >
        Process
      </button>
      <button
        class="panel-btn"
        type="button"
        :class="{ active: activeCodeGraph === 'skip' }"
        @click="setGraph('skip')"
      >
        Skip
      </button>
    </div>

    <label
      class="live-eval-toggle"
      title="Re-evaluate the graph whenever nodes or wires change. Can help find bugs; however, it can also slow down the UI."
    >
      <input v-model="liveEvaluation" type="checkbox" />
      <span>live evaluation</span>
    </label>

    <label class="panel-field" data-tour="code-test-page">
      <span class="panel-label">Test page</span>
      <input
        v-model="testPageTitle"
        class="panel-input"
        type="text"
        placeholder="Page title"
        autocomplete="off"
      />
    </label>

    <div class="panel-actions" data-tour="code-test-actions">
      <button
        class="panel-btn"
        type="button"
        :disabled="testBusy || !loggedIn || !testPageTitle.trim()"
        @click="runTest"
      >
        {{ testBusy ? "…" : "Test" }}
      </button>
      <button
        class="panel-btn"
        type="button"
        :disabled="!testPanelOpen"
        @click="clearTest"
      >
        Close
      </button>
    </div>

    <p v-if="!loggedIn" class="panel-muted">Log in to fetch a test page</p>

    <div class="reasoning-region"></div>
    <div
      v-if="testReasoning != null"
      class="reasoning-panel"
    >
      {{ testReasoning }}
    </div>
  </div>
</template>

<style scoped>
.code-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--pad);
  flex: 1;
  min-height: 0;
}

.panel-btn.active {
  color: #fff;
  outline: 1px solid var(--accent);
  outline-offset: -1px;
  background: rgba(245, 166, 35, 0.08);
}

.live-eval-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--panel-muted);
  line-height: var(--row-h);
  cursor: pointer;
  user-select: none;
}

.live-eval-toggle input {
  margin: 0;
  accent-color: var(--accent);
}

.reasoning-region {
  flex: 1;
  min-height: 0;
}

.reasoning-panel {
  flex: 0 1 auto;
  max-height: min(12em, 30%);
  overflow-y: auto;
  white-space: pre-wrap;
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--panel-muted);
  font-size: 12px;
  line-height: 1.4;
}
</style>
