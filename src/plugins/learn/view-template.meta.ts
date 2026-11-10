import type { T } from "@/lib/i18n/shared";
import type { ViewAppMeta } from "@/plugins/workspace/view-apps";

/**
 * Learn's views of its databases in the Workspace (the Learn plugin): its own parts — the courses as cards, a course's skill map,
 * the cards due to review (ui/view-parts.tsx) — with the view language around them: the activity as a day-by-day heatmap, the
 * cards' due days on a calendar, the conversations as a timeline, the exercises as cards. Each database of a learning space gets
 * its view (dbs.ts ensureSpace), built from its fields' names as they are. Client-safe.
 */

const q = (s: string) => s.replace(/"/g, "'");

export const LEARN_VIEW: ViewAppMeta = {
  app: "learn",
  label: "Learn",
  parts: [
    { name: "learn.courses", description: "the courses of this learning space as cards (level, progress, streak, cards due) — a click opens the course" },
    { name: "learn.map", description: "a course's skill map (its steps open their lessons)", attrs: { course: "a course's id: {{ state.course }}" } },
    { name: "learn.review", description: "the cards due, to review now (spaced repetition)", attrs: { course: "a course's id (none: all of the space)" } },
  ],
  actions: [],
  appData: "app.courses: the space's courses [{ id, title, status, level, streak, due, progress }]; app.courseOptions: \"id:Title, …\" (a <select>'s options); app.firstCourse; app.due: cards due in all",
  defaultTemplate: (t) => learnTemplate("courses", {}, t),
};

/** Which of Learn's databases. */
export type LearnDb = "courses" | "steps" | "exercises" | "activity" | "cards" | "messages";

/** A Learn database's view, with its fields' names (by Learn's property id → the name the database has). */
export function learnTemplate(which: LearnDb, names: Record<string, string>, t: T): string {
  const n = (id: string, fallback: string) => `[${names[id] ?? fallback}]`;
  const plain = (id: string, fallback: string) => names[id] ?? fallback;
  switch (which) {
    case "courses":
      return [`<header title="{{ db.title }}" subtitle="{{ rows | count }} · 🃏 {{ app.due }}" icon="🎓"/>`, `<part name="learn.courses"/>`].join("\n");
    case "steps":
      return [
        `<state name="course" value="{{ app.firstCourse }}"/>`,
        `{{#if app.courseOptions}}`,
        `<toolbar><select bind="course" options="{{ app.courseOptions }}" label="${q(t("Course"))}" search=true/></toolbar>`,
        `<part name="learn.map" course="{{ state.course }}"/>`,
        `{{#else}}<empty icon="🗺️" title="${q(t("No course with a plan yet"))}" text="${q(t("Start one on the learning space's page."))}"/>{{/if}}`,
      ].join("\n");
    case "cards":
      return [
        `<header title="{{ db.title }}" subtitle="{{ rows | count }}" icon="🗂️"/>`,
        `<tabset bind="tab">`,
        `<tab id="review" label="${q(t("Review now"))}" n="{{ app.due }}"><part name="learn.review"/></tab>`,
        `<tab id="due" label="${q(t("When they're due"))}"><calendar source="rows" date="${plain("learndue", "Due")}"><truncate>{{ title }}</truncate></calendar></tab>`,
        `<tab id="hard" label="${q(t("The hard ones"))}"><list source="rows | where('${plain("learnlapses", "Lapses")}', '>', 0) | sort('${plain("learnlapses", "Lapses")}', 'desc')" open=true empty="${q(t("None yet."))}"><row wrap=false><col fill=true><b>{{ title }}</b><small><muted><clamp lines=1>{{ ${n("learnback", "Back")} }}</clamp></muted></small></col><small>✗ {{ ${n("learnlapses", "Lapses")} }}</small></row></list></tab>`,
        `</tabset>`,
      ].join("\n");
    case "activity":
      return [
        `<header title="{{ db.title }}" subtitle="{{ rows | sum('${plain("learnxp", "XP")}') }} XP" icon="📈"/>`,
        `<heatmap source="rows" date="${plain("learnat", "When")}" value="${plain("learnxp", "XP")}" weeks=26 label="${q(t("XP per day"))}" unit="XP"/>`,
        `<pivot source="rows" rows="${plain("learncourse", "Course")}" cols="${plain("learnevent", "Kind")}" value="${plain("learnxp", "XP")}" calc=sum empty="${q(t("Nothing learned yet."))}"/>`,
        `<timeline source="rows | sort('${plain("learnat", "When")}', 'desc')" date="{{ ${n("learnat", "When")} | relative }}" page=30 more="${q(t("Show more"))}" empty="${q(t("Nothing learned yet."))}"><row wrap=false gap=2><col fill=true><truncate>{{ title }}</truncate></col>{{ ${n("learnevent", "Kind")} | chip }}<b>+{{ ${n("learnxp", "XP")} }} XP</b></row></timeline>`,
      ].join("\n");
    case "exercises":
      return [
        `<header title="{{ db.title }}" subtitle="{{ rows | count }}" icon="🧩"/>`,
        `<cards source="rows | sort('${plain("learnbest", "Best score")}', 'desc')" cols=3 open=true empty="${q(t("No exercises yet — the teacher builds them in the lessons."))}">`,
        `<b>{{ title }}</b><small><muted>{{ ${n("learncourse", "Course")} }}</muted></small>`,
        `{{#if ${n("learnbest", "Best score")}}}<progress value="{{ ${n("learnbest", "Best score")} * 100 }}" max=100 show=true tone=good/>{{#else}}<small><muted>${q(t("not done yet"))}</muted></small>{{/if}}`,
        `</cards>`,
      ].join("\n");
    case "messages":
      return [
        `<state name="q" value=""/>`,
        `<toolbar><search bind="q" placeholder="${q(t("Search the conversations"))}"/></toolbar>`,
        `<timeline source="rows | search(state.q) | sort('${plain("learnat", "Time")}', 'desc')" date="{{ ${n("learnat", "Time")} | relative }}" page=40 more="${q(t("Show more"))}" empty="${q(t("No conversations yet."))}">`,
        `<row gap=2>{{ ${n("learnrole", "Who")} | chip }}<small><muted>{{ ${n("learnstep", "Step")} }}</muted></small></row><text><clamp lines=4>{{ ${n("learntext", "Text")} }}</clamp></text>`,
        `</timeline>`,
      ].join("\n");
  }
}
