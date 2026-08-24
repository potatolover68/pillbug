import {
  driver,
  type Config,
  type DriveStep,
  type Driver,
  type DriverHook,
  type Alignment,
  type Side,
} from "driver.js";
import "driver.js/dist/driver.css";
import "./tour.css";

export type TourStepDef = {
  element?: string;
  title: string;
  description: string;
  side?: Side;
  align?: Alignment;
  waitForElement?: number;
  onHighlightStarted?: DriverHook;
  onNextClick?: DriverHook;
};

export function tourStepsFromDefs(defs: TourStepDef[]): DriveStep[] {
  return defs.map((def) => ({
    ...(def.element ? { element: def.element } : {}),
    ...(def.waitForElement != null
      ? { waitForElement: def.waitForElement }
      : {}),
    ...(def.onHighlightStarted
      ? { onHighlightStarted: def.onHighlightStarted }
      : {}),
    popover: {
      title: def.title,
      description: def.description,
      ...(def.side ? { side: def.side } : {}),
      ...(def.align ? { align: def.align } : {}),
      ...(def.onNextClick ? { onNextClick: def.onNextClick } : {}),
    },
  }));
}

let activeDriver: Driver | null = null;

function stepElementMissing(step: DriveStep): boolean {
  if (!step.element) return false;
  if (typeof step.element === "string") {
    return document.querySelector(step.element) == null;
  }
  if (typeof step.element === "function") {
    try {
      return !step.element();
    } catch {
      return true;
    }
  }
  return !step.element;
}

/** Start a themed driver.js tour. Destroys any active tour first. */
export function startPillbugTour(
  steps: DriveStep[],
  options: Omit<Config, "steps"> = {},
): Driver | null {
  if (activeDriver?.isActive()) {
    activeDriver.destroy();
  }
  activeDriver = null;

  const resolved = steps.filter((step) => {
    // Keep steps that wait for an element (e.g. after a tab switch).
    if (step.waitForElement) return true;
    return !stepElementMissing(step);
  });
  if (resolved.length === 0) return null;

  const { onDestroyed, ...rest } = options;

  activeDriver = driver({
    popoverClass: "pillbug-tour",
    showProgress: true,
    animate: true,
    overlayColor: "#1e2024",
    overlayOpacity: 0.65,
    stagePadding: 6,
    stageRadius: 2,
    smoothScroll: true,
    allowClose: false,
    ...rest,
    steps: resolved,
    onDestroyed: (element, step, opts) => {
      activeDriver = null;
      onDestroyed?.(element, step, opts);
    },
  });

  activeDriver.drive();
  return activeDriver;
}
