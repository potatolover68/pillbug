<script setup lang="ts">
import {
  canLogin,
  login,
  loginBusy,
  loginError,
  loggedIn,
  logout,
  password,
  userAgent,
  username,
  wikiOrigin,
} from "../../wiki/session";
</script>

<template>
  <div class="config-sidebar">
    <label class="panel-field">
      <span class="panel-label">Wiki origin</span>
      <input
        v-model="wikiOrigin"
        class="panel-input"
        type="url"
        placeholder="https://en.wikipedia.org"
        autocomplete="off"
      />
    </label>

    <label class="panel-field">
      <span class="panel-label">User agent</span>
      <input
        v-model="userAgent"
        class="panel-input"
        type="text"
        autocomplete="off"
      />
    </label>

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
        @click="logout"
      >
        Logout
      </button>
    </div>

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
</style>
