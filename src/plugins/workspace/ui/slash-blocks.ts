import type { Editor, JSONContent, Range } from "@tiptap/react";
import type { T } from "@/lib/i18n/shared";
import { LIBRARY } from "../block-library";
import { markdownToDoc } from "../doc";
import { PIPE_EXAMPLES } from "../table-pipe";
import { exampleContent } from "./pipe-nodes";
import type { SlashItem } from "./slash";

/**
 * More blocks for the "/" menu: callouts in every colour, columns, and — under "/blocks" — the ready-made widgets of the block
 * library (calculator, timers, trackers, plotter …) and page snippets (meeting notes, pros & cons, a decision record …). Each is put
 * into the page as it is and is yours to change.
 */

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

const callout = (t: T, key: string, icon: string, tone: string, title: string, hint: string, words: string[]): SlashItem => ({
  key: `callout-${key}`,
  title: t(title),
  hint: t(hint),
  icon,
  group: t("Basic blocks"),
  keywords: ["callout", "box", ...words],
  run: ({ editor, range }) => chain(editor, range).insertContent({ type: "callout", attrs: { icon, tone }, content: [{ type: "paragraph" }] }).run(),
});

const columns = (t: T, n: 2 | 3 | 4): SlashItem => ({
  key: `columns-${n}`,
  title: t(`${n} columns`),
  hint: t("Blocks side by side"),
  icon: "▥",
  group: t("Layout"),
  keywords: ["columns", "spalten", "layout", String(n), `${n}-columns`],
  run: ({ editor, range }) =>
    chain(editor, range)
      .insertContent({ type: "flexBox", attrs: { dir: "row", gap: "md" }, content: Array.from({ length: n }, () => ({ type: "flexBox", attrs: { dir: "col", gap: "md" }, content: [{ type: "paragraph" }] })) })
      .run(),
});

/** A page snippet: a heading and the sections under it, each a heading and an empty bullet. */
const snippet = (t: T, key: string, icon: string, title: string, hint: string, sections: string[], words: string[]): SlashItem => ({
  key: `snippet-${key}`,
  under: "blocks",
  title: t(title),
  hint: t(hint),
  icon,
  group: t("Page snippets"),
  keywords: ["snippet", "template", "vorlage", ...words],
  run: ({ editor, range }) => {
    const md = [`## ${t(title)}`, "", ...sections.flatMap((s) => [`### ${t(s)}`, "", "- ", ""])].join("\n");
    chain(editor, range).insertContent(markdownToDoc(md).content as JSONContent[]).run();
  },
});

const widget = (t: T, b: (typeof LIBRARY)[number]): SlashItem => ({
  key: `lib:${b.name}`,
  under: "blocks",
  title: t(b.title ?? b.name),
  hint: t(b.description),
  icon: b.icon || "🧩",
  group: t("Tools"),
  keywords: ["widget", "tool", "block", ...(b.title ?? "").toLowerCase().split(/\W+/), ...b.name.split(/[.-]/)],
  run: ({ editor, range }) =>
    chain(editor, range)
      .insertContent({ type: "zeffApp", attrs: { title: t(b.title ?? b.name), prompt: "", html: b.widget?.html ?? "", libs: (b.widget?.libs ?? []).join(","), writes: "", ai: false, flows: "", wid: "", state: "" } })
      .run(),
});

/** A ready-made table → transform → table (the example's data, its steps, its result). */
const EXAMPLE_TEXT = (t: T): Record<string, { title: string; hint: string }> => ({
  budget: { title: t("Household budget"), hint: t("Spending by category, biggest first") },
  favourites: { title: t("Books: my favourites"), hint: t("Only the good ones, newest first") },
  recipe: { title: t("Recipe for more people"), hint: t("Amounts times a factor") },
  tidy: { title: t("Tidy up a list"), hint: t("Doubles out, sorted") },
});

const pipeExample = (t: T, e: (typeof PIPE_EXAMPLES)[number]): SlashItem => ({
  key: `pipe-example:${e.key}`,
  under: "blocks",
  title: EXAMPLE_TEXT(t)[e.key].title,
  hint: EXAMPLE_TEXT(t)[e.key].hint,
  icon: e.icon,
  group: t("Tables that transform"),
  keywords: ["table", "tabelle", "transform", "pipeline", "example", "beispiel", ...e.title.toLowerCase().split(/\W+/)],
  run: ({ editor, range }) => chain(editor, range).insertContent(exampleContent(EXAMPLE_TEXT(t)[e.key].title, e)).run(),
});

