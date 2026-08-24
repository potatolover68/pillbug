import { ref } from "vue";
import type { QueueSource, RedirectFilter } from "../../wiki/lists";

export type SourceKind = QueueSource["kind"];

const SOURCE_KINDS: SourceKind[] = [
  "category",
  "linksTo",
  "linksOn",
  "search",
];

export type GeneratorSnapshot = {
  sourceKind: SourceKind;
  categoryTitle: string;
  linksToTitle: string;
  linksWikilinks: boolean;
  linksTransclusions: boolean;
  linksFileUsage: boolean;
  linksRedirects: RedirectFilter;
  linksIncludeRedirectTargets: boolean;
  linksOnTitle: string;
  searchQuery: string;
  selectedNamespaces: number[];
};

export const sourceKind = ref<SourceKind>("category");

export const categoryTitle = ref("Category:");

export const linksToTitle = ref("");
export const linksWikilinks = ref(true);
export const linksTransclusions = ref(false);
export const linksFileUsage = ref(false);
export const linksRedirects = ref<RedirectFilter>("all");
export const linksIncludeRedirectTargets = ref(false);

export const linksOnTitle = ref("");
export const searchQuery = ref("");

export const selectedNamespaces = ref<number[]>([0]);

export function buildQueueSource(): QueueSource {
  switch (sourceKind.value) {
    case "category":
      return {
        kind: "category",
        title: categoryTitle.value,
      };
    case "linksTo":
      return {
        kind: "linksTo",
        title: linksToTitle.value,
        wikilinks: linksWikilinks.value,
        transclusions: linksTransclusions.value,
        fileUsage: linksFileUsage.value,
        redirects: linksRedirects.value,
        includeLinksToRedirects: linksIncludeRedirectTargets.value,
      };
    case "linksOn":
      return {
        kind: "linksOn",
        title: linksOnTitle.value,
      };
    case "search":
      return {
        kind: "search",
        query: searchQuery.value,
      };
  }
}

export function snapshotGenerator(): GeneratorSnapshot {
  return {
    sourceKind: sourceKind.value,
    categoryTitle: categoryTitle.value,
    linksToTitle: linksToTitle.value,
    linksWikilinks: linksWikilinks.value,
    linksTransclusions: linksTransclusions.value,
    linksFileUsage: linksFileUsage.value,
    linksRedirects: linksRedirects.value,
    linksIncludeRedirectTargets: linksIncludeRedirectTargets.value,
    linksOnTitle: linksOnTitle.value,
    searchQuery: searchQuery.value,
    selectedNamespaces: [...selectedNamespaces.value],
  };
}

export function applyGeneratorSnapshot(snap: GeneratorSnapshot): void {
  // Old projects may still have sourceKind "prefix"; map to Wiki search.
  const legacy = snap as unknown as {
    sourceKind?: string;
    prefixText?: string;
    searchQuery?: string;
    categoryTitle: string;
    linksToTitle: string;
    linksWikilinks: boolean;
    linksTransclusions: boolean;
    linksFileUsage: boolean;
    linksRedirects: RedirectFilter;
    linksIncludeRedirectTargets: boolean;
    linksOnTitle: string;
    selectedNamespaces: number[];
  };
  if (legacy.sourceKind === "prefix") {
    sourceKind.value = "search";
    searchQuery.value =
      legacy.searchQuery ||
      (typeof legacy.prefixText === "string" ? legacy.prefixText : "");
  } else if (
    legacy.sourceKind &&
    SOURCE_KINDS.includes(legacy.sourceKind as SourceKind)
  ) {
    sourceKind.value = legacy.sourceKind as SourceKind;
    searchQuery.value = legacy.searchQuery ?? "";
  } else {
    sourceKind.value = "category";
    searchQuery.value = legacy.searchQuery ?? "";
  }

  categoryTitle.value = legacy.categoryTitle;
  linksToTitle.value = legacy.linksToTitle;
  linksWikilinks.value = legacy.linksWikilinks;
  linksTransclusions.value = legacy.linksTransclusions;
  linksFileUsage.value = legacy.linksFileUsage;
  linksRedirects.value = legacy.linksRedirects;
  linksIncludeRedirectTargets.value = legacy.linksIncludeRedirectTargets;
  linksOnTitle.value = legacy.linksOnTitle;
  selectedNamespaces.value =
    legacy.selectedNamespaces.length > 0
      ? [...legacy.selectedNamespaces]
      : [0];
}
