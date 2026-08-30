import { ref, shallowRef } from "vue";
import { INPUT_TYPE, type NodeMap } from "@nodish/core";
import { WikiTitle } from "../../wiki/title";
import { map, skipMap } from "../shared/maps";

export type CodeGraphKind = "process" | "skip";

export const activeCodeGraph = ref<CodeGraphKind>("process");

/** When true, NodeViewer re-evaluates the graph on every change. */
export const liveEvaluation = ref(true);

export const testPageTitle = ref("");
export const testBefore = ref("");
export const testAfter = ref("");
export const testSkip = ref<boolean | null>(null);
export const testBusy = ref(false);
export const testError = ref<string | null>(null);
export const testPanelOpen = ref(false);

/**
 * Last successful test page — kept after closing the diff panel so NodeViewer
 * can evaluate the graph without red error borders on connected nodes.
 */
const previewTitle = shallowRef<WikiTitle | null>(null);
const previewContent = ref<string | null>(null);

function hasPreviewInputs(): boolean {
  return previewContent.value !== null && previewTitle.value !== null;
}

/** Write last test Title/Content onto graph Input boundary ports. */
export function syncPreviewInputs(target?: NodeMap): void {
  if (!hasPreviewInputs()) return;
  const inputs = {
    Title: previewTitle.value,
    Content: previewContent.value,
  };
  const targets = target ? [target] : [map.value, skipMap.value];
  for (const nodeMap of targets) {
    applyInputsToMap(nodeMap, inputs);
  }
}

/**
 * Strip Title/Content from Input ports before serialize — WikiTitle is not
 * JSON-safe and would round-trip as a plain object.
 */
export function clearPreviewInputsFromMaps(...targets: NodeMap[]): void {
  const maps = targets.length > 0 ? targets : [map.value, skipMap.value];
  for (const nodeMap of maps) {
    applyInputsToMap(nodeMap, { Title: undefined, Content: undefined });
  }
}

function applyInputsToMap(
  nodeMap: NodeMap,
  inputs: Record<string, unknown>,
): void {
  const inputNode = nodeMap.graph.nodes.find(
    (node) => node.typeId === INPUT_TYPE,
  );
  if (!inputNode) return;
  for (const port of Object.values(inputNode.outputs)) {
    if (Object.prototype.hasOwnProperty.call(inputs, port.name)) {
      port.value = inputs[port.name];
    }
  }
}

export function setPreviewFromTest(titleObj: WikiTitle, content: string): void {
  previewTitle.value = titleObj;
  previewContent.value = content;
  syncPreviewInputs();
}

export type PreviewState = {
  title: WikiTitle | null;
  content: string | null;
};

export function capturePreviewState(): PreviewState {
  return {
    title: previewTitle.value,
    content: previewContent.value,
  };
}

export function restorePreviewState(state: PreviewState): void {
  previewTitle.value = state.title;
  previewContent.value = state.content;
  clearPreviewInputsFromMaps();
  syncPreviewInputs();
}

/**
 * Seed Title/Content for tour demos. Title is skipped when siteinfo is
 * unavailable (not logged in); Content is still written onto Input ports.
 */
export function setPreviewContentForTour(
  content: string,
  titleText = "Tour:Example",
): void {
  previewContent.value = content;
  try {
    previewTitle.value = new WikiTitle(titleText);
  } catch {
    previewTitle.value = null;
  }
  if (previewTitle.value) {
    syncPreviewInputs();
    return;
  }
  applyInputsToMap(map.value, { Content: content });
  applyInputsToMap(skipMap.value, { Content: content });
}
