import Link from "next/link";
import { t } from "@/lib/i18n/server";

/**
 * A topic of a course (a year, a phase or a skill — a row of Steps that holds steps), on its row in the Workspace: what it is
 * about, how far along it is, and its steps — each opening its own row (its lesson). Server only.
 */
export async function TopicScreen({ courseId, nodeKey }: { courseId: number; nodeKey: string }) {
  const store = await import("@/plugins/learn/store");
  const course = store.getCourse(courseId);
  if (!course) return null;
  const { nodes, tree } = store.courseTree(course.id);
  const node = nodes.find((n) => n.key === nodeKey);
  if (!node) return null;
  const status = (k: string) => tree.status.get(k) ?? "locked";
  // Its steps: all below it (a phase's skills' steps too), in the plan's order.
  const below = new Set<string>([node.key]);
  for (const n of nodes) if (n.parent && below.has(n.parent)) below.add(n.key);
  const steps = nodes.filter((n) => n.kind === "step" && below.has(n.key) && n.key !== node.key);
  const done = steps.filter((s) => status(s.key) === "mastered").length;
  const word = (s: string) => (s === "mastered" ? t("mastered") : s === "locked" ? t("locked") : s === "active" ? t("in progress") : t("open"));
  return (
    <section className="mb-6 space-y-3" aria-label={node.title}>
      <nav className="text-xs text-zinc-500">
        <Link href={`/workspace/${course.id}`} className="hover:underline">
          {course.title}
        </Link>
      </nav>
      {node.summary && <p className="max-w-[75ch] text-sm text-zinc-600 dark:text-zinc-400">{node.summary}</p>}
      <div className="flex items-center gap-3">
        <div className="h-2 w-48 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-label={t("Progress")} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
          <div className="h-full bg-emerald-500" style={{ width: `${steps.length ? Math.round((done / steps.length) * 100) : 0}%` }} />
        </div>
        <span className="text-xs text-zinc-500">{t("{done} of {total} steps", { done, total: steps.length })}</span>
      </div>
      <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {steps.map((s) => (
          <li key={s.key}>
            <Link href={`/workspace/${s.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
              <span aria-hidden>{status(s.key) === "mastered" ? "✅" : status(s.key) === "locked" ? "🔒" : status(s.key) === "active" ? "▶" : "○"}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
              <span className="shrink-0 text-xs text-zinc-500">
                {s.minutes ? `${t("{n} min", { n: s.minutes })} · ` : ""}
                {word(status(s.key))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
