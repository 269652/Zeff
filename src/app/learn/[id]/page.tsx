import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { localDay } from "@/lib/dates";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { SkillTree, type SkillTreeSkill } from "@/components/skill-tree/SkillTree";
import { SkillMap, type SkillMapNode } from "@/components/skill-tree/SkillMap";
import { courseRoute, skillGraph } from "@/plugins/learn/map";
import { isInstalled } from "@/plugins/state";
import { DailyGoal, DeleteCourse, InterestsEditor, ReplanCourse, RetryResearch, StudySlots, UpdatePlan } from "@/plugins/learn/ui/CourseControls";
import { badgeLabel } from "@/plugins/learn/ui/badges";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isInstalled("learn")) return { title: t("Learn") };
  const { getCourse } = await import("@/plugins/learn/store");
  return { title: getCourse(Number((await params).id))?.title ?? t("Learn") };
}

/**
 * A course: your level, streak and the day's goal; what's next (by your interests); the plan as skill trees — a year's
 * phases, each phase's skills in columns after what they require, each skill's small steps. Then interests, study times,
 * sources.
 */
export default async function CoursePage({ params }: Props) {
  await connection();
  if (!isInstalled("learn")) return <PluginNotInstalled id="learn" />;
  const store = await import("@/plugins/learn/store");
  const { levelOf, dailyProgress, BADGES } = await import("@/plugins/learn/game");
  const asked = Number((await params).id);
  const course = store.getCourse(asked);
  if (!course) notFound();
  // (An old link — the course's id from before Learn's data moved into the Workspace: to where it is now.)
  if (course.id !== asked) redirect(`/learn/${course.id}`);
  const id = course.id;
  const back = (
    <Link href="/learn" className="text-sm text-zinc-500 hover:underline">
      ← {t("Learn")}
    </Link>
  );

  if (course.status !== "ready")
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {back}
        <h1 className="text-lg font-semibold">{course.title}</h1>
        {course.status === "researching" ? (
          <div className="card space-y-2 p-4" aria-live="polite">
            <p className="font-medium">{t("Claude is researching and planning …")}</p>
            <p className="text-sm text-zinc-500">{t("It looks for scholarly sources and curricula, then writes the plan. This takes a few minutes — the page fills in by itself.")}</p>
          </div>
        ) : (
          <div className="card space-y-3 p-4">
            <p className="font-medium text-red-700 dark:text-red-400">{t("The research failed.")}</p>
            {course.error && <p className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{course.error}</p>}
            <RetryResearch id={id} label={t("Try again")} />
          </div>
        )}
        <ReplanCourse id={id} />
        <DeleteCourse id={id} />
      </div>
    );

  const { nodes, tree } = store.courseTree(id);
  const cols = store.nodeLayers(nodes);
  const kids = new Map<string, typeof nodes>();
  for (const n of nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const status = (k: string) => tree.status.get(k) ?? "locked";
  const next = store.nextCourseSteps(id, 5);
  const lv = levelOf(course.xp);
  const today = dailyProgress(course.today === localDay(new Date()) ? course.todayXp : 0, course.dailyGoal);
  const due = store.dueCards(id).length;
  const stepHref = (k: string) => `/learn/${id}/step/${encodeURIComponent(k)}`;
  const skillsOf = (phase: string): SkillTreeSkill[] => {
    const skills = (kids.get(phase) ?? []).filter((n) => n.kind === "skill");
    const min = Math.min(...skills.map((s) => cols.get(s.key) ?? 0));
    return skills.map((s) => {
      const steps = (kids.get(s.key) ?? []).filter((n) => n.kind === "step");
      return {
        key: s.key,
        title: s.title,
        status: status(s.key),
        path: s.path,
        requires: s.requires,
        column: (cols.get(s.key) ?? 0) - min,
        xp: s.xp,
        steps: steps.map((st) => ({ key: st.key, title: st.title, status: status(st.key), href: stepHref(st.key), minutes: st.minutes })),
      };
    });
  };
  const years = nodes.filter((n) => n.kind === "year");
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const mapNodes: SkillMapNode[] = skillGraph(nodes).map((g) => {
    const s = byKey.get(g.key)!;
    return {
      key: s.key,
      title: s.title,
      status: status(s.key),
      path: s.path,
      group: g.phase,
      after: g.after,
      foundation: g.foundation,
      summary: s.summary,
      steps: (kids.get(s.key) ?? []).filter((n) => n.kind === "step").map((st) => ({ key: st.key, title: st.title, status: status(st.key), href: stepHref(st.key), minutes: st.minutes })),
    };
  });
  const mapGroups = nodes.filter((n) => n.kind === "phase").map((p) => ({ key: p.key, title: p.title }));
  // The red thread through the map: the way walked, then the plan ahead (map.ts courseRoute).
  const route = courseRoute(nodes, skillGraph(nodes), course.interests);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {back}
      <header className="space-y-3">
        {/* Title, what it is, then its button — one under the other (beside each other the title was squeezed on a phone). */}
        <div className="flex flex-col items-start gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg font-semibold">{course.title}</h1>
            {course.summary && <p className="max-w-[75ch] text-sm text-zinc-600 dark:text-zinc-400">{course.summary}</p>}
          </div>
          {due > 0 && (
            <Link href={`/learn/${id}/review`} className="btn btn-primary">
              🃏 {t("Review {n} cards", { n: due })}
            </Link>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="card space-y-1 p-3">
            <p className="text-xs text-zinc-500">{t("Level {n}", { n: lv.level })}</p>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-label={t("To the next level")} aria-valuemin={0} aria-valuemax={lv.need} aria-valuenow={lv.into}>
              <div className="h-full bg-indigo-500" style={{ width: `${Math.round(lv.share * 100)}%` }} />
            </div>
            <p className="text-xs text-zinc-500">{t("{into} / {need} XP", { into: lv.into, need: lv.need })}</p>
          </div>
          <div className="card space-y-1 p-3">
            <p className="text-xs text-zinc-500">{t("Today")}</p>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-label={t("Daily goal")} aria-valuemin={0} aria-valuemax={today.goal} aria-valuenow={today.xp}>
              <div className={`h-full ${today.reached ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${Math.round(today.share * 100)}%` }} />
            </div>
            <p className="text-xs text-zinc-500">{today.reached ? t("Goal reached ✓") : t("{xp} / {goal} XP", { xp: today.xp, goal: today.goal })}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-zinc-500">{t("Streak")}</p>
            <p className="text-lg font-semibold">🔥 {course.streak}</p>
            <p className="text-xs text-zinc-500">{t("days in a row")}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-zinc-500">{t("Progress")}</p>
            <p className="text-lg font-semibold">{Math.round(tree.progress.share * 100)}%</p>
            <p className="text-xs text-zinc-500">{t("{done} of {total} steps", { done: tree.progress.mastered, total: tree.progress.steps })}</p>
          </div>
        </div>
        {course.badges.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label={t("Badges")}>
            {BADGES.filter((b) => course.badges.includes(b.id)).map((b) => {
              const l = badgeLabel(t, b.id);
              return (
                <li key={b.id} className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <span aria-hidden>{l.icon}</span> {l.name}
                </li>
              );
            })}
          </ul>
        )}
      </header>

      <section id="skill-map" className="scroll-mt-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t("Skill map")}</h2>
          {/* The plan revised (interests, a note of yours) — what's done stays. */}
          <UpdatePlan id={id} />
        </div>
        {course.error && <p className="text-sm text-amber-700 dark:text-amber-400">{course.error}</p>}
        <SkillMap nodes={mapNodes} groups={mapGroups} route={route} label={t("Skill map: {course}", { course: course.title })} />
      </section>

      {next.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">{t("Next steps")}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {next.map((n) => (
              <li key={n.key}>
                <Link href={stepHref(n.key)} className="card block h-full space-y-1 p-3 hover:border-indigo-300 dark:hover:border-indigo-700">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 font-medium">{n.title}</span>
                    {status(n.key) === "active" && <span className="shrink-0 text-xs text-indigo-700 dark:text-indigo-300">{t("in progress")}</span>}
                  </span>
                  {n.summary && <span className="line-clamp-2 block text-sm text-zinc-500">{n.summary}</span>}
                  <span className="block text-xs text-zinc-500">
                    {n.minutes ? `${t("{n} min", { n: n.minutes })} · ` : ""}
                    {t("{xp} XP", { xp: n.xp })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}


      <details className="space-y-3">
        <summary className="cursor-pointer text-sm font-medium text-zinc-600 dark:text-zinc-400">{t("By phase, as a list")}</summary>
      {years.map((y) => (
          <section key={y.key} className="space-y-3">
            <h2 className="text-base font-semibold">
              {y.title} <span className="text-sm font-normal text-zinc-500">· {status(y.key) === "mastered" ? t("mastered") : status(y.key) === "locked" ? t("locked") : t("open")}</span>
            </h2>
            {(kids.get(y.key) ?? [])
              .filter((p) => p.kind === "phase")
              .map((p) => {
                const st = status(p.key);
                return (
                  <details key={p.key} className="card p-3" open={st === "active" || st === "available"}>
                    <summary className="cursor-pointer font-medium">
                      {p.title} <span className="text-sm font-normal text-zinc-500">· {st === "mastered" ? t("mastered") : st === "locked" ? t("locked") : st === "active" ? t("in progress") : t("open")}</span>
                    </summary>
                    {p.summary && <p className="mt-1 max-w-[75ch] text-sm text-zinc-500">{p.summary}</p>}
                    <div className="mt-3">
                      <SkillTree skills={skillsOf(p.key)} label={t("Skill tree: {phase}", { phase: p.title })} />
                    </div>
                  </details>
                );
              })}
          </section>
        ))}
      </details>

      <div className="grid gap-4 lg:grid-cols-2">
        {tree.paths.size > 0 && (
          <section className="card space-y-2 p-4">
            <h2 className="text-base font-semibold">{t("Your interests")}</h2>
            <p className="text-sm text-zinc-500">{t("The paths that interest you most come first in the next steps.")}</p>
            <InterestsEditor id={id} paths={[...tree.paths.keys()]} weights={course.interests} />
          </section>
        )}
        <section className="card space-y-3 p-4">
          <h2 className="text-base font-semibold">{t("Study times")}</h2>
          <p className="text-sm text-zinc-500">{t("Weekly times to learn — Zeff puts them in your calendar.")}</p>
          <StudySlots id={id} slots={course.slots} />
          <DailyGoal id={id} goal={course.dailyGoal} />
        </section>
      </div>

      {course.sources.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer text-base font-semibold">{t("Sources ({n})", { n: course.sources.length })}</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {course.sources.map((s, i) => (
              <li key={i}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline dark:text-indigo-300">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}
                {s.year ? <span className="text-zinc-500"> ({s.year})</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
      {course.problems.length > 0 && (
        <details className="text-sm text-zinc-500">
          <summary className="cursor-pointer">{t("Repaired in the plan ({n})", { n: course.problems.length })}</summary>
          <ul className="mt-1 list-disc pl-5">
            {course.problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <ReplanCourse id={id} />
        <DeleteCourse id={id} />
      </div>
    </div>
  );
}
