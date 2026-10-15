"use client";

/**
 * Diffs as Claude Code shows them: an edit's old and new text line by line (removed red, added
 * green, the rest as context), and a file's unified patch from git.
 */

type Row = { t: " " | "-" | "+"; s: string };

/** Line diff of two texts (LCS; big ones: all old, then all new). */
export function lineDiff(a: string, b: string): Row[] {
  const x = a ? a.split("\n") : [];
  const y = b ? b.split("\n") : [];
  if (x.length * y.length > 250000) return [...x.map((s): Row => ({ t: "-", s })), ...y.map((s): Row => ({ t: "+", s }))];
  const n = x.length;
  const m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ t: " ", s: x[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: "-", s: x[i++] });
    else out.push({ t: "+", s: y[j++] });
  }
  while (i < n) out.push({ t: "-", s: x[i++] });
  while (j < m) out.push({ t: "+", s: y[j++] });
  return out;
}

/** Long runs of unchanged lines folded to their ends. */
function fold(rows: Row[], keep = 3): (Row | { t: "…"; n: number })[] {
  const out: (Row | { t: "…"; n: number })[] = [];
  let run: Row[] = [];
  const flush = (last: boolean) => {
    // Context: before the first change only its last lines, after the last change only its first.
    const head = out.length ? keep : 0;
    const tail = last ? 0 : keep;
    if (run.length > head + tail + 1) out.push(...run.slice(0, head), { t: "…", n: run.length - head - tail }, ...run.slice(run.length - tail));
    else out.push(...run);
    run = [];
  };
  for (const r of rows) {
    if (r.t === " ") run.push(r);
    else {
      flush(false);
      out.push(r);
    }
  }
  flush(true);
  return out;
}

const TONE = { " ": "text-zinc-400", "-": "bg-red-950/60 text-red-200", "+": "bg-emerald-950/60 text-emerald-200" } as const;

/** An edit: old → new. */
export function EditDiff({ old, new: next, max = 400 }: { old: string; new: string; max?: number }) {
  const rows = fold(lineDiff(old, next));
  return (
    <div className="overflow-x-auto rounded border border-zinc-800 bg-zinc-950 font-mono text-xs leading-snug">
      {rows.slice(0, max).map((r, i) =>
        r.t === "…" ? (
          <div key={i} className="px-2 text-zinc-600">
            ⋯ {r.n} unchanged
          </div>
        ) : (
          <div key={i} className={`px-2 whitespace-pre ${TONE[r.t]}`}>
            <span className="mr-2 select-none opacity-60">{r.t}</span>
            {r.s || " "}
          </div>
        ),
      )}
      {rows.length > max && <div className="px-2 text-zinc-500">⋯ {rows.length - max} more lines</div>}
    </div>
  );
}

/** A unified patch (git diff), coloured. */
export function Patch({ patch, max = 3000 }: { patch: string; max?: number }) {
  const lines = patch.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(l));
  return (
    <div className="overflow-x-auto bg-zinc-950 font-mono text-xs leading-snug">
      {lines.slice(0, max).map((l, i) => (
        <div key={i} className={`px-2 whitespace-pre ${l.startsWith("@@") ? "bg-sky-950/50 text-sky-300" : l.startsWith("+") ? TONE["+"] : l.startsWith("-") ? TONE["-"] : TONE[" "]}`}>
          {l || " "}
        </div>
      ))}
      {lines.length > max && <div className="px-2 text-zinc-500">⋯ {lines.length - max} more lines</div>}
    </div>
  );
}
