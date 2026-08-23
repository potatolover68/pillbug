import { onMounted, onUnmounted } from "vue";
import { activeTab } from "../../shell/tabs";
import { hasBotGroup, loggedIn } from "../../wiki/session";
import { pageQueue } from "../../wiki/queue";
import keybinds from "./keybinds.json";
import {
  applyCurrent,
  batchRunning,
  botMode,
  canManualEdit,
  canPreview,
  canPrimaryAction,
  canSkip,
  manualEditing,
  markMinor,
  previewing,
  primaryAction,
  saveBusy,
  skipCurrent,
  startBatch,
  stopBatch,
  toggleManualEdit,
  togglePreview,
  undoCurrent,
} from "./state";

export type ReviewKeyAction = keyof typeof keybinds;

export type DiffNavHandlers = {
  scrollByLines: (lines: number) => void;
  scrollByPages: (pages: number) => void;
  jumpHunk: (direction: 1 | -1) => void;
};

/** Display chord from keybinds.json (e.g. `"Space"`, `"Ctrl+Enter"`). */
export function keybindLabel(action: ReviewKeyAction): string {
  return keybinds[action];
}

/** Tooltip text with keybind suffix, e.g. `"Save (Space)"`. */
export function withKeybind(label: string, action: ReviewKeyAction): string {
  return `${label} (${keybindLabel(action)})`;
}

function normalizeKey(key: string): string {
  if (key === " ") return "space";
  if (key === "Esc") return "escape";
  return key.toLowerCase();
}

/** Normalize a config chord like `Ctrl+Enter` or `Space` to a comparable token. */
export function normalizeChord(chord: string): string {
  const raw = chord.trim();
  // Bare uppercase letter (e.g. "N") means Shift+letter.
  if (/^[A-Z]$/.test(raw)) {
    return `shift+${raw.toLowerCase()}`;
  }

  const parts = raw
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map(normalizeKey);
  const key = parts[parts.length - 1] ?? "";
  const mods = new Set(parts.slice(0, -1));
  const ordered: string[] = [];
  if (mods.has("ctrl") || mods.has("control")) ordered.push("ctrl");
  if (mods.has("alt") || mods.has("option")) ordered.push("alt");
  if (mods.has("shift")) ordered.push("shift");
  if (mods.has("meta") || mods.has("cmd") || mods.has("command")) {
    ordered.push("meta");
  }
  ordered.push(key);
  return ordered.join("+");
}

function eventChord(event: KeyboardEvent): string {
  const ordered: string[] = [];
  if (event.ctrlKey) ordered.push("ctrl");
  if (event.altKey) ordered.push("alt");
  if (event.shiftKey) ordered.push("shift");
  if (event.metaKey) ordered.push("meta");
  ordered.push(normalizeKey(event.key));
  return ordered.join("+");
}

function buildActionMap(
  config: Record<string, string>,
): Map<string, ReviewKeyAction[]> {
  const map = new Map<string, ReviewKeyAction[]>();
  for (const [action, chord] of Object.entries(config) as Array<
    [ReviewKeyAction, string]
  >) {
    const token = normalizeChord(chord);
    const list = map.get(token) ?? [];
    list.push(action);
    map.set(token, list);
  }
  return map;
}

const chordToActions = buildActionMap(keybinds);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function blurActive(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement) el.blur();
}

function focusSummary(): boolean {
  const el = document.getElementById("edit-summary");
  if (!(el instanceof HTMLElement)) return false;
  el.focus();
  return true;
}

function blurOrExitEdit(): boolean {
  if (manualEditing.value) {
    toggleManualEdit();
    blurActive();
    return true;
  }
  if (isEditableTarget(document.activeElement)) {
    blurActive();
    return true;
  }
  return false;
}

function canStartStopBatch(): boolean {
  if (batchRunning.value) return true;
  return loggedIn.value && pageQueue.value.length > 0;
}

/**
 * Review-tab keyboard shortcuts. Diff navigation is injected from Review.vue
 * so scrolling stays tied to the live viewer element.
 */
export function useReviewKeybinds(diffNav: DiffNavHandlers): void {
  function dispatch(action: ReviewKeyAction): boolean {
    switch (action) {
      case "save": {
        if (saveBusy.value || !canPrimaryAction.value) return false;
        if (primaryAction.value === "undo") {
          void undoCurrent();
        } else {
          void applyCurrent();
        }
        return true;
      }
      case "skip": {
        if (!canSkip.value) return false;
        skipCurrent();
        return true;
      }
      case "startStopBatch": {
        if (!canStartStopBatch()) return false;
        if (batchRunning.value) {
          stopBatch();
        } else {
          void startBatch();
        }
        return true;
      }
      case "toggleEdit": {
        if (!canManualEdit.value && !manualEditing.value) return false;
        toggleManualEdit();
        return true;
      }
      case "togglePreview": {
        if (!canPreview.value && !previewing.value) return false;
        void togglePreview();
        return true;
      }
      case "toggleMinor": {
        markMinor.value = !markMinor.value;
        return true;
      }
      case "toggleBot": {
        if (!hasBotGroup.value) return false;
        botMode.value = !botMode.value;
        return true;
      }
      case "focusSummary":
        return focusSummary();
      case "blurSummary":
        return blurOrExitEdit();
      case "diffScrollDown": {
        if (manualEditing.value || previewing.value) return false;
        diffNav.scrollByLines(1);
        return true;
      }
      case "diffScrollUp": {
        if (manualEditing.value || previewing.value) return false;
        diffNav.scrollByLines(-1);
        return true;
      }
      case "diffPageDown": {
        if (manualEditing.value || previewing.value) return false;
        diffNav.scrollByPages(1);
        return true;
      }
      case "diffPageUp": {
        if (manualEditing.value || previewing.value) return false;
        diffNav.scrollByPages(-1);
        return true;
      }
      case "diffNextHunk": {
        if (manualEditing.value || previewing.value) return false;
        diffNav.jumpHunk(1);
        return true;
      }
      case "diffPrevHunk": {
        if (manualEditing.value || previewing.value) return false;
        diffNav.jumpHunk(-1);
        return true;
      }
      default:
        return false;
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;
    if (activeTab.value !== "review") return;

    const chord = eventChord(event);
    const actions = chordToActions.get(chord);
    if (!actions || actions.length === 0) return;

    const typing = isEditableTarget(event.target) || manualEditing.value;

    if (typing) {
      // While editing summary/article, only blur / exit-edit shortcuts run.
      if (actions.includes("blurSummary") && blurOrExitEdit()) {
        event.preventDefault();
      }
      return;
    }

    for (const action of actions) {
      if (action === "blurSummary") continue;
      if (dispatch(action)) {
        event.preventDefault();
        return;
      }
    }
  }

  onMounted(() => {
    window.addEventListener("keydown", onKeyDown);
  });
  onUnmounted(() => {
    window.removeEventListener("keydown", onKeyDown);
  });
}
