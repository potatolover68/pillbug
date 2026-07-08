<script setup lang="ts">
import { getPage, loggedIn } from "../../wiki/session";
import { runGraphsForPage } from "../../wiki/runPage";
import {
  activeCodeGraph,
  setPreviewFromTest,
  testAfter,
  testBefore,
  testBusy,
  testError,
  testPageTitle,
  testPanelOpen,
  testSkip,
  type CodeGraphKind,
} from "./state";

async function runTest(): Promise<void> {
  const title = testPageTitle.value.trim();
  if (!title || !loggedIn.value) return;

  testBusy.value = true;
  testError.value = null;
  testSkip.value = null;
  testPanelOpen.value = true;

  try {
    const { titleObj, content, prefixed } = await getPage(title);
    // Keep for NodeViewer live eval even if graphs error / panel is closed later.
    setPreviewFromTest(titleObj, content);
    const outcome = runGraphsForPage(titleObj, content, prefixed);

    if (outcome.kind === "error") {
      testBefore.value = content;
      testAfter.value = content;
      testError.value = outcome.message;
      return;
    }

    testBefore.value = outcome.before;
    if (outcome.kind === "skip") {
      testSkip.value = true;
      testAfter.value = outcome.before;
    } else if (outcome.kind === "noop") {
      testSkip.value = false;
      testAfter.value = outcome.before;
    } else {
      testSkip.value = false;
      testAfter.value = outcome.after;
    }
    testPageTitle.value = prefixed;
  } catch (err) {
    testError.value = err instanceof Error ? err.message : String(err);
    testBefore.value = "";
    testAfter.value = "";
  } finally {
    testBusy.value = false;
  }
}

function clearTest(): void {
  testPanelOpen.value = false;
  testBefore.value = "";
  testAfter.value = "";
  testSkip.value = null;
  testError.value = null;
}

function setGraph(kind: CodeGraphKind): void {
  activeCodeGraph.value = kind;
}
</script>

<template>
  <div class="code-sidebar">
    <div class="panel-actions">
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

    <p class="panel-muted">
      <template v-if="activeCodeGraph === 'process'">
        Transforms page text: Title + Content → ContentAfter
      </template>
      <template v-else>
        Predicate: Title + Content → Skip (true aborts process)
      </template>
    </p>

    <label class="panel-field">
      <span class="panel-label">Test page</span>
      <input
        v-model="testPageTitle"
        class="panel-input"
        type="text"
        placeholder="Page title"
        autocomplete="off"
      />
    </label>

    <div class="panel-actions">
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
</style>
