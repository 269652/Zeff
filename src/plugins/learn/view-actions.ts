"use server";

import { pluginAction } from "@/lib/action-result";
import { t } from "@/lib/i18n/server";
import type { SkillMapNode } from "@/components/skill-tree/SkillMap";

/**
 * What Learn's views of its databases read (view-template.meta.ts, ui/view-parts.tsx): the courses of the learning space a
 * database is in, a course's skill map (its steps linking to their rows), the cards due. In the Workspace: links stay there.
 */

const run = pluginAction("learn", () => t("The Learn plugin is not installed (Menu → Plugins)."));

/** The space a database (or a row of one) belongs to — its page's id — or null. */
async function spaceOf(pageId: number): Promise<number | null> {
  const { spaceOfPage } = await import("./dbs");
  return spaceOfPage(Number(pageId))?.folder ?? null;
}

/** A Learn view's app.*: the courses of its space (cards and the options of a course picker). */
export async function learnViewDataAction(dbId: number) {
  return run(async () => {
    const { courseCards } = await import("./ui/CourseCards");
    const courses = await courseCards(await spaceOf(dbId));
    const ready = courses.filter((c) => c.status === "ready");
    return {
      courses,
      // "id:Title, …" — <select options=…> (a title's commas would split it: left out).
      courseOptions: ready.map((c) => `${c.id}:${c.title.replace(/[,:]/g, " ")}`).join(", "),
      firstCourse: ready[0] ? String(ready[0].id) : "",
      due: courses.reduce((s, c) => s + c.due, 0),
    };
  });
}

/** A course's skill map as the map draws it — each step opening its row in the Workspace. */
export async function learnMapAction(courseId: number) {
  return run(async () => {
    const store = await import("./store");
    const { courseRoute, skillGraph } = await import("./map");
    const course = store.getCourse(Number(courseId));
    if (!course || course.status !== "ready") return { map: null };
    const { nodes, tree } = store.courseTree(course.id);
    const status = (k: string) => tree.status.get(k) ?? "locked";
    const kids = new Map<string, typeof nodes>();
    for (const n of nodes) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const graph = skillGraph(nodes);
    const mapNodes: SkillMapNode[] = graph.map((g) => {
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
        steps: (kids.get(s.key) ?? []).filter((n) => n.kind === "step").map((st) => ({ key: st.key, title: st.title, status: status(st.key), href: `/workspace/${st.id}`, minutes: st.minutes })),
      };
    });
    return {
      map: {
        title: course.title,
        nodes: mapNodes,
        groups: nodes.filter((n) => n.kind === "phase").map((p) => ({ key: p.key, title: p.title })),
        route: courseRoute(nodes, graph, course.interests),
        progress: tree.progress,
      },
    };
  });
}

/** The cards due — of a course, or of the space a database is in. */
export async function learnDueCardsAction(dbId: number, courseId?: number | null) {
  return run(async () => {
    const store = await import("./store");
    const space = await spaceOf(dbId);
    const courses = courseId ? [Number(courseId)] : store.listCourses(space).map((c) => c.id);
    return { cards: courses.flatMap((id) => store.dueCards(id).map((c) => ({ id: c.id, front: c.front, back: c.back }))) };
  });
}
