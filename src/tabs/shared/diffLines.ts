import { diff_match_patch as DiffMatchPatch } from "diff-match-patch";

export type LineChangeKind = "added" | "removed" | "modified";

export interface DiffOverviewRow {
  /** Cumulative offset before this row (px), using estimated heights. */
  top: number;
  height: number;
  kind: "equal" | LineChangeKind;
  left: string | undefined;
  right: string | undefined;
}

export interface DiffOverviewModel {
  rows: DiffOverviewRow[];
  totalHeight: number;
  /** Index of first non-equal row, or 0. */
  firstChangeIndex: number;
}

const DiffType = {
  removed: -1,
  equal: 0,
  added: 1,
  disabled: 2,
} as const;

function typeName(type: number): "removed" | "equal" | "added" | "disabled" {
  if (type === DiffType.removed) return "removed";
  if (type === DiffType.added) return "added";
  if (type === DiffType.equal) return "equal";
  return "disabled";
}

type DiffTuple = [number, string];
type DiffsPair = DiffTuple[];

/**
 * Build split-mode rows aligned with vue-diff's layout, with estimated heights
 * so overview marks track wrapped line height.
 */
export function buildDiffOverview(
  prev: string,
  current: string,
  lineMinHeight: number,
  contentWidth: number,
): DiffOverviewModel {
  const pairs = stackDiffs(diffLines(prev, current));
  const raw = splitRows(pairs);
  const halfWidth = Math.max(40, Math.floor(contentWidth / 2) - 40);
  const rows: DiffOverviewRow[] = [];
  let top = 0;
  let firstChangeIndex = -1;

  for (let i = 0; i < raw.length; i++) {
    const [left, right] = raw[i]!;
    const leftType = left.type;
    const rightType = right.type;
    let kind: DiffOverviewRow["kind"] = "equal";
    if (leftType === "removed" && rightType === "added") kind = "modified";
    else if (leftType === "removed") kind = "removed";
    else if (rightType === "added") kind = "added";
    else if (leftType === "added") kind = "added";
    else if (rightType === "removed") kind = "removed";

    if (kind !== "equal" && firstChangeIndex < 0) firstChangeIndex = i;

    const height = estimateRowHeight(
      left.value,
      right.value,
      lineMinHeight,
      halfWidth,
    );
    rows.push({
      top,
      height,
      kind,
      left: left.value,
      right: right.value,
    });
    top += height;
  }

  return {
    rows,
    totalHeight: Math.max(1, top),
    firstChangeIndex: firstChangeIndex < 0 ? 0 : firstChangeIndex,
  };
}

export function firstChangeLine(prev: string, current: string): number {
  return buildDiffOverview(prev, current, 24, 800).firstChangeIndex;
}

function estimateRowHeight(
  left: string | undefined,
  right: string | undefined,
  lineMinHeight: number,
  halfWidth: number,
): number {
  const charW = 7.2;
  const cols = Math.max(12, Math.floor(halfWidth / charW));
  const wraps = (text: string | undefined): number => {
    if (text === undefined || text.length === 0) return 1;
    // Soft-wrap estimate; values are usually single logical lines.
    return Math.max(1, Math.ceil(text.length / cols));
  };
  return Math.max(
    lineMinHeight,
    Math.max(wraps(left), wraps(right)) * lineMinHeight,
  );
}

function diffLines(prev: string, current: string): DiffTuple[] {
  const dmp = new DiffMatchPatch();
  const a = dmp.diff_linesToChars_(prev, current);
  const diffs = dmp.diff_main(a.chars1, a.chars2, false);
  dmp.diff_charsToLines_(diffs, a.lineArray);
  return diffs as DiffTuple[];
}

