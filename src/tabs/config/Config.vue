<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { ExtensionRecord } from "../../db/open";
import {
  installExtension,
  listExtensions,
  removeExtension,
} from "../../extensions";
import {
  generateQueueTitles,
  listNamespaceOptions,
  loggedIn,
  loggedInAs,
  persistWikiConfig,
  prefetchMode,
  wikiOrigin,
} from "../../wiki/session";
import {
  pageQueue,
  pageQueueText,
  replaceQueue,
  setPageQueueFromText,
} from "../../wiki/queue";
import { clearPrefetch } from "../../wiki/prefetch";
import {
  buildQueueSource,
  catFiles,
  catPages,
  catSubcats,
  categoryTitle,
  linksFileUsage,
  linksIncludeRedirectTargets,
  linksOnTitle,
  linksRedirects,
  linksToTitle,
  linksTransclusions,
  linksWikilinks,
  prefixStrict,
  prefixText,
  searchQuery,
  selectedNamespaces,
  sourceKind,
  type SourceKind,
} from "./generatorState";

const queueDraft = ref(pageQueueText());
const generateBusy = ref(false);
const generateError = ref<string | null>(null);

const packUrl = ref("");
const installedPacks = ref<ExtensionRecord[]>([]);
const packBusy = ref(false);
const packError = ref<string | null>(null);
const removingPackId = ref<string | null>(null);

const namespaceChoices = computed(() => listNamespaceOptions());
const processAhead = computed({
  get: () => prefetchMode.value === "B",
  set: (value: boolean) => {
    prefetchMode.value = value ? "B" : "A";
    void persistWikiConfig();
  },
});

watch(pageQueue, () => {
  queueDraft.value = pageQueueText();
});

watch(loggedIn, (ok) => {
  if (ok && selectedNamespaces.value.length === 0) {
    selectedNamespaces.value = [0];
  }
});

const queueCount = computed(() => pageQueue.value.length);

async function refreshPacks(): Promise<void> {
  const packs = await listExtensions();
  installedPacks.value = packs.slice().sort((a, b) => a.id.localeCompare(b.id));
}

async function onInstallPack(): Promise<void> {
  const url = packUrl.value.trim();
  if (!url || packBusy.value) return;

  packBusy.value = true;
  packError.value = null;
  try {
    await installExtension(url);
    packUrl.value = "";
    await refreshPacks();
  } catch (err) {
    packError.value = err instanceof Error ? err.message : String(err);
  } finally {
    packBusy.value = false;
  }
}

async function onRemovePack(id: string): Promise<void> {
  if (packBusy.value || removingPackId.value) return;

  removingPackId.value = id;
  packError.value = null;
  try {
    await removeExtension(id);
    await refreshPacks();
  } catch (err) {
    packError.value = err instanceof Error ? err.message : String(err);
  } finally {
    removingPackId.value = null;
  }
}

function applyQueue(): void {
  clearPrefetch();
  setPageQueueFromText(queueDraft.value);
}

function selectSource(kind: SourceKind): void {
  sourceKind.value = kind;
}

function toggleNamespace(id: number): void {
  const set = new Set(selectedNamespaces.value);
  if (set.has(id)) {
    if (set.size === 1) return;
    set.delete(id);
  } else {
    set.add(id);
  }
  selectedNamespaces.value = [...set].sort((a, b) => a - b);
}

async function onGenerate(): Promise<void> {
  if (!loggedIn.value || generateBusy.value) return;
  generateBusy.value = true;
  generateError.value = null;
  try {
    const titles = await generateQueueTitles(
      buildQueueSource(),
      selectedNamespaces.value,
    );
    clearPrefetch();
    replaceQueue(titles);
    queueDraft.value = pageQueueText();
  } catch (err) {
    generateError.value = err instanceof Error ? err.message : String(err);
  } finally {
    generateBusy.value = false;
  }
}

onMounted(() => {
  void refreshPacks();
});
</script>

