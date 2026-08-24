import {
  startPillbugTour,
  tourStepsFromDefs,
  type TourStepDef,
} from "../shared/tour";
import { keybindLabel, type ReviewKeyAction } from "./useReviewKeybinds";
import {
  beginReviewTourDemo,
  endReviewTourDemo,
  showReviewTourAppliedLog,
} from "./state";

let k = (key: ReviewKeyAction) => {
  return `<kbd>${keybindLabel(key)}</kbd>`;
};

const STEP_DEFS: TourStepDef[] = [
  {
    element: "[data-tour='review-tour-help']",
    title: "Review",
    description:
      "Review is where the edits are actually applied. Keybinds are available for a large portion of the UI. This tour loads a sample diff and log; they disappear when you finish.",
    side: "top",
  },
  {
    element: "[data-tour='review-summary']",
    title: "Controls",
    description: `The following controls <i>act</i> on a single (proposed) edit:`,
    side: "left",
  },
  {
    element: "[data-tour='review-summary']",
    title: "Edit summary",
    description: `<a href="https://www.mediawiki.org/wiki/Help:Edit_summary" target="_blank">Should be self-explanatory</a>. Press ${k("focusSummary")} to focus the field; ${k("blurSummary")} blurs it while typing.`,
    side: "left",
  },
  {
    element: "[data-tour='review-edit-controls']",
    title: "Edit controls",
    description: `Toggle minor (${k("toggleMinor")}) and bot (${k("toggleBot")}, when available). Edit (${k("toggleEdit")}) opens ContentAfter as text; Preview (${k("togglePreview")}) renders it.`,
    side: "left",
  },
  {
    element: "[data-tour='review-log']",
    title: "Review log",
    description: `Recently reviewed edits. You can click a row to load that diff; if this were live, you would have the option to undo any applied edits, or apply any skipped edits (both have the same shortcut ${k("save")}). Click the same row again to clear selection and return to the live queue item. Note that the review log is not preserved in saved projects.`,
    side: "left",
    onHighlightStarted: () => {
      showReviewTourAppliedLog();
    },
  },
  {
    element: "[data-tour='review-actions']",
    title: "Batch actions",
    description: `You can start/stop the current batch of queued pages with ${k("startStopBatch")}, save or undo with ${k("save")}, and skip with ${k("skip")}. The count shows how many titles remain in the queue.`,
    side: "left",
  },
  {
    element: "[data-tour='review-diff']",
    title: "Diff",
    description:
      "Before vs after for the current page. Hover a changed line to discard or restore that specific line. The scrollbar to the right will also show which lines have been changed.",
    side: "right",
  },
  {
    element: "[data-tour='review-diff']",
    title: "Shortcuts",
    description: `${k("diffScrollDown")}/${k("diffScrollUp")} scroll by line, ${k("diffPageDown")}/${k("diffPageUp")} by page, ${k("diffNextHunk")}/${k("diffPrevHunk")} jump changed lines. Shortcuts are ignored while typing in the summary or editor.`,
    side: "right",
  },
];

export function startReviewTour(): void {
  beginReviewTourDemo();
  startPillbugTour(tourStepsFromDefs(STEP_DEFS), {
    onDestroyed: () => {
      endReviewTourDemo();
    },
  });
}
