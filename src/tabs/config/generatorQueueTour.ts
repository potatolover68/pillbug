import {
  startPillbugTour,
  tourStepsFromDefs,
  type TourStepDef,
} from "../shared/tour";
import { sourceKind } from "./generatorState";

const STEP_DEFS: TourStepDef[] = [
  {
    title: "Generator",
    description:
      "The generator makes a list of pages to edit, which is stored in the page queue.",
  },
  {
    element: "[data-tour='config-namespaces']",
    title: "Namespace",
    description:
      "Before generating a list of pages to edit, make sure to select the namespaces you want to include/exclude from the list by clicking on them. By default, only mainspace is included.",
    side: "left",
  },
  {
    title: "Configuring the generator",
    description:
      "The generator has several options for configuring the list of pages to edit. Those are, in order: Category, Links to page, Links on page, and Wiki search.",
  },
  {
    element: "[data-tour='config-gen-category']",
    title: "Category",
    description:
      "Members of a <a href='https://www.mediawiki.org/wiki/Help:Categories'>category</a>. This is importantly does <i>not</i> search pages in subcategories; to do that, use <a href='https://www.mediawiki.org/wiki/Help:CirrusSearch#Deepcategory'>Deepcategory search</a> with the Wiki search generator.",
    side: "right",
    onHighlightStarted: () => {
      sourceKind.value = "category";
    },
  },
  {
    element: "[data-tour='config-gen-links-to']",
    title: "Links to page",
    description:
      "As the name suggests, this option generates a list of pages that link to a specific title. This has the same options as <a href='https://www.mediawiki.org/wiki/Help:What_links_here'>Special:WhatLinksHere</a>.",
    side: "right",
    onHighlightStarted: () => {
      sourceKind.value = "linksTo";
    },
  },
  {
    element: "[data-tour='config-gen-links-on']",
    title: "Links on page",
    description:
      "Outgoing wikilinks from a page to existing titles. Namespace keeps only linked titles in the namespaces you select.",
    side: "right",
    onHighlightStarted: () => {
      sourceKind.value = "linksOn";
    },
  },
  {
    element: "[data-tour='config-gen-search']",
    title: "Wiki search",
    description:
      "CirrusSearch-based search; see <a href='https://www.mediawiki.org/wiki/Help:CirrusSearch'>the MediaWiki help page</a> for more information.",
    side: "right",
    onHighlightStarted: () => {
      sourceKind.value = "search";
    },
  },
];

export function startGeneratorQueueTour(): void {
  startPillbugTour(tourStepsFromDefs(STEP_DEFS));
}
