"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";

export type SkillTreeStatus = "locked" | "available" | "active" | "mastered";
export type SkillTreeStep = { key: string; title: string; status: SkillTreeStatus; href?: string; xp?: number; minutes?: number | null };
export type SkillTreeSkill = { key: string; title: string; status: SkillTreeStatus; path?: string | null; requires: string[]; column: number; steps: SkillTreeStep[]; xp?: number };

const TONE: Record<SkillTreeStatus, string> = {
  mastered: "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40",
  active: "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/30 dark:border-indigo-400 dark:bg-indigo-950/40",
  available: "border-indigo-300 bg-white dark:border-indigo-800 dark:bg-zinc-900",
  locked: "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50",
};
const DOT: Record<SkillTreeStatus, string> = {
  mastered: "bg-emerald-500 text-white",
  active: "bg-indigo-600 text-white",
  available: "border-2 border-indigo-500 bg-white dark:bg-zinc-900",
  locked: "border border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800",
};

/**
 * A skill tree (a building block of Zeff): skills in columns after what they require (`column`), lines from each
 * requirement, each skill's steps inside it — mastered, active, open, locked. On a phone the columns stand one below
 * the other. A step that can be done links to it (`href`).
 */
export function SkillTree({ skills, label }: { skills: SkillTreeSkill[]; label: string }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; done: boolean }[]>([]);
  const columns = [...new Set(skills.map((s) => s.column))].sort((a, b) => a - b);

  // The lines: from a requirement's card to the card that requires it (measured where they're drawn).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const draw = () => {
      const r0 = el.getBoundingClientRect();
      const at = (k: string) => el.querySelector<HTMLElement>(`[data-skill="${CSS.escape(k)}"]`)?.getBoundingClientRect();
      const out: typeof lines = [];
      const vertical = window.matchMedia("(max-width: 767px)").matches;
      for (const s of skills) {
        const to = at(s.key);
        if (!to) continue;
        for (const r of s.requires) {
          const from = at(r);
          if (!from) continue;
          const done = skills.find((x) => x.key === r)?.status === "mastered";
          out.push(
            vertical
              ? { x1: from.left + from.width / 2 - r0.left, y1: from.bottom - r0.top, x2: to.left + to.width / 2 - r0.left, y2: to.top - r0.top, done }
              : { x1: from.right - r0.left, y1: from.top + from.height / 2 - r0.top, x2: to.left - r0.left, y2: to.top + to.height / 2 - r0.top, done },
          );
        }
      }
      setLines(out);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [skills]);

  return (
    <div ref={box} className="relative" role="group" aria-label={label}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {lines.map((l, i) => {
          const mx = (l.x1 + l.x2) / 2;
          const my = (l.y1 + l.y2) / 2;
          const d = Math.abs(l.x2 - l.x1) > Math.abs(l.y2 - l.y1) ? `M${l.x1},${l.y1} C${mx},${l.y1} ${mx},${l.y2} ${l.x2},${l.y2}` : `M${l.x1},${l.y1} C${l.x1},${my} ${l.x2},${my} ${l.x2},${l.y2}`;
          return <path key={i} d={d} fill="none" strokeWidth={2} className={l.done ? "stroke-emerald-400 dark:stroke-emerald-700" : "stroke-zinc-300 dark:stroke-zinc-700"} />;
        })}
      </svg>
      <div className="relative flex flex-col gap-8 md:flex-row md:gap-14 md:overflow-x-auto md:pb-2">
        {columns.map((c) => (
          <div key={c} className="flex min-w-0 flex-col gap-4 md:w-72 md:shrink-0">
            {skills
              .filter((s) => s.column === c)
              .map((s) => (
                <section key={s.key} data-skill={s.key} className={`rounded-xl border p-3 transition ${TONE[s.status]}`} aria-label={`${s.title} — ${statusLabel(t, s.status)}`}>
                  <header className="mb-2 flex items-start gap-2">
                    <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] ${DOT[s.status]}`} aria-hidden>
                      {s.status === "mastered" ? "✓" : s.status === "locked" ? "🔒" : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug font-semibold">{s.title}</span>
                      {s.path && <span className="text-xs text-zinc-500">{s.path}</span>}
                    </span>
                    {s.xp ? <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{s.xp} XP</span> : null}
                  </header>
                  <ol className="space-y-1">
                    {s.steps.map((st) => {
                      const inner = (
                        <>
                          <span className={`grid size-4 shrink-0 place-items-center rounded-full text-[9px] ${DOT[st.status]}`} aria-hidden>
                            {st.status === "mastered" ? "✓" : ""}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{st.title}</span>
                          {st.minutes ? <span className="shrink-0 text-[11px] text-zinc-400">{st.minutes}′</span> : null}
                        </>
                      );
                      return (
                        <li key={st.key}>
                          {st.href && st.status !== "locked" ? (
                            <Link href={st.href} className="flex min-h-9 items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none dark:hover:bg-white/5">
                              {inner}
                              <span className="sr-only">— {statusLabel(t, st.status)}</span>
                            </Link>
                          ) : (
                            <span className="flex min-h-9 items-center gap-2 px-1.5 py-1 text-[13px] text-zinc-500">
                              {inner}
                              <span className="sr-only">— {statusLabel(t, st.status)}</span>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function statusLabel(t: (s: string) => string, s: SkillTreeStatus): string {
  return s === "mastered" ? t("mastered") : s === "active" ? t("in progress") : s === "available" ? t("open") : t("locked");
}
