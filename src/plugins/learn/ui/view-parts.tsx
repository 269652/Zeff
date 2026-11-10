"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { SkillMap } from "@/components/skill-tree/SkillMap";
import type { AppViewProps, PartProps, ViewAppModule } from "@/plugins/workspace/ui/app-view";
import { learnDueCardsAction, learnMapAction, learnViewDataAction } from "../view-actions";
import type { CourseCard } from "./CourseCards";
import { ReviewDeck } from "./ReviewDeck";

/**
 * Learn's views of its databases in the Workspace (view-template.meta.ts): the courses as cards, a course's skill map, the cards
 * due to review — Learn's own parts, drawn in any view of its databases; a course or a step opens its row (Learn's screen there).
 */

type MapData = Awaited<ReturnType<typeof learnMapAction>> extends infer R ? (R extends { ok: true; map: infer M } ? M : never) : never;

function useLearnData(props: AppViewProps) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void learnViewDataAction(props.data.id).then((r) => live && r.ok && setData(r as unknown as Record<string, unknown>));
    return () => {
      live = false;
    };
  }, [props.data.id, tick, props.rows.length]);
  return { data, reload: useCallback(() => setTick((x) => x + 1), []) };
}

function Courses({ app }: PartProps) {
  const t = useT();
  const courses = (app.courses as CourseCard[] | undefined) ?? [];
  if (!courses.length) return <p className="text-sm text-zinc-500">{t("No courses yet — start one on the learning space's page.")}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {courses.map((c) => (
        <li key={c.id}>
          <Link href={`/workspace/${c.id}`} className="card block h-full space-y-2 p-4 hover:border-indigo-300 dark:hover:border-indigo-700">
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 font-semibold">{c.title}</span>
              {c.status === "ready" && <span className="shrink-0 rounded-full bg-indigo-100 px-2 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">{t("Level {n}", { n: c.level })}</span>}
            </div>
            {c.status === "researching" && <p className="text-sm text-zinc-500">{t("Claude is researching and planning …")}</p>}
            {c.status === "failed" && <p className="text-sm text-red-700 dark:text-red-400">{t("The research failed.")}</p>}
            {c.progress && (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.progress.share * 100)} aria-label={t("Progress")}>
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.round(c.progress.share * 100)}%` }} />
                </div>
                <p className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
                  <span>{t("{done} of {total} steps", { done: c.progress.mastered, total: c.progress.steps })}</span>
                  {c.streak > 0 && <span title={t("days in a row")}>🔥 {c.streak}</span>}
                  {c.due > 0 && <span>🃏 {t("{n} cards due", { n: c.due })}</span>}
                </p>
              </>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Map({ attrs }: PartProps) {
  const t = useT();
  const course = Number(attrs.course);
  const [map, setMap] = useState<MapData | null | undefined>(undefined);
  useEffect(() => {
    if (!(course > 0)) return void setMap(null);
    let live = true;
    void learnMapAction(course).then((r) => live && setMap(r.ok ? (r.map as MapData) : null));
    return () => {
      live = false;
    };
  }, [course]);
  if (map === undefined) return <p className="text-sm text-zinc-500">{t("Loading …")}</p>;
  if (!map) return <p className="text-sm text-zinc-500">{t("Pick a course whose plan is ready.")}</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        <Link href={`/workspace/${course}`} className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
          {map.title}
        </Link>{" "}
        · {t("{done} of {total} steps", { done: map.progress.mastered, total: map.progress.steps })}
      </p>
      <SkillMap nodes={map.nodes} groups={map.groups} route={map.route} label={t("Skill map: {course}", { course: map.title })} />
    </div>
  );
}

function Review({ attrs, data }: PartProps) {
  const t = useT();
  const [cards, setCards] = useState<{ id: number; front: string; back: string }[] | null>(null);
  const course = Number(attrs.course) || null;
  useEffect(() => {
    let live = true;
    void learnDueCardsAction(data.id, course).then((r) => live && setCards(r.ok ? r.cards : []));
    return () => {
      live = false;
    };
  }, [data.id, course]);
  if (cards === null) return <p className="text-sm text-zinc-500">{t("Loading …")}</p>;
  if (!cards.length) return <p className="text-sm text-zinc-500">{t("No cards due — well done.")}</p>;
  return <ReviewDeck cards={cards} />;
}

const LEARN: ViewAppModule = {
  parts: { "learn.courses": Courses, "learn.map": Map, "learn.review": Review },
  useAppData: (props) => useLearnData(props),
};
export default LEARN;