<template>
  <div class="config-main">
    <header class="header">
      <h1 class="title">Config</h1>
      <p class="status">
        <template v-if="loggedIn">
          Logged in as <strong>{{ loggedInAs }}</strong>
          <span class="muted"> · {{ wikiOrigin }}</span>
        </template>
        <template v-else>Not logged in</template>
      </p>
    </header>

    <div class="config-cols">
      <section class="generator-col">
        <div class="col-header">
          <span class="section-label">Generator</span>
          <label class="process-ahead">
            <input v-model="processAhead" type="checkbox" />
            process ahead?
          </label>
        </div>

        <div class="generate-grid">
          <div class="sources">
            <div
              class="source"
              :class="{ active: sourceKind === 'category' }"
              @click="selectSource('category')"
            >
              <label class="source-head" @click.stop>
                <input
                  type="radio"
                  name="source"
                  :checked="sourceKind === 'category'"
                  @change="selectSource('category')"
                />
                <span>Category</span>
              </label>
              <input
                v-model="categoryTitle"
                class="panel-input"
                type="text"
                :disabled="sourceKind !== 'category'"
                placeholder="Category:Example"
              />
              <div class="checks">
                <label
                  ><input
                    v-model="catPages"
                    type="checkbox"
                    :disabled="sourceKind !== 'category'"
                  />
                  pages</label
                >
                <label
                  ><input
                    v-model="catSubcats"
                    type="checkbox"
                    :disabled="sourceKind !== 'category'"
                  />
                  subcategories</label
                >
                <label
                  ><input
                    v-model="catFiles"
                    type="checkbox"
                    :disabled="sourceKind !== 'category'"
                  />
                  files</label
                >
              </div>
            </div>

            <div
              class="source"
              :class="{ active: sourceKind === 'linksTo' }"
              @click="selectSource('linksTo')"
            >
              <label class="source-head" @click.stop>
                <input
                  type="radio"
                  name="source"
                  :checked="sourceKind === 'linksTo'"
                  @change="selectSource('linksTo')"
                />
                <span>Links to page</span>
              </label>
              <label class="inline-field">
                <span>Links to:</span>
                <input
                  v-model="linksToTitle"
                  class="panel-input"
                  type="text"
                  :disabled="sourceKind !== 'linksTo'"
                />
              </label>
              <div class="checks">
                <label
                  ><input
                    v-model="linksWikilinks"
                    type="checkbox"
                    :disabled="sourceKind !== 'linksTo'"
                  />
                  wikilinks</label
                >
                <label
                  ><input
                    v-model="linksTransclusions"
                    type="checkbox"
                    :disabled="sourceKind !== 'linksTo'"
                  />
                  transclusions</label
                >
                <label
                  ><input
                    v-model="linksFileUsage"
                    type="checkbox"
                    :disabled="sourceKind !== 'linksTo'"
                  />
                  file usage</label
                >
              </div>
              <div class="checks">
                <label
                  ><input
                    v-model="linksRedirects"
                    type="radio"
                    value="all"
                    :disabled="sourceKind !== 'linksTo'"
                  />
                  both</label
                >
                <label
                  ><input
                    v-model="linksRedirects"
                    type="radio"
                    value="redirects"
                    :disabled="sourceKind !== 'linksTo'"
                  />
                  redirects</label
                >
                <label
                  ><input
                    v-model="linksRedirects"
                    type="radio"
                    value="nonredirects"
                    :disabled="sourceKind !== 'linksTo'"
                  />
                  non-redirects</label
                >
              </div>
              <label class="check-alone">
                <input
                  v-model="linksIncludeRedirectTargets"
                  type="checkbox"
                  :disabled="sourceKind !== 'linksTo'"
                />
                Include links to redirects
              </label>
            </div>

            <div
              class="source"
              :class="{ active: sourceKind === 'prefix' }"
              @click="selectSource('prefix')"
            >
              <label class="source-head" @click.stop>
                <input
                  type="radio"
                  name="source"
                  :checked="sourceKind === 'prefix'"
                  @change="selectSource('prefix')"
                />
                <span>Pages with prefix</span>
              </label>
              <label class="inline-field">
                <span>Prefix:</span>
                <input
                  v-model="prefixText"
                  class="panel-input"
                  type="text"
                  :disabled="sourceKind !== 'prefix'"
                />
              </label>
              <label class="check-alone">
                <input
                  v-model="prefixStrict"
                  type="checkbox"
                  :disabled="sourceKind !== 'prefix'"
                />
                Strict prefix search
              </label>
            </div>

            <div
              class="source"
              :class="{ active: sourceKind === 'linksOn' }"
              @click="selectSource('linksOn')"
            >
              <label class="source-head" @click.stop>
                <input
                  type="radio"
                  name="source"
                  :checked="sourceKind === 'linksOn'"
                  @change="selectSource('linksOn')"
                />
                <span>Links on page</span>
              </label>
              <label class="inline-field">
                <span>On page:</span>
                <input
                  v-model="linksOnTitle"
                  class="panel-input"
                  type="text"
                  :disabled="sourceKind !== 'linksOn'"
                />
              </label>
            </div>

            <div
              class="source"
              :class="{ active: sourceKind === 'search' }"
              @click="selectSource('search')"
            >
              <label class="source-head" @click.stop>
                <input
                  type="radio"
                  name="source"
                  :checked="sourceKind === 'search'"
                  @change="selectSource('search')"
                />
                <span>Wiki search</span>
              </label>
              <label class="inline-field">
                <span>Search term:</span>
                <input
                  v-model="searchQuery"
                  class="panel-input"
                  type="text"
                  :disabled="sourceKind !== 'search'"
                  placeholder="insource:/example/"
                />
              </label>
              <p class="hint">
                Tip: use <code>insource:/…/</code> or <code>intitle:/…/</code>
              </p>
            </div>
          </div>

          <div class="namespaces">
            <span class="section-label">Namespace</span>
            <div class="ns-list" :class="{ disabled: !loggedIn }">
              <button
                v-for="ns in namespaceChoices"
                :key="ns.id"
                type="button"
                class="ns-item"
                :class="{ selected: selectedNamespaces.includes(ns.id) }"
                :disabled="!loggedIn"
                @click="toggleNamespace(ns.id)"
              >
                {{ ns.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="generate-actions">
          <button
            class="queue-btn primary"
            type="button"
            :disabled="!loggedIn || generateBusy"
            :title="loggedIn ? 'Generate queue' : 'Log in to generate'"
            @click="onGenerate"
          >
            {{ generateBusy ? "…" : "Generate" }}
          </button>
          <p v-if="generateError" class="error">{{ generateError }}</p>
          <p v-else-if="!loggedIn" class="hint">Log in to generate a queue</p>
        </div>
      </section>

      <section class="queue-col">
        <div class="queue-header">
          <span class="section-label">Page queue</span>
          <span class="muted">{{ queueCount }} page(s)</span>
        </div>
        <textarea
          v-model="queueDraft"
          class="queue-textarea"
          placeholder="One page title per line&#10;Example&#10;Main Page&#10;Help:Contents"
        />
        <div class="queue-actions">
          <button class="queue-btn" type="button" @click="applyQueue">
            Set queue
          </button>
        </div>
      </section>

      <section class="packs-col">
        <div class="queue-header">
          <span class="section-label">Nodepacks</span>
          <span class="muted">{{ installedPacks.length }} pack(s)</span>
        </div>

        <div class="pack-install">
          <input
            v-model="packUrl"
            class="panel-input"
            type="url"
            placeholder="URL to the pack"
            :disabled="packBusy"
            @keydown.enter.prevent="onInstallPack"
          />
          <button
            class="queue-btn primary"
            type="button"
            :disabled="packBusy || !packUrl.trim()"
            @click="onInstallPack"
          >
            {{ packBusy ? "…" : "Install" }}
          </button>
        </div>

        <p v-if="packError" class="error">{{ packError }}</p>

        <ul v-if="installedPacks.length > 0" class="pack-list">
          <li v-for="pack in installedPacks" :key="pack.id" class="pack-item">
            <div class="pack-meta">
              <span class="pack-id">{{ pack.id }}</span>
              <span class="pack-url muted" :title="pack.url">{{
                pack.url
              }}</span>
            </div>
            <button
              class="queue-btn"
              type="button"
              :disabled="packBusy || removingPackId !== null"
              @click="onRemovePack(pack.id)"
            >
              {{ removingPackId === pack.id ? "…" : "Remove" }}
            </button>
          </li>
        </ul>
        <p v-else class="hint">No nodepacks installed yet</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.config-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  font-family: sans-serif;
  color: #eee;
  overflow: hidden;
}

.header {
  flex: none;
}

.title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
}

