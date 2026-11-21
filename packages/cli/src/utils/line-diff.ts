/**
 * A small line-by-line comparison for `axiomic diff` (DECISIONS #65), so the CLI stays free of
 * dependencies. Classic "longest common subsequence": find the longest run of lines both texts
 * share (in order); every other line was removed (-) or added (+). Shown with 2 lines of context,
 * like `git diff`.
 *
 * Cost grows with lines × lines, so files over MAX_LINES are only reported as "different".
 * Rule files are far smaller than that.
 */
export const MAX_LINES = 3000;

type Op = { kind: " " | "-" | "+"; line: string };

export function diffLines(oldText: string, newText: string): Op[] | undefined {
  const a = oldText.replace(/\r\n?/g, "\n").split("\n");
  const b = newText.replace(/\r\n?/g, "\n").split("\n");
  if (a.length > MAX_LINES || b.length > MAX_LINES) return undefined;

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: " ", line: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) ops.push({ kind: "-", line: a[i++]! });
    else ops.push({ kind: "+", line: b[j++]! });
  }
  while (i < a.length) ops.push({ kind: "-", line: a[i++]! });
  while (j < b.length) ops.push({ kind: "+", line: b[j++]! });
  return ops;
}

/** Only the changed lines, with `context` unchanged lines around them; "…" between separate parts. */
export function formatDiff(ops: Op[], context = 2): string {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, k) => {
    if (op.kind === " ") return;
    for (let x = Math.max(0, k - context); x <= Math.min(ops.length - 1, k + context); x++) keep[x] = true;
  });
  const out: string[] = [];
  let gap = false;
  ops.forEach((op, k) => {
    if (!keep[k]) {
      gap = true;
      return;
    }
    if (gap && out.length > 0) out.push("  …");
    gap = false;
    out.push(`${op.kind} ${op.line}`);
  });
  return out.join("\n");
}
