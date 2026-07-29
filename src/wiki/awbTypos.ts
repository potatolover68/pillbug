import { parseAwbTypoRules, setAwbTypoRules } from "../../pack/typos";

const TYPOS_API =
  "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=revisions&rvslots=main&rvprop=content&titles=Wikipedia:AutoWikiBrowser/Typos";

type QueryResponse = {
  query?: {
    pages?: Record<
      string,
      {
        missing?: boolean;
        revisions?: Array<{
          slots?: { main?: { ["*"]?: string; content?: string } };
          ["*"]?: string;
        }>;
      }
    >;
  };
};

function revisionWikitext(data: QueryResponse): string | null {
  const pages = data.query?.pages;
  if (!pages) return null;
  for (const page of Object.values(pages)) {
    if (page.missing) continue;
    const rev = page.revisions?.[0];
    if (!rev) continue;
    const slot = rev.slots?.main;
    if (slot) {
      const text = slot["*"] ?? slot.content;
      if (typeof text === "string") return text;
    }
    if (typeof rev["*"] === "string") return rev["*"];
  }
  return null;
}

let loadPromise: Promise<void> | null = null;

/**
 * Fetch enwiki AWB Typos once per page load and cache compiled rules for the
 * RegEx Typo Fixing node. Soft-fails (empty rules) on network/parse errors.
 */
export function loadAwbTypos(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch(TYPOS_API);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as QueryResponse;
      const wikitext = revisionWikitext(data);
      if (wikitext == null) {
        throw new Error("Typos page missing or empty");
      }
      const rules = parseAwbTypoRules(wikitext);
      setAwbTypoRules(rules);
    } catch (err) {
      console.error(
        "[pillbug] Failed to load Wikipedia:AutoWikiBrowser/Typos:",
        err,
      );
      setAwbTypoRules([]);
    }
  })();
  return loadPromise;
}