.status {
  margin: 0;
  font-size: 13px;
}

.muted {
  color: rgba(238, 238, 238, 0.55);
}

.section-label {
  font-size: 12px;
  font-weight: 600;
}

.config-cols {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.generator-col,
.queue-col,
.packs-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  min-width: 0;
}
.generator-col {
  flex: 2;
}

.queue-col {
  flex: 1;
  max-width: 440px;
}

.packs-col {
  flex: 1;
  max-width: 360px;
}

.col-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: none;
}

.process-ahead,
.check-alone,
.checks label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(238, 238, 238, 0.85);
}

.generate-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.sources {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.source {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.18);
  cursor: pointer;
}

.source.active {
  border-color: #f5a623;
}

.source-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
}

.inline-field {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 6px;
  align-items: center;
  font-size: 12px;
}

.panel-input {
  width: 100%;
  box-sizing: border-box;
  height: 24px;
  padding: 0 8px;
  font: inherit;
  font-size: 12px;
  color: #eee;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 2px;
}

.panel-input:focus {
  outline: 1px solid #f5a623;
}

.panel-input:disabled {
  opacity: 0.45;
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: rgba(238, 238, 238, 0.5);
}

.hint code {
  font-size: 11px;
}

.namespaces {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.ns-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-height: 120px;
  overflow: auto;
  border: 1px solid rgba(0, 0, 0, 0.35);
  background: rgba(0, 0, 0, 0.18);
}