function stackDiffs(diffs: DiffTuple[]): DiffsPair[] {
  const acc: DiffsPair[] = [];
  for (const curr of diffs) {
    const type = typeName(curr[0]);
    if (type === "equal" || type === "removed") {
      acc.push([curr]);
      continue;
    }
    if (type === "added") {
      const last = acc.length ? acc[acc.length - 1] : null;
      const prev = last?.[0] ?? null;
      if (prev && typeName(prev[0]) === "removed") {
        last!.push(curr);
      } else {
        acc.push([curr]);
      }
    }
  }
  for (const pair of acc) {
    if (pair.length > 1) continue;
    const type = typeName(pair[0]![0]);
    if (type === "added") pair.unshift([DiffType.disabled, ""]);
    else if (type === "removed") pair.push([DiffType.disabled, ""]);
    else if (type === "equal") pair.push([pair[0]![0], pair[0]![1]]);
  }
  return acc;
}

interface SideLine {
  type: "removed" | "equal" | "added" | "disabled";
  value: string | undefined;
}

function splitRows(diffsMap: DiffsPair[]): Array<[SideLine, SideLine]> {
  const result: Array<[SideLine, SideLine]> = [];
  for (const diffs of diffsMap) {
    const left = diffs[0] ?? ([DiffType.disabled, ""] as DiffTuple);
    const right = diffs[1] ?? ([DiffType.disabled, ""] as DiffTuple);
    const prevLines = left[1].replace(/\n$/, "").split("\n");
    const currentLines = right[1].replace(/\n$/, "").split("\n");
    const loopCount = Math.max(prevLines.length, currentLines.length);
    for (let i = 0; i < loopCount; i++) {
      const leftType = typeName(left[0]);
      const rightType = typeName(right[0]);
      const hasPrev =
        leftType !== "disabled" && typeof prevLines[i] !== "undefined";
      const hasCurrent =
        rightType !== "disabled" && typeof currentLines[i] !== "undefined";
      result.push([
        {
          type: hasPrev ? leftType : "disabled",
          value: hasPrev ? prevLines[i] : undefined,
        },
        {
          type: hasCurrent ? rightType : "disabled",
          value: hasCurrent ? currentLines[i] : undefined,
        },
      ]);
    }
  }
  return result;
}

/** One changed split-row that can be discarded back toward `prev`. */
export interface LineDiscardTarget {
  /** Index among all vue-diff split rows (including equal rows). */
  rowIndex: number;
  kind: LineChangeKind;
  /** 0-based index into `prev` lines; null for added-only. */
  beforeIndex: number | null;
  /** 0-based index into `current` lines; null for removed-only. */
  afterIndex: number | null;
  /** For removed-only: splice index into `current` lines. */
  insertAt: number | null;
}

function splitTextLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\n$/, "").split("\n");
}

function joinTextLines(lines: string[], endsWithNewline: boolean): string {
  if (lines.length === 0) return endsWithNewline ? "\n" : "";
  return `${lines.join("\n")}${endsWithNewline ? "\n" : ""}`;
}

/**
 * List discardable line changes in vue-diff split row order.
 * Independent of hunk navigation — one target per changed row.
 */
export function listLineDiscards(
  prev: string,
  current: string,
): LineDiscardTarget[] {
  const pairs = stackDiffs(diffLines(prev, current));
  const out: LineDiscardTarget[] = [];
  let rowIndex = 0;
  let beforeIndex = 0;
  let afterIndex = 0;

  for (const diffs of pairs) {
    const left = diffs[0] ?? ([DiffType.disabled, ""] as DiffTuple);
    const right = diffs[1] ?? ([DiffType.disabled, ""] as DiffTuple);
    const prevLines = left[1].replace(/\n$/, "").split("\n");
    const currentLines = right[1].replace(/\n$/, "").split("\n");
    const loopCount = Math.max(prevLines.length, currentLines.length);

    for (let i = 0; i < loopCount; i++) {
      const leftType = typeName(left[0]);
      const rightType = typeName(right[0]);
      const hasPrev =
        leftType !== "disabled" && typeof prevLines[i] !== "undefined";
      const hasCurrent =
        rightType !== "disabled" && typeof currentLines[i] !== "undefined";

      let kind: LineChangeKind | null = null;
      if (hasPrev && hasCurrent && leftType === "removed" && rightType === "added") {
        kind = "modified";
      } else if (hasPrev && !hasCurrent && leftType === "removed") {
        kind = "removed";
      } else if (!hasPrev && hasCurrent && rightType === "added") {
        kind = "added";
      }

      if (kind) {
        out.push({
          rowIndex,
          kind,
          beforeIndex: hasPrev ? beforeIndex : null,
          afterIndex: hasCurrent ? afterIndex : null,
          insertAt: kind === "removed" ? afterIndex : null,
        });
      }

      if (hasPrev) beforeIndex++;
      if (hasCurrent) afterIndex++;
      rowIndex++;
    }
  }

  return out;
}

