"use client";

import { useMemo } from "react";
import { useT } from "@/components/I18nProvider";
import { parseView } from "@/plugins/workspace/view-template";

/**
 * A template's outline: its tags as a tree (rows, columns, grids, boxes, what they hold), its {{#if}} and {{#each}}, what only sets
 * things up (state, def, data, let) dimmed. A line picked jumps the code there; the line the cursor is on is marked.
 */

type TNode = ReturnType<typeof parseView>["nodes"][number];
type Entry = { depth: number; line: number; kind: "tag" | "if" | "else" | "each"; label: string; hint: string; quiet: boolean };

// (Tags that draw nothing themselves: they set the view up.)
const SETUP = new Set(["state", "def", "data", "let", "setting", "settings", "slot", "fill"]);
// The attribute that says best which one it is.
const KEY_ATTRS = ["name", "block", "label", "flow", "source", "title", "level", "cols", "value", "action", "state"];
const short = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function flatten(nodes: TNode[], depth: number, out: Entry[]) {
  for (const n of nodes) {
    if (n.k === "tag") {
      const a = n.attrs.find(([k]) => KEY_ATTRS.includes(k));
      // (Text right inside it: a heading's or a button's words.)
      const text = n.kids.map((k) => (k.k === "text" ? k.v : k.k === "out" ? `{{ ${k.expr} }}` : "")).join("").trim();
      out.push({ depth, line: n.line, kind: "tag", label: n.name, hint: a ? `${a[0]}=${short(a[1])}` : short(text), quiet: SETUP.has(n.name) });
      flatten(n.kids, depth + 1, out);
    } else if (n.k === "if") {
      out.push({ depth, line: n.line, kind: "if", label: "if", hint: short(n.cond, 36), quiet: false });
      flatten(n.then, depth + 1, out);
      if (n.else.length) {
        out.push({ depth, line: (n.else.find((x) => "line" in x) as { line: number } | undefined)?.line ?? n.line, kind: "else", label: "else", hint: "", quiet: false });
        flatten(n.else, depth + 1, out);
      }
    } else if (n.k === "each") {
      out.push({ depth, line: n.line, kind: "each", label: "each", hint: short(n.expr, 36), quiet: false });
      flatten(n.body, depth + 1, out);
    }
  }
}

export function TemplateOutline({ src, caretLine, onPick }: { src: string; caretLine: number; onPick: (line: number) => void }) {
  const t = useT();
  const { entries, errors } = useMemo(() => {
    const p = parseView(src);
    const out: Entry[] = [];
    flatten(p.nodes, 0, out);
    return { entries: out, errors: p.errors };
  }, [src]);
  // The entry the cursor is in: the last one starting on or before its line.
  let here = -1;
  entries.forEach((e, i) => e.line <= caretLine && (here = i));
  return (
    <nav aria-label={t("Outline")} className="h-full overflow-auto rounded-lg border border-zinc-200 py-1 text-xs dark:border-zinc-800">
      {!entries.length && <p className="px-2 py-1 text-zinc-500">{t("Nothing yet.")}</p>}
      {entries.map((e, i) => (
        <button
          key={i}
          type="button"
          title={t("line {n}", { n: e.line })}
          onClick={() => onPick(e.line)}
          style={{ paddingLeft: `${0.5 + e.depth * 0.75}rem` }}
          className={`flex w-full items-baseline gap-1.5 py-0.5 pr-2 text-left ${i === here ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"} ${e.quiet ? "opacity-55" : ""}`}
        >
          <span className={`shrink-0 font-mono ${e.kind === "tag" ? "text-indigo-700 dark:text-indigo-300" : "text-amber-700 dark:text-amber-400"}`}>{e.kind === "tag" ? e.label : `#${e.label}`}</span>
          {e.hint && <span className="min-w-0 truncate text-zinc-500">{e.hint}</span>}
        </button>
      ))}
      {errors.length > 0 && <p className="mt-1 border-t border-zinc-200 px-2 pt-1 text-red-600 dark:border-zinc-800 dark:text-red-400">{t("{n} mistakes", { n: errors.length })}</p>}
    </nav>
  );
}