.ns-list.disabled {
  opacity: 0.5;
}

.ns-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: rgba(238, 238, 238, 0.8);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.ns-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.ns-item.selected {
  background: rgba(245, 166, 35, 0.25);
  color: #fff;
}

.generate-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.error {
  margin: 0;
  font-size: 12px;
  color: #f88;
}

.queue-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  flex: none;
}

.queue-textarea {
  flex: 1;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  color: #eee;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 2px;
  resize: none;
}

.queue-textarea::placeholder {
  color: rgba(238, 238, 238, 0.4);
}

.queue-textarea:focus {
  outline: 1px solid #f5a623;
  outline-offset: 0;
}

.queue-actions {
  display: flex;
  gap: 4px;
  flex: none;
}

.queue-btn {
  height: 22px;
  padding: 0 10px;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.queue-btn.primary {
  background: rgba(245, 166, 35, 0.2);
  color: #fff;
}

.queue-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.queue-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.4);
}

.pack-install {
  display: flex;
  gap: 6px;
  flex: none;
  align-items: center;
}

.pack-install .panel-input {
  flex: 1;
  min-width: 0;
}

.pack-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pack-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.18);
}

.pack-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pack-id {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pack-url {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .config-cols {
    flex-direction: column;
    overflow: auto;
  }

  .generate-grid {
    grid-template-columns: 1fr;
  }

  .queue-textarea {
    min-height: 160px;
  }

  .packs-col,
  .queue-col {
    max-width: none;
  }
}
</style>
