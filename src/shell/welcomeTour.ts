import { nextTick } from "vue";
import {
  startPillbugTour,
  tourStepsFromDefs,
  type TourStepDef,
} from "../tabs/shared/tour";
import { setActiveTab } from "./tabs";

const WELCOME_TOUR_SEEN_KEY = "pillbug.welcomeTourSeen";

function markWelcomeTourSeen(): void {
  try {
    localStorage.setItem(WELCOME_TOUR_SEEN_KEY, "1");
  } catch {
    // ignore quota / private mode
  }
}

export function hasSeenWelcomeTour(): boolean {
  try {
    return localStorage.getItem(WELCOME_TOUR_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

const goTo =
  (tab: "config" | "code" | "review"): TourStepDef["onNextClick"] =>
  (_el, _step, { driver }) => {
    setActiveTab(tab);
    void nextTick(() => {
      driver.moveNext();
    });
  };

const STEP_DEFS: TourStepDef[] = [
  {
    title: "Welcome to pillbug",
    description:
      "pillbug is a semi-automated editing tool for MediaWiki; that is, a tool that makes some tedious tasks (like fixing common typos) easier. Unlike other semi-automated editing tools, pillbug uses a node-based programming interface (similar to Blender's nodes) to decide how a page is edited.",
  },
  {
    title: "Tabs",
    description:
      'Pillbug has three tabs, which form the three logical "steps" of semi-automated editing: Deciding which pages to edit (Config), deciding how they will be edited (Code), and implementing the edits (Review).',
    onNextClick: goTo("config"),
  },
  {
    element: "[data-tour='tab-config']",
    title: "Config",
    description:
      "This is the first step. Using the queue generator, you can make a list of pages to edit, for example, searching for pages with a specific typo, or all pages in a category.",
    side: "bottom",
    onNextClick: goTo("code"),
  },
  {
    element: "[data-tour='tab-code']",
    title: "Code",
    description:
      "This is the second step. Here you can decide how the pages will be edited.",
    side: "bottom",
    onNextClick: goTo("review"),
  },
  {
    element: "[data-tour='tab-review']",
    title: "Review",
    description:
      "This is the third step. Here you can inspect each proposed edit, then save, skip, or undo. This is where edits are actually applied to the wiki.",
    side: "bottom",
    onNextClick: goTo("config"),
  },
  {
    element: "[data-tour='config-tour-help']",
    waitForElement: 3000,
    title: "Config tours",
    description:
      'Look for the orange "?" next to a title for a deeper guided tour of that section.',
    side: "bottom",
    onNextClick: goTo("code"),
  },
  {
    element: "[data-tour='code-tour-help']",
    waitForElement: 3000,
    title: "Code tour",
    description: "On Code, the tour starts here.",
    side: "top",
    onNextClick: goTo("review"),
  },
  {
    element: "[data-tour='review-tour-help']",
    waitForElement: 3000,
    title: "Review tour",
    description:
      'Same idea on Review: bottom-left of the page. Click any of these "?" buttons whenever you want a walkthrough.',
    side: "top",
  },
];

export function startWelcomeTour(): void {
  startPillbugTour(tourStepsFromDefs(STEP_DEFS), {
    onDestroyed: () => {
      markWelcomeTourSeen();
    },
  });
}

/** Auto-start once on first visit. */
export function maybeStartWelcomeTour(): void {
  if (hasSeenWelcomeTour()) return;
  startWelcomeTour();
}