/**
 * Apply a single-line discard to `current`, returning the new wikitext.
 * Returns null if `rowIndex` is not a discardable change.
 */
export function applyLineDiscard(
  prev: string,
  current: string,
  rowIndex: number,
): string | null {
  const target = listLineDiscards(prev, current).find(
    (t) => t.rowIndex === rowIndex,
  );
  if (!target) return null;

  const beforeLines = splitTextLines(prev);
  const afterLines = splitTextLines(current);
  const endsWithNewline = current.length > 0 && current.endsWith("\n");

  if (
    target.kind === "modified" &&
    target.afterIndex !== null &&
    target.beforeIndex !== null
  ) {
    const replacement = beforeLines[target.beforeIndex];
    if (replacement === undefined) return null;
    afterLines[target.afterIndex] = replacement;
  } else if (target.kind === "added" && target.afterIndex !== null) {
    afterLines.splice(target.afterIndex, 1);
  } else if (
    target.kind === "removed" &&
    target.beforeIndex !== null &&
    target.insertAt !== null
  ) {
    const insertion = beforeLines[target.beforeIndex];
    if (insertion === undefined) return null;
    afterLines.splice(target.insertAt, 0, insertion);
  } else {
    return null;
  }

  return joinTextLines(afterLines, endsWithNewline);
}

/** Undo state for a single discarded line change. */
export type LineRestoreRecord = {
  id: string;
  kind: LineChangeKind;
  beforeText: string;
  afterText: string;
  /** Line index in ContentAfter immediately after the discard. */
  afterIndex: number;
};

let restoreIdSeq = 0;

function nextRestoreId(): string {
  restoreIdSeq += 1;
  return `lr-${restoreIdSeq}`;
}

/**
 * Discard one changed row and return the new text plus a restore record.
 * Returns null if `rowIndex` is not discardable.
 */
export function discardLineCapturing(
  prev: string,
  current: string,
  rowIndex: number,
): { text: string; record: LineRestoreRecord } | null {
  const target = listLineDiscards(prev, current).find(
    (t) => t.rowIndex === rowIndex,
  );
  if (!target) return null;

  const beforeLines = splitTextLines(prev);
  const afterLines = splitTextLines(current);
  const endsWithNewline = current.length > 0 && current.endsWith("\n");

  let record: LineRestoreRecord;

  if (
    target.kind === "modified" &&
    target.afterIndex !== null &&
    target.beforeIndex !== null
  ) {
    const beforeText = beforeLines[target.beforeIndex];
    const afterText = afterLines[target.afterIndex];
    if (beforeText === undefined || afterText === undefined) return null;
    record = {
      id: nextRestoreId(),
      kind: "modified",
      beforeText,
      afterText,
      afterIndex: target.afterIndex,
    };
    afterLines[target.afterIndex] = beforeText;
  } else if (target.kind === "added" && target.afterIndex !== null) {
    const afterText = afterLines[target.afterIndex];
    if (afterText === undefined) return null;
    record = {
      id: nextRestoreId(),
      kind: "added",
      beforeText: "",
      afterText,
      afterIndex: target.afterIndex,
    };
    afterLines.splice(target.afterIndex, 1);
  } else if (
    target.kind === "removed" &&
    target.beforeIndex !== null &&
    target.insertAt !== null
  ) {
    const beforeText = beforeLines[target.beforeIndex];
    if (beforeText === undefined) return null;
    record = {
      id: nextRestoreId(),
      kind: "removed",
      beforeText,
      afterText: "",
      afterIndex: target.insertAt,
    };
    afterLines.splice(target.insertAt, 0, beforeText);
  } else {
    return null;
  }

  return {
    text: joinTextLines(afterLines, endsWithNewline),
    record,
  };
}

