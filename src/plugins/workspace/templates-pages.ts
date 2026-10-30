import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/server";
import { markdownToDoc, type DocNode } from "./doc";
import { createRoutine } from "./routines";
import { createPage, updatePage } from "./store";
import { widgetCatalog } from "./widgets";

/**
 * The page templates' content: modern pages, not bare headings — a callout that says what the page is for, columns where things sit side
 * by side, to-do lists for what follows, toggles for what is looked up now and then, and live widgets where the page is about your work
 * (the weekly review shows the week's figures). Every list starts with a line that says what goes there — no empty placeholders. In
 * your language. Server only.
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
/** Blocks side by side, each column its blocks (empty columns left out — a widget of a plugin not installed). */
const row = (...cols: DocNode[][]): DocNode[] => {
  const content = cols.filter((c) => c.length).map((c): DocNode => ({ type: "flexBox", attrs: { dir: "col", gap: "md", span: null }, content: c }));
  return content.length ? [{ type: "flexBox", attrs: { dir: "row", gap: "lg" }, content }] : [];
};
const widget = (id: string, config: Record<string, unknown> = {}): DocNode[] => (widgetCatalog().some((w) => w.id === id) ? [{ type: "zeffWidget", attrs: { widget: id, config: JSON.stringify(config), title: "" } }] : []);
const today = () => formatDate(new Date(), { year: true });

function make(parentId: number | null, title: string, icon: string, content: DocNode[], wide = false): number {
  const id = createPage({ parentId, title, icon, content: { type: "doc", content: [...content, { type: "paragraph" }] } });
  if (wide) updatePage(id, { fullWidth: true });
  return id;
}

/** Meeting notes — and, folded below, what a recurring 1:1 adds (the topics of both, wins, blockers, feedback, the log). */
export function meetingPage(parentId: number | null): number {
  return make(parentId, t("Meeting"), "🗓️", [
    ...md(`:::callout 🗓️ blue\n**${t("Date")}:** ${today()} · **${t("Attendees")}:** ${t("type @ to add people")}\n\n${t("Goal of the meeting, in one sentence.")}\n:::`),
    // Before it: who you meet, when you last met, what is open between you.
    ...widget("people.briefs", { limit: 4 }),
    columns(
      `## ${t("Agenda")}\n\n1. ${t("Where we stand — five minutes")}\n2. ${t("What needs a decision today")}\n3. ${t("Next steps and who takes them")}`,
      [2, `## ${t("Notes")}\n\n- ${t("What was said, in short — type @ for people and pages")}`],
    ),
    ...md(
      `## ${t("Decisions")}\n\n:::callout ✅ green\n- ${t("What was decided — and why, in one line")}\n:::\n\n## ${t("Action items")}\n\n- [ ] ${t("Who does what — by when")}\n\n:::toggle ${t("Parking lot — for another time")}\n- ${t("What came up but belongs to another meeting")}\n:::`,
    ),
    // A 1:1 is a meeting that repeats: what it adds, folded (open it when that is what this one is).
    ...md(
      `:::toggle ${t("1:1 — a conversation that repeats")}\n${t("Keep the open points at the top; move what is done into the log.")}\n\n- **${t("Their topics")}:** ${t("what they want to talk about")}\n- **${t("My topics")}:** ${t("what I want to bring up")}\n- **${t("Wins since last time")}:** ${t("what went well — say it")}\n- **${t("Blockers")}:** ${t("what is in the way, and who can help")}\n- **${t("Feedback (both ways)")}:** ${t("one thing to keep, one to change")}\n\n**${today()}** — ${t("the log: a line per conversation")}\n:::`,
    ),
  ]);
}

export function weeklyReviewPage(parentId: number | null): number {
  const id = make(
    parentId,
    t("Weekly review"),
    "🔁",
    [
      ...md(`:::callout 🔁 gray\n${t("Fifteen minutes on Friday: what the week brought, what is left, what changes next week. The figures above are live.")}\n:::`),
      ...widget("workspace.overview"),
      ...row(widget("todos.done", { since: "week", limit: 10 }), [...md(`## ⏳ ${t("Not done — and why")}\n\n- ${t("What slipped, and the one reason")}`), ...md(`## 🎯 ${t("Next week")}\n\n- [ ] ${t("The one thing that has to happen")}`)]),
      ...row(widget("calendar.agenda"), widget("people.upcoming", { days: 10, limit: 5 })),
      ...md(`## ${t("One thing to change")}\n\n${t("What I do differently next week — one sentence.")}\n\n:::toggle ${t("Energy and mood (1–5)")}\n- ${t("How the week felt — and what made the difference")}\n:::`),
    ],
    true,
  );
  weeklyDraftAgent(id);
  return id;
}

/**
 * The weekly review writes itself: an agent under it that drafts the week every Friday at three (what got done, the
 * appointments, the hours booked, what is left and why, what to do next week) as a sub page — you read it and correct it.
 * Switched on; it can be switched off on its page.
 */
function weeklyDraftAgent(parentId: number): number {
  const intro = [
    t("Write a draft of this week's review as a new sub page of the page above you (the weekly review), titled with the week (“Week 43”). Short, in bullet points, linking todos and pages with @."),
    "",
    `- ${t("What got done this week (list_todos: the ones done since Monday) — grouped by topic.")}`,
    `- ${t("The appointments of the week and what came of them.")}`,
    `- ${t("The hours booked (get_weekly_report), if there is time tracking.")}`,
    `- ${t("What is still open and why — the overdue first.")}`,
    `- ${t("Three suggestions for next week.")}`,
    "",
  ].join("\n");
  const id = createPage({ parentId, title: t("Write the weekly review"), icon: "✍️", content: { type: "doc", content: [{ type: "zeffRoutine" }, ...md(intro)] } });
  createRoutine(id, "agent", { enabled: true, triggers: [{ kind: "manual" }, { kind: "schedule", at: "15:00", days: [5] }], permissions: { scope: "parent" } });
  return id;
}
