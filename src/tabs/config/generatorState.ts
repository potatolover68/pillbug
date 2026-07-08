import { ref } from "vue";
import type { QueueSource, RedirectFilter } from "../../wiki/lists";

export type SourceKind = QueueSource["kind"];

export type GeneratorSnapshot = {
  sourceKind: SourceKind;
  categoryTitle: string;
  catPages: boolean;
  catSubcats: boolean;
  catFiles: boolean;
  linksToTitle: string;
  linksWikilinks: boolean;
  linksTransclusions: boolean;
  linksFileUsage: boolean;
  linksRedirects: RedirectFilter;
  linksIncludeRedirectTargets: boolean;
  prefixText: string;
  prefixStrict: boolean;
  linksOnTitle: string;
  searchQuery: string;
  selectedNamespaces: number[];
};

export const sourceKind = ref<SourceKind>("category");

export const categoryTitle = ref("Category:");
export const catPages = ref(true);
export const catSubcats = ref(false);
export const catFiles = ref(false);

export const linksToTitle = ref("");
export const linksWikilinks = ref(true);
export const linksTransclusions = ref(false);
export const linksFileUsage = ref(false);
export const linksRedirects = ref<RedirectFilter>("all");
export const linksIncludeRedirectTargets = ref(false);

export const prefixText = ref("");
export const prefixStrict = ref(true);

export const linksOnTitle = ref("");
export const searchQuery = ref("");

export const selectedNamespaces = ref<number[]>([0]);

export function buildQueueSource(): QueueSource {
  switch (sourceKind.value) {
    case "category":
      return {
        kind: "category",
        title: categoryTitle.value,
        includePages: catPages.value,
        includeSubcats: catSubcats.value,
        includeFiles: catFiles.value,
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
    case "prefix":
      return {
        kind: "prefix",
        prefix: prefixText.value,
        strict: prefixStrict.value,
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
    catPages: catPages.value,
    catSubcats: catSubcats.value,
    catFiles: catFiles.value,
    linksToTitle: linksToTitle.value,
    linksWikilinks: linksWikilinks.value,
    linksTransclusions: linksTransclusions.value,
    linksFileUsage: linksFileUsage.value,
    linksRedirects: linksRedirects.value,
    linksIncludeRedirectTargets: linksIncludeRedirectTargets.value,
    prefixText: prefixText.value,
    prefixStrict: prefixStrict.value,
    linksOnTitle: linksOnTitle.value,
    searchQuery: searchQuery.value,
    selectedNamespaces: [...selectedNamespaces.value],
  };
}

export function applyGeneratorSnapshot(snap: GeneratorSnapshot): void {
  sourceKind.value = snap.sourceKind;
  categoryTitle.value = snap.categoryTitle;
  catPages.value = snap.catPages;
  catSubcats.value = snap.catSubcats;
  catFiles.value = snap.catFiles;
  linksToTitle.value = snap.linksToTitle;
  linksWikilinks.value = snap.linksWikilinks;
  linksTransclusions.value = snap.linksTransclusions;
  linksFileUsage.value = snap.linksFileUsage;
  linksRedirects.value = snap.linksRedirects;
  linksIncludeRedirectTargets.value = snap.linksIncludeRedirectTargets;
  prefixText.value = snap.prefixText;
  prefixStrict.value = snap.prefixStrict;
  linksOnTitle.value = snap.linksOnTitle;
  searchQuery.value = snap.searchQuery;
  selectedNamespaces.value =
    snap.selectedNamespaces.length > 0 ? [...snap.selectedNamespaces] : [0];
}
