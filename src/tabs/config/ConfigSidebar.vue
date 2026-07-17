<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  applyWikiOrigin,
  canLogin,
  login,
  loginBusy,
  loginError,
  loggedIn,
  logout as wikiLogout,
  password,
  username,
  wikiOrigin,
} from "../../wiki/session";

const originDraft = ref(wikiOrigin.value);
const oauthEnabled = ref(false);
const authConfigLoaded = ref(false);

watch(wikiOrigin, (value) => {
  originDraft.value = value;
});

const canSetOrigin = computed(() => {
  if (loginBusy.value) return false;
  const draft = originDraft.value.trim();
  if (!draft) return false;
  try {
    const next = new URL(draft).origin;
    return next !== wikiOrigin.value;
  } catch {
    return false;
  }
});

function onSetOrigin(): void {
  applyWikiOrigin(originDraft.value);
}

async function loadAuthConfig(): Promise<void> {
  try {
    const res = await fetch("/api/auth/config", { credentials: "include" });
    if (res.ok) {
      const data = (await res.json()) as { oauth?: boolean };
      oauthEnabled.value = Boolean(data.oauth);
    }
  } catch {
    oauthEnabled.value = false;
  } finally {
    authConfigLoaded.value = true;
  }
}

function startOAuth(): void {
  window.location.assign("/api/oauth/start");
}

async function onLogout(): Promise<void> {
  if (oauthEnabled.value) {
    try {
      await fetch("/api/oauth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      /* still clear local session */
    }
  }
  await wikiLogout();
}

onMounted(() => {
  void loadAuthConfig();
});
</script>

<template>
  <div class="config-sidebar">
    <label class="panel-field">
      <span class="panel-label">Wiki origin</span>
      <div class="origin-row">
        <input
          v-model="originDraft"
          class="panel-input"
          type="url"
          placeholder="https://en.wikipedia.org"
          autocomplete="off"
          @keydown.enter.prevent="onSetOrigin"
        />
        <button
          class="panel-btn"
          type="button"
          :disabled="!canSetOrigin"
          @click="onSetOrigin"
        >
          Set
        </button>
      </div>
    </label>

    <template v-if="authConfigLoaded && oauthEnabled">
      <div class="panel-actions">
        <button
          class="panel-btn"
          type="button"
          :disabled="loggedIn || loginBusy"
          @click="startOAuth"
        >
          OAuth Login
        </button>
        <button
          class="panel-btn"
          type="button"
          :disabled="!loggedIn || loginBusy"
          @click="onLogout"
        >
          Logout
        </button>
      </div>
    </template>

    <template v-else-if="authConfigLoaded">
      <label class="panel-field">
        <span class="panel-label">Username</span>
        <input
          v-model="username"
          class="panel-input"
          type="text"
          placeholder="User@BotName"
          autocomplete="username"
        />
      </label>

      <label class="panel-field">
        <span class="panel-label">Bot password</span>
        <input
          v-model="password"
          class="panel-input"
          type="password"
          placeholder="Not stored"
          autocomplete="current-password"
        />
      </label>

      <div class="panel-actions">
        <button
          class="panel-btn"
          type="button"
          :disabled="!canLogin"
          @click="login"
        >
          {{ loginBusy ? "…" : "Login" }}
        </button>
        <button
          class="panel-btn"
          type="button"
          :disabled="!loggedIn || loginBusy"
          @click="onLogout"
        >
          Logout
        </button>
      </div>
    </template>

    <p v-if="loginError" class="panel-status error">{{ loginError }}</p>
  </div>
</template>

<style scoped>
.config-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--pad);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.origin-row {
  display: flex;
  gap: 2px;
  align-items: center;
}

.origin-row .panel-input {
  flex: 1;
  min-width: 0;
  width: auto;
}

.origin-row .panel-btn {
  flex: none;
  padding: 0 8px;
}
</style>
