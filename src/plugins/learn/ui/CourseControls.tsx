"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { deleteCourseAction, retryResearchAction, setDailyGoalAction, setInterestsAction, setStudySlotsAction, updatePlanAction } from "@/app/learn/actions";
import type { StudySlot } from "../schedule-shared";

type R = { ok: true } | { ok: false; error: string };
const useRun = () => {
  const router = useRouter();
  const [pending, start] = useTransition();
  return [pending, (f: () => Promise<R>, ok?: string) => start(async () => {
    const r = await f();
    if (!r.ok) return void toast(r.error, { tone: "error" });
    if (ok) toast(ok, { tone: "ok" });
    router.refresh();
  })] as const;
};

/** Research again (after it failed, or for a fresh plan). */
export function RetryResearch({ id, label }: { id: number; label: string }) {
  const [pending, run] = useRun();
  return (
    <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => retryResearchAction(id))}>
      {label}
    </button>
  );
}

/** Research and plan the course anew (a new plan: its progress, exercises and cards start over). */
export function ReplanCourse({ id }: { id: number }) {
  const t = useT();
  const [pending, run] = useRun();
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={pending}
      onClick={() => {
        if (confirm(t("Plan the course anew? Claude researches it again and writes a new plan — the progress so far starts over."))) run(() => retryResearchAction(id));
      }}
    >
      {t("Plan anew")}
    </button>
  );
}

/**
 * "Update planning": the plan revised — for what interests you now and a note of yours ("more clinical cases") — while
 * everything you've mastered or begun stays as it is.
 */
export function UpdatePlan({ id }: { id: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, run] = useRun();
  if (!open)
    return (
      <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
        {t("Update planning")}
      </button>
    );
  return (
    <div className="card w-full space-y-2 p-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("Claude revises the plan for your interests and what you write here. Everything you've mastered or begun stays — with its lessons.")}</p>
      <textarea className="input w-full text-sm" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. more clinical cases; less statistics; pharmacology earlier")} maxLength={2000} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await updatePlanAction(id, note);
              if (r.ok) setOpen(false);
              return r;
            })
          }
        >
          {pending ? t("Starting …") : t("Update planning")}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

/** How much each path interests you (0 skips it in the suggestions, 3 puts it first). */
export function InterestsEditor({ id, paths, weights }: { id: number; paths: string[]; weights: Record<string, number> }) {
  const t = useT();
  const [w, setW] = useState(weights);
  const [saved, setSaved] = useState<"" | "saving" | "saved" | "failed">("");
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const levels = [t("not now"), t("a little"), t("interested"), t("most of all")];
  // Each change saved by itself, a moment after the last (a button below the sliders was easy to miss — nothing was kept).
  const change = (next: Record<string, number>) => {
    setW(next);
    setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await setInterestsAction(id, next).catch((e: unknown) => ({ ok: false as const, error: String(e) }));
      if (!r.ok) {
        setSaved("failed");
        return void toast(r.error, { tone: "error" });
      }
      setSaved("saved");
      router.refresh(); // the red thread and the next steps follow
    }, 600);
  };
  if (!paths.length) return null;
  return (
    <div className="space-y-2">
      {paths.map((p) => {
        const v = w[p] ?? 1;
        return (
          <label key={p} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1">{p}</span>
            <input type="range" min={0} max={3} step={1} value={v} aria-valuetext={levels[v]} onChange={(e) => change({ ...w, [p]: Number(e.target.value) })} className="w-32" />
            <span className="w-24 text-xs text-zinc-500">{levels[v]}</span>
          </label>
        );
      })}
      <p className="text-xs text-zinc-500" aria-live="polite">
        {saved === "saving" ? t("Saving …") : saved === "saved" ? t("Saved — the red thread follows.") : saved === "failed" ? t("Not saved.") : t("Saved as you change them.")}
      </p>
    </div>
  );
}

/** The day's goal in experience points. */
export function DailyGoal({ id, goal }: { id: number; goal: number }) {
  const t = useT();
  const [pending, run] = useRun();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span>{t("Daily goal")}</span>
      <select className="input w-auto" value={goal} disabled={pending} onChange={(e) => run(() => setDailyGoalAction(id, Number(e.target.value)))}>
        {[20, 50, 100, 200].map((x) => (
          <option key={x} value={x}>
            {t("{xp} XP", { xp: x })}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Weekly study times — they go into Zeff's calendar ("Learn"). */
export function StudySlots({ id, slots }: { id: number; slots: StudySlot[] }) {
  const t = useT();
  const [list, setList] = useState(slots);
  const [pending, run] = useRun();
  const days = [t("Monday"), t("Tuesday"), t("Wednesday"), t("Thursday"), t("Friday"), t("Saturday"), t("Sunday")];
  const set = (i: number, v: Partial<StudySlot>) => setList(list.map((s, j) => (j === i ? { ...s, ...v } : s)));
  return (
    <div className="space-y-2">
      {list.map((s, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          <select className="input w-auto" aria-label={t("Weekday")} value={s.day} onChange={(e) => set(i, { day: Number(e.target.value) })}>
            {days.map((d, k) => (
              <option key={k} value={k + 1}>
                {d}
              </option>
            ))}
          </select>
          <input type="time" className="input w-auto" aria-label={t("Time")} value={s.time} onChange={(e) => set(i, { time: e.target.value })} />
          <select className="input w-auto" aria-label={t("Minutes")} value={s.minutes} onChange={(e) => set(i, { minutes: Number(e.target.value) })}>
            {[15, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {t("{n} min", { n: m })}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm" aria-label={t("Remove")} onClick={() => setList(list.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setList([...list, { day: 1, time: "18:00", minutes: 30 }])}>
          {t("Add a time")}
        </button>
        <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => run(() => setStudySlotsAction(id, list), t("Saved — the times are in the calendar."))}>
          {t("Save")}
        </button>
      </div>
    </div>
  );
}

/** Remove the course (its plan, progress, exercises and cards). */
export function DeleteCourse({ id }: { id: number }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-sm text-red-700 dark:text-red-400"
      disabled={pending}
      onClick={() => {
        if (!confirm(t("Remove this course with its progress, exercises and cards?"))) return;
        start(async () => {
          const r = await deleteCourseAction(id);
          if (!r.ok) return void toast(r.error, { tone: "error" });
          router.push("/learn");
        });
      }}
    >
      {t("Remove course")}
    </button>
  );
}
