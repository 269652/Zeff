import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { markdownToDoc, type DocNode } from "./doc";
import { createPage, updatePage } from "./store";
import { widgetCatalog } from "./widgets";

/**
 * The page templates' content: modern pages, not bare headings — a callout that says what the page is for, columns where things sit side
 * by side, to-do lists for what follows, toggles for what is looked up now and then, and live widgets where the page is about your work
 * (the weekly review shows the week's figures). In your language. Server only.
 */

const md = (s: string): DocNode[] => (markdownToDoc(s).content ?? []) as DocNode[];
/** Blocks side by side: a row of columns (each its markdown; a number first: how wide, in parts). */
const columns = (...cols: (string | [number, string])[]): DocNode => ({
  type: "flexBox",
  attrs: { dir: "row", gap: "lg" },
  content: cols.map((c) => {
    const [span, text] = Array.isArray(c) ? c : [null, c];
    return { type: "flexBox", attrs: { dir: "col", gap: "sm", span }, content: md(text) };
  }),
});
const widget = (id: string, config: Record<string, unknown> = {}): DocNode[] => (widgetCatalog().some((w) => w.id === id) ? [{ type: "zeffWidget", attrs: { widget: id, config: JSON.stringify(config), title: "" } }] : []);
const today = () => formatDate(new Date(), { year: true });

function make(parentId: number | null, title: string, icon: string, content: DocNode[], wide = false): number {
  const id = createPage({ parentId, title, icon, content: { type: "doc", content: [...content, { type: "paragraph" }] } });
  if (wide) updatePage(id, { fullWidth: true });
  return id;
}

export function meetingPage(parentId: number | null): number {
  return make(parentId, t("Meeting"), "🗓️", [
    ...md(`:::callout 🗓️ blue\n**${t("Date")}:** ${today()} · **${t("Attendees")}:** ${t("type @ to add people")}\n\n${t("Goal of the meeting, in one sentence.")}\n:::`),
    columns(`## ${t("Agenda")}\n\n1. \n2. \n3. `, [2, `## ${t("Notes")}\n\n- `]),
    ...md(`## ${t("Decisions")}\n\n:::callout ✅ green\n- \n:::\n\n## ${t("Action items")}\n\n- [ ] ${t("Who does what — by when")}\n- [ ] \n\n:::toggle ${t("Parking lot — for another time")}\n- \n:::`),
  ]);
}

export function oneOnOnePage(parentId: number | null): number {
  return make(parentId, t("1:1"), "🤝", [
    ...md(`:::callout 🤝 gray\n${t("A conversation that repeats. Keep the open points at the top; move what is done into the log below.")}\n:::`),
    columns(`## ${t("Their topics")}\n\n- `, `## ${t("My topics")}\n\n- `),
    ...md(`## ${t("Wins since last time")}\n\n- \n\n## ${t("Blockers")}\n\n- \n\n## ${t("Next steps")}\n\n- [ ] \n\n:::toggle ${t("Feedback (both ways)")}\n- \n:::\n\n:::toggle ${t("Log of earlier conversations")}\n**${today()}** — \n:::`),
  ]);
}

export function projectBriefPage(parentId: number | null): number {
  return make(parentId, t("Project brief"), "🎯", [
    ...md(`:::callout 🎯 blue\n**${t("In one sentence")}:** ${t("what we do, for whom, and why now.")}\n:::`),
    columns(`## ${t("Goal")}\n\n${t("What is different when we are done — measurable.")}`, `## ${t("In scope")}\n\n- `, `## ${t("Out of scope")}\n\n- `),
    ...md(`## ${t("People")}\n\n| ${t("Role")} | ${t("Who")} |\n| --- | --- |\n| ${t("Owner")} |  |\n| ${t("Stakeholders")} |  |\n\n## ${t("Milestones")}\n\n- [ ] ${t("Kick-off")}\n- [ ] ${t("First version")}\n- [ ] ${t("Launch")}\n\n## ${t("Risks")}\n\n| ${t("Risk")} | ${t("Impact")} | ${t("What we do")} |\n| --- | --- | --- |\n|  |  |  |\n\n:::toggle ${t("Open questions")}\n- \n:::`),
  ]);
}

export function weeklyReviewPage(parentId: number | null): number {
  return make(
    parentId,
    t("Weekly review"),
    "🔁",
    [
      ...md(`:::callout 🔁 gray\n${t("Fifteen minutes on Friday: what the week brought, what is left, what changes next week. The figures above are live.")}\n:::`),
      ...widget("workspace.overview"),
      columns(`## ✅ ${t("Done")}\n\n- `, `## ⏳ ${t("Not done — and why")}\n\n- `, `## 🎯 ${t("Next week")}\n\n- [ ] `),
      ...md(`## ${t("One thing to change")}\n\n\n:::toggle ${t("Energy and mood (1–5)")}\n- \n:::`),
    ],
    true,
  );
}

export function wikiHomePage(parentId: number | null): number {
  return make(
    parentId,
    t("Wiki"),
    "📚",
    [
      ...md(`:::callout 👋 blue\n${t("Welcome. Type @ to link a page, a person, a todo or a ticket — and / for any block.")}\n:::`),
      columns(`### 🚀 ${t("Start here")}\n\n- `, `### ⚙️ ${t("Processes")}\n\n- `, `### 🙋 ${t("Who to ask")}\n\n- `),
      columns(`### ⚖️ ${t("Decisions")}\n\n- `, `### 📐 ${t("Conventions")}\n\n- `, `### 🔗 ${t("Links")}\n\n- `),
    ],
    true,
  );
}
