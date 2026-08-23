/**
 * AWB RegEx Typo Fix helpers (parse Wikipedia:AutoWikiBrowser/Typos wikitext).
 * Rules are loaded at app startup via setAwbTypoRules; execute applies sync.
 *
 * See also https://github.com/wikimedia-gadgets/JWB/blob/master/RETF/RETF.js
 */

export type AwbTypoRule = {
  word: string;
  find: RegExp;
  replace: string;
};

let awbTypoRules: AwbTypoRule[] = [];

export function setAwbTypoRules(rules: AwbTypoRule[]): void {
  awbTypoRules = rules;
}

export function getAwbTypoRules(): readonly AwbTypoRule[] {
  return awbTypoRules;
}

/** Strip HTML comments so disabled &lt;Typo&gt; rules are ignored. */
export function stripHtmlComments(wikitext: string): string {
  return wikitext.replace(/<!--[\s\S]*?-->/g, "");
}

function attrValue(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(attrs);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

/** AWB skips rules with a `disabled` attribute (any value). */
function isDisabledTypo(attrs: string): boolean {
  return /\bdisabled\s*=/i.test(attrs);
}

/**
 * Parse &lt;Typo …/&gt; tags from AWB typos wikitext (comments already stripped).
 * Invalid find patterns are skipped.
 */
export function parseAwbTypoRules(wikitext: string): AwbTypoRule[] {
  const text = stripHtmlComments(wikitext);
  const rules: AwbTypoRule[] = [];
  const tagRe = /<\s*typo\b([^>]*)\/\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(text)) !== null) {
    const attrs = match[1] ?? "";
    if (isDisabledTypo(attrs)) continue;
    const find = attrValue(attrs, "find");
    const replace = attrValue(attrs, "replace");
    if (find == null || replace == null) continue;
    const word = attrValue(attrs, "word") ?? "";
    try {
      rules.push({
        word,
        find: new RegExp(find, "g"),
        replace,
      });
    } catch {
      // Skip rules that are not valid JS RegExp (AWB .NET may differ slightly).
    }
  }
  return rules;
}

/**
 * Apply cached AWB typo rules in order.
 *
 * Exclusion behavior follows JavaScript Wiki Browser (JWB) RETF.replace by
 * Joeytje50, itself based on AutoWikiBrowser typo skip rules:
 * https://en.wikipedia.org/wiki/Wikipedia:AutoWikiBrowser/Typos#AutoWikiBrowser_.28AWB.29
 *
 * - Skip a rule entirely if its find pattern appears in a wikilink target.
 * - Otherwise only replace matches outside File: links, {{templates}},
 *   "double-quoted" spans, and text after `:` or `*` on a line.
 */
export function applyAwbTypos(content: string): string {
  let text = content;
  for (const rule of awbTypoRules) {
    const source = rule.find.source;
    if (!source) continue;

    try {
      // JWB: ignore rule when the find pattern appears inside a wikilink target.
      const wikiLinkTarget = new RegExp(
        `\\[\\[[^|\\]]*${source}[^|\\]]*(\\||\\]\\])`,
      );
      if (wikiLinkTarget.test(text)) continue;

      // JWB / AWB: File:links | templates | "quotes" | text after : or *
      // Group 1 is the only region where the typo replace may run.
      const exclude = new RegExp(
        `\\[\\[File:[^|\\]]+\\|?|{{.+?}}|"[^"]+"|[:\\*].*|(${source})`,
        "ig",
      );
      text = text.replace(exclude, (match, g1: string | undefined) => {
        if (!g1) return match;
        return g1.replace(new RegExp(source, "g"), rule.replace);
      });
    } catch {
      // Skip rules whose pattern cannot be composed into the exclusion regex.
    }
  }
  return text;
}