/** Re-apply a discarded line change onto ContentAfter. */
export function restoreLineFromRecord(
  current: string,
  record: LineRestoreRecord,
): string | null {
  const afterLines = splitTextLines(current);
  const endsWithNewline = current.length > 0 && current.endsWith("\n");

  if (record.kind === "modified") {
    if (afterLines[record.afterIndex] !== record.beforeText) return null;
    afterLines[record.afterIndex] = record.afterText;
  } else if (record.kind === "added") {
    if (record.afterIndex < 0 || record.afterIndex > afterLines.length) {
      return null;
    }
    afterLines.splice(record.afterIndex, 0, record.afterText);
  } else if (record.kind === "removed") {
    if (afterLines[record.afterIndex] !== record.beforeText) return null;
    afterLines.splice(record.afterIndex, 1);
  } else {
    return null;
  }

  return joinTextLines(afterLines, endsWithNewline);
}

/** Shift restore indices after another discard is applied. */
export function shiftRestoresAfterDiscard(
  restores: readonly LineRestoreRecord[],
  applied: LineRestoreRecord,
): LineRestoreRecord[] {
  return restores.map((r) => {
    if (applied.kind === "added" && r.afterIndex > applied.afterIndex) {
      return { ...r, afterIndex: r.afterIndex - 1 };
    }
    if (applied.kind === "removed" && r.afterIndex >= applied.afterIndex) {
      return { ...r, afterIndex: r.afterIndex + 1 };
    }
    return r;
  });
}

/** Shift restore indices after a restore is applied (record itself removed). */
export function shiftRestoresAfterRestore(
  restores: readonly LineRestoreRecord[],
  restored: LineRestoreRecord,
): LineRestoreRecord[] {
  return restores.map((r) => {
    if (restored.kind === "added" && r.afterIndex >= restored.afterIndex) {
      return { ...r, afterIndex: r.afterIndex + 1 };
    }
    if (restored.kind === "removed" && r.afterIndex > restored.afterIndex) {
      return { ...r, afterIndex: r.afterIndex - 1 };
    }
    return r;
  });
}

/**
 * Map a restore record to the current split-row index for overlay placement.
 * Returns null if the record no longer lines up with ContentAfter.
 */
export function findRestoreRowIndex(
  prev: string,
  current: string,
  record: LineRestoreRecord,
): number | null {
  const pairs = stackDiffs(diffLines(prev, current));
  let rowIndex = 0;
  let afterIndex = 0;

  for (const diffs of pairs) {
    const right = diffs[1] ?? ([DiffType.disabled, ""] as DiffTuple);
    const currentLines = right[1].replace(/\n$/, "").split("\n");
    // Keep loop count aligned with splitRows (both sides).
    const left = diffs[0] ?? ([DiffType.disabled, ""] as DiffTuple);
    const prevLines = left[1].replace(/\n$/, "").split("\n");
    const loopCount = Math.max(prevLines.length, currentLines.length);

    for (let i = 0; i < loopCount; i++) {
      const rightType = typeName(right[0]);
      const hasCurrent =
        rightType !== "disabled" && typeof currentLines[i] !== "undefined";

      if (record.kind === "added") {
        // Deleted line: place on the first row whose after-cursor is the insert point.
        if (afterIndex === record.afterIndex) return rowIndex;
      } else if (hasCurrent && afterIndex === record.afterIndex) {
        if (
          record.kind === "modified" &&
          currentLines[i] === record.beforeText
        ) {
          return rowIndex;
        }
        if (
          record.kind === "removed" &&
          currentLines[i] === record.beforeText
        ) {
          return rowIndex;
        }
      }

      if (hasCurrent) afterIndex++;
      rowIndex++;
    }
  }

  if (record.kind === "added" && afterIndex === record.afterIndex) {
    // Insert at end — attach to last row if any.
    return rowIndex > 0 ? rowIndex - 1 : null;
  }
  return null;
}