/** A code cell of a language (Notebook): "/code", "/python", "/node", "/rust". */
const codeCell = (t: T, id: string, label: string, words: string[]): SlashItem => ({
  key: `code-${id}`,
  title: `${t("Code")}: ${label}`,
  hint: t("A cell you can run — its variables stay for the next one"),
  icon: "⌨️",
  group: t("Notebook"),
  keywords: ["code", "notebook", "jupyter", "run", "cell", "zelle", ...words],
  run: ({ editor, range }) => chain(editor, range).insertContent([{ type: "codeCell", attrs: { language: id, source: "", outputs: "", count: 0 } }, { type: "paragraph" }]).run(),
});

export const blockSlashItems = (t: T): SlashItem[] => [
  codeCell(t, "python", "Python", ["python", "py"]),
  codeCell(t, "node", "Node.js", ["node", "javascript", "js"]),
  codeCell(t, "rust", "Rust", ["rust", "rs"]),
  {
    key: "table-pipe",
    title: t("Transform"),
    hint: t("Takes a table, filters / sorts / totals it — the result is a table"),
    icon: "🔀",
    group: t("Tables that transform"),
    keywords: ["transform", "umwandeln", "pipeline", "pipe", "filter", "sort", "group", "tabelle", "table"],
    run: ({ editor, range }) => chain(editor, range).insertContent([{ type: "tablePipe", attrs: { name: "", from: "", steps: "" } }, { type: "paragraph" }]).run(),
  },
  {
    key: "pipe-result",
    title: t("Result table"),
    hint: t("Shows the result of a transform (or a database) as a table, wherever you put it"),
    icon: "📋",
    group: t("Tables that transform"),
    keywords: ["result", "ergebnis", "output", "ausgabe", "tabelle", "table", "pipeline"],
    run: ({ editor, range }) => chain(editor, range).insertContent([{ type: "pipeResult", attrs: { of: "@above", title: "" } }, { type: "paragraph" }]).run(),
  },
  callout(t, "info", "ℹ️", "blue", "Info box", "A blue note", ["info", "note", "hint"]),
  callout(t, "success", "✅", "green", "Success box", "A green note — it worked", ["success", "done", "ok", "green"]),
  callout(t, "warning", "⚠️", "yellow", "Warning box", "A yellow note — careful", ["warning", "caution", "yellow"]),
  callout(t, "danger", "❗", "red", "Danger box", "A red note — important", ["danger", "error", "important", "red"]),
  callout(t, "tip", "💡", "gray", "Tip box", "A grey tip", ["tip", "idea"]),
  columns(t, 2),
  columns(t, 3),
  columns(t, 4),
  {
    key: "pick-blocks",
    opens: "blocks",
    title: t("Ready-made blocks …"),
    hint: t("Calculators, timers, trackers, plotter and page snippets — put in and change"),
    icon: "🧱",
    group: t("Blocks"),
    keywords: ["blocks", "bibliothek", "library", "tools", "widgets", "snippets", "templates"],
    run: ({ editor, range }) => editor.chain().focus().insertContentAt(range, "/blocks ").run(),
  },
  ...LIBRARY.filter((b) => b.widget).map((b) => widget(t, b)),
  ...PIPE_EXAMPLES.map((e) => pipeExample(t, e)),
  snippet(t, "meeting", "📝", "Meeting notes", "Attendees, agenda, decisions, action items", ["Attendees", "Agenda", "Decisions", "Action items"], ["meeting", "protokoll"]),
  snippet(t, "proscons", "⚖️", "Pros and cons", "Weigh a choice", ["Pros", "Cons", "Verdict"], ["pros", "cons", "decision"]),
  snippet(t, "decision", "🧭", "Decision record", "Context, options and the outcome", ["Context", "Options", "Decision", "Consequences"], ["decision", "adr", "entscheidung"]),
  snippet(t, "weekly", "📅", "Weekly review", "What went well, what didn't, next week", ["What went well", "What didn't go well", "Next week"], ["weekly", "review", "woche"]),
  snippet(t, "daily", "🌅", "Daily plan", "Top three, schedule, notes", ["Top 3", "Schedule", "Notes"], ["daily", "plan", "today", "tag"]),
  snippet(t, "brief", "📌", "Project brief", "Goal, scope, milestones, risks", ["Goal", "Scope", "Milestones", "Risks"], ["project", "brief", "projekt"]),
  snippet(t, "retro", "🔁", "Retrospective", "Start, stop, continue", ["Start", "Stop", "Continue"], ["retro", "retrospective"]),
  snippet(t, "reading", "📖", "Reading notes", "Key ideas, quotes, what I take away", ["Key ideas", "Quotes", "What I take away"], ["reading", "book", "notes", "buch"]),
];
