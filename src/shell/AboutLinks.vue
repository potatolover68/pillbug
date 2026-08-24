<script setup lang="ts">
import {
  APP_NAME,
  APP_VERSION,
  GITHUB_ISSUES_NEW,
  GITHUB_REPO,
} from "../meta";
import { toggleChangelog } from "./tabs";
</script>

<template>
  <div class="about-links">
    <a
      class="about-link"
      :href="GITHUB_REPO"
      target="_blank"
      rel="noopener noreferrer"
      :title="`${APP_NAME} ${APP_VERSION}`"
    >
      (////..)
    </a>
    <span>/</span>
    <a
      class="about-link"
      :href="GITHUB_ISSUES_NEW"
      target="_blank"
      rel="noopener noreferrer"
    >
      bug?
    </a>
    <span>/</span>
    <button
      type="button"
      class="about-link about-link-btn"
      @click="toggleChangelog"
    >
      changelog
    </button>
  </div>
</template>

<style scoped>
.about-links {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 0.35em;
  flex: none;
  padding: var(--pad);
  line-height: 1.35;
  color: var(--panel-muted);
}

.about-link {
  color: inherit;
  text-decoration: none;
}

.about-link:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.about-link-btn {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
</style>
