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
