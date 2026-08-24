import {
  startPillbugTour,
  tourStepsFromDefs,
  type TourStepDef,
} from "../shared/tour";
import { activeCodeGraph } from "./state";

const STEP_DEFS: TourStepDef[] = [
  {
    element: "[data-tour='code-tour-help']",
    title: "Code",
    description:
      "Code is the tab where you, of course, <i>code</i>. More specifically, it's where you decide how the text of each queued page should be <b>transformed</b> (this could be anything from fixing a typo to replacing entire templates).",
    side: "top",
  },
  {
    element: "[data-tour='code-graph-toggle']",
    title: "Process / Skip",
    description:
      "There are two graphs you can edit: the process graph and the skip graph. Only the process graph is required; the skip graph is optional.",
    side: "left",
  },
  {
    element: "[data-tour='code-graph-toggle']",
    title: "Process graph",
    description:
      "The process graph is what transforms the page text. It will always receive the page's title and text, and it should output the transformed text. If the output is the same as the input, the page is skipped.",
    side: "left",
    onHighlightStarted: () => {
      activeCodeGraph.value = "process";
    },
  },
  {
    element: "[data-tour='code-graph-toggle']",
    title: "Skip graph",
    description:
      "The skip graph is an optional filter that can prevent the process graph from running. It will always receive the page's title and text, and it should output a boolean. If the output is true, the page is skipped. Useful for edge cases the queue generator can't catch. The skip graph should always be faster than the process graph, as otherwise it would not be of much use",
    side: "left",
    onHighlightStarted: () => {
      activeCodeGraph.value = "skip";
    },
  },
  {
    element: "[data-tour='code-canvas']",
    title: "Think in transformations",
    description:
      "This is a dataflow editor: each node is one small change to the data flowing through it. For wiki work, start from Content (the page text), apply nodes that find/replace, strip, or reshape it, and wire the final string into ContentAfter.",
    side: "left",
  },
  {
    element: "[data-tour='code-canvas']",
    title: "Add and wire",
    description:
      "Right-click the empty canvas to add a node. Drag from a port to another port to wire them, or drop a wire on empty space to create a compatible node. Right click and drag across wires to cut them.",
    side: "left",
  },
  {
    element: "[data-tour='code-canvas']",
    title: "Navigate and edit",
    description:
      "Pan with middle-click and drag or two-finger scroll; zoom with Ctrl/Cmd and scroll wheel. Drag a node's header to move it. Delete removes selected nodes. Ctrl/Cmd+Z undoes the last action. Escape closes menus, leaves a group, clears selection, then recenters, in that order.",
    side: "left",
  },
  {
    element: "[data-tour='code-test-page']",
    title: "Test page",
    description:
      "Fetch a page (login required) to try both graphs. Title and Content are also fed into the editor for live evaluation while you edit.",
    side: "left",
  },
  {
    element: "[data-tour='code-test-actions']",
    title: "Test / Close",
    description:
      "Test runs the skip graph, then the process graph, on that page and opens a diff panel above the canvas. Close hides the panel; the last successful test inputs stay available for live preview.",
    side: "left",
  },
];

export function startCodeTour(): void {
  startPillbugTour(tourStepsFromDefs(STEP_DEFS));
}
