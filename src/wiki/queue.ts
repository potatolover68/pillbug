import { ref } from "vue";

/** Titles waiting to be processed by the Review batch runner. */
export const pageQueue = ref<string[]>([]);

export function setPageQueueFromText(text: string): void {
  pageQueue.value = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function replaceQueue(titles: string[]): void {
  pageQueue.value = titles.map((t) => t.trim()).filter(Boolean);
}

export function pageQueueText(): string {
  return pageQueue.value.join("\n");
}

/** Remove matching titles (raw queue string and/or normalized prefixed form). */
export function removeFromQueue(...titles: string[]): void {
  if (titles.length === 0) return;
  const keys = new Set(
    titles
      .filter(Boolean)
      .flatMap((t) => [t, t.replace(/_/g, " "), t.replace(/ /g, "_")])
      .map((t) => t.toLowerCase()),
  );
  pageQueue.value = pageQueue.value.filter(
    (t) =>
      !keys.has(t.toLowerCase()) &&
      !keys.has(t.replace(/_/g, " ").toLowerCase()),
  );
}
