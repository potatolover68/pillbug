/**
 * Newline helpers for AI option matching and text transforms.
 */

/** Collapse CRLF / CR to LF for stable string compares. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Turn literal escape sequences (`\` + `n`, etc.) into real control chars.
 * Also normalizes any real CR/CRLF to LF afterward.
 */
export function realizeNewlines(text: string): string {
  // Order matters: handle \\r\\n before \\n / \\r.
  const realized = text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n");
  return normalizeNewlines(realized);
}

/**
 * Find which option the model meant, tolerant of CR/LF and literal `\n` text.
 * Returns the original option string from `options` (not the model’s spelling).
 */
export function matchOption(choice: string, options: string[]): string | null {
  const candidates = [
    normalizeNewlines(choice),
    normalizeNewlines(realizeNewlines(choice)),
  ];

  for (const opt of options) {
    const norms = [
      normalizeNewlines(opt),
      normalizeNewlines(realizeNewlines(opt)),
    ];
    for (const c of candidates) {
      if (norms.includes(c)) return opt;
    }
  }
  return null;
}
