<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  port: { value?: unknown; name?: string };
  typeDef?: unknown;
  effectiveWidget?: unknown;
  displayValue?: unknown;
  placeholder?: string;
}>();

const emit = defineEmits<{
  "update:value": [value: unknown];
  commit: [];
}>();

const text = computed(() => {
  const value = props.port?.value;
  return value != null && value !== "" ? String(value) : "";
});

function onInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  emit("update:value", target.value);
}

function onChange(event: Event): void {
  onInput(event);
  emit("commit");
}
</script>

<template>
  <input
    class="ai-password"
    type="password"
    autocomplete="off"
    spellcheck="false"
    :value="text"
    :placeholder="placeholder"
    :title="port.name"
    @input="onInput"
    @change="onChange"
    @pointerdown.stop
  />
</template>

<style scoped>
.ai-password {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 2px 4px;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 2px;
  background: #1e2024;
  color: #eee;
  font: inherit;
  font-size: 12px;
}
</style>
