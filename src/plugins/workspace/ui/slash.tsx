"use client";

import { Extension, type Editor, type Range } from "@tiptap/react";
import { useT } from "@/components/I18nProvider";
import { PluginKey } from "@tiptap/pm/state";
import { openNextFormula } from "./inline-formula";
import Suggestion from "@tiptap/suggestion";
import type { Lang, T } from "@/lib/i18n/shared";
import type { MenuProps } from "./popup";
import { suggestionRender } from "./popup";

/** The / menu: blocks, embeds and AI — typed after a slash anywhere in the text. */

export type SlashContext = {
  pageId: number;
  t: T;
  lang: Lang;
  /** An image from the computer (a picker), inserted at the caret. */
  pickImage: () => void;
  /** A page below this one, linked in the text. */
  newSubPage: () => void;
  /** A new database inside this page, as a block. */
  newDatabase: () => void;
  /** An existing database shown as a block (the picker). */
  linkDatabase: () => void;
  /** Any page or database shown in this one, live and editable (the picker). */
  embedPage: () => void;
  /** A new page below this one, shown in it at once. */
  newInlinePage: () => void;
  /** A to-do list of any page shown here, ticked and written in place (the picker). */
  embedTodoList: () => void;
  /** A new todo list (a database with its Todo view) under this page, shown here. */
  newTodoList: () => void;
  /** The AI works: `mode` on the text before the caret (or the page), the answer inserted; "composer": the page's one ✨ field. */
  ai: (mode: "continue" | "summarize" | "actions" | "custom" | "composer") => void;
  /** Make todos of the page (the AI proposes, you choose). */
  todosFromPage: () => void;
  /** The plugins' widgets (read once per page): in the "Widget …" picker — /todo, /versprechen find them too. */
  widgets?: () => { id: string; label: string; icon: string; description: string }[];
};

export type SlashItem = {
  key: string;
  title: string;
  hint: string;
  icon: string;
  group: string;
  keywords: string[];
  /** In the picker "/<under> …" (and found by a search), not in the menu a bare slash opens. */
  under?: string;
  /** A picker: picking it writes "/<opens> " — the menu then lists what is `under` it. */
  opens?: string;
  run: (c: { editor: Editor; range: Range; ctx: SlashContext }) => void;
};

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

/** A picker's item: the slash text becomes "/<word> ", so the same menu lists its items (Backspace goes back). */
const picker = (word: string, item: Omit<SlashItem, "key" | "opens" | "run">): SlashItem => ({
  ...item,
  key: `pick-${word}`,
  opens: word,
  keywords: [word, ...item.keywords],
  run: ({ editor, range }) => editor.chain().focus().insertContentAt(range, `/${word} `).run(),
});

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The detail modules a block can show (/Lage, /Todos …): the key, its title, icon and search words. */
const moduleList = (t: T) =>
  [
    ["briefing", t("Briefing"), "🧭", ["lage", "briefing", "status", "attention"]],
    ["todos", t("Todos"), "☑", ["todos", "checklist", "tasks"]],
    ["questions", t("Questions"), "❓", ["questions", "fragen"]],
    ["actions", t("Suggested actions"), "⚡", ["actions", "aktionen", "suggestions"]],
    ["flags", t("Flags"), "⚑", ["flags", "risks", "markierungen"]],
    ["context", t("Context"), "🔗", ["context", "kontext", "sources"]],
    ["chat", t("Chat"), "💬", ["chat", "ask", "frag"]],
    ["properties", t("Properties"), "📋", ["properties", "eigenschaften", "fields", "felder"]],
    ["subtasks", t("Subtasks"), "⧉", ["subtasks", "unteraufgaben"]],
    ["suggested", t("Suggested actions (AI step)"), "⚡", ["suggested", "vorschläge", "ai"]],
    ["page", t("The row's page"), "📄", ["page", "seite", "text", "content"]],
  ] as const;

/** A module block's name, as the slash menu calls it (the key itself for one it does not know). */
export const moduleTitle = (t: T, module: string): string => moduleList(t).find(([m]) => m === module)?.[1] ?? module.replace(/-/g, " ");

export const slashItems = (t: T): SlashItem[] => [
  { key: "text", title: t("Text"), hint: t("Plain paragraph"), icon: "¶", group: t("Basic blocks"), keywords: ["paragraph", "text", "plain"], run: ({ editor, range }) => chain(editor, range).setParagraph().run() },
  { key: "h1", title: t("Heading 1"), hint: t("Big section heading"), icon: "H1", group: t("Basic blocks"), keywords: ["h1", "heading", "title", "#"], run: ({ editor, range }) => chain(editor, range).setHeading({ level: 1 }).run() },
  { key: "h2", title: t("Heading 2"), hint: t("Medium heading"), icon: "H2", group: t("Basic blocks"), keywords: ["h2", "heading", "##"], run: ({ editor, range }) => chain(editor, range).setHeading({ level: 2 }).run() },
  { key: "h3", title: t("Heading 3"), hint: t("Small heading"), icon: "H3", group: t("Basic blocks"), keywords: ["h3", "heading", "###"], run: ({ editor, range }) => chain(editor, range).setHeading({ level: 3 }).run() },
  { key: "bullet", title: t("Bulleted list"), hint: t("A simple list"), icon: "•", group: t("Basic blocks"), keywords: ["bullet", "list", "ul", "-"], run: ({ editor, range }) => chain(editor, range).toggleBulletList().run() },
  { key: "numbered", title: t("Numbered list"), hint: t("A list with numbers"), icon: "1.", group: t("Basic blocks"), keywords: ["number", "ordered", "list", "ol"], run: ({ editor, range }) => chain(editor, range).toggleOrderedList().run() },
  { key: "todo", title: t("To-do list"), hint: t("Tick things off"), icon: "☑", group: t("Basic blocks"), keywords: ["todo", "task", "check", "checkbox", "[]"], run: ({ editor, range }) => chain(editor, range).toggleTaskList().run() },
  { key: "toggle", title: t("Toggle"), hint: t("Hide content inside"), icon: "▸", group: t("Basic blocks"), keywords: ["toggle", "details", "collapse", "fold"], run: ({ editor, range }) => chain(editor, range).setDetails().run() },
  { key: "quote", title: t("Quote"), hint: t("A quotation"), icon: "❝", group: t("Basic blocks"), keywords: ["quote", "blockquote", ">"], run: ({ editor, range }) => chain(editor, range).toggleBlockquote().run() },
  ...(["row", "col"] as const).map(
    (dir): SlashItem => ({
      key: `flex-${dir}`,
      title: dir === "row" ? t("Flex row") : t("Flex column"),
      hint: dir === "row" ? t("Blocks side by side — nest more boxes in it") : t("Blocks one under the other — nest more boxes in it"),
      icon: dir === "row" ? "↔" : "↕",
      group: t("Layout"),
      keywords: ["flex", "layout", "row", "column", "columns", "spalten", "zeile", "grid", dir],
      run: ({ editor, range }) => chain(editor, range).insertContent(
          // A row of columns (each a collection of blocks of its own), a column of lines.
          dir === "row"
            ? { type: "flexBox", attrs: { dir, gap: "md" }, content: [0, 1].map(() => ({ type: "flexBox", attrs: { dir: "col", gap: "md" }, content: [{ type: "paragraph" }] })) }
            : { type: "flexBox", attrs: { dir, gap: "md" }, content: [{ type: "paragraph" }] },
        ).run(),
    }),
  ),
  {
    key: "callout",
    title: t("Callout"),
    hint: t("Make text stand out"),
    icon: "💡",
    group: t("Basic blocks"),
    keywords: ["callout", "note", "info", "warning", "box"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "callout", attrs: { icon: "💡", tone: "gray" }, content: [{ type: "paragraph" }] }).run(),
  },
  // A formula in the text ({=…}): its value shows where it stands — the caret put where the formula is written.
  ...[
    { key: "formula", title: t("Formula"), hint: t("A value worked out in the text: {=@Kennzahl * 12}"), icon: "=", src: "", keywords: ["formula", "formel", "rechnen", "calc", "=", "berechnen"] },
    { key: "formula-date", title: t("Date from a duration"), hint: t("{=Datum(@Schuldenfrei in)} — the day a duration from today ends"), icon: "📅", src: "Datum(", keywords: ["datum", "date", "formel", "formula", "wann", "when"], under: "formula" },
  ].map(
    ({ src, ...item }): SlashItem => ({
      ...item,
      group: t("Basic blocks"),
      run: ({ editor, range }) => {
        openNextFormula();
        chain(editor, range).insertContent({ type: "inlineFormula", attrs: { src } }).run();
      },
    }),
  ),
  { key: "divider", title: t("Divider"), hint: t("A line between blocks"), icon: "—", group: t("Basic blocks"), keywords: ["divider", "line", "hr", "rule", "---"], run: ({ editor, range }) => chain(editor, range).setHorizontalRule().run() },
  { key: "code", title: t("Code block"), hint: t("Code with highlighting"), icon: "</>", group: t("Basic blocks"), keywords: ["code", "snippet", "```"], run: ({ editor, range }) => chain(editor, range).setCodeBlock().run() },
  { key: "table", title: t("Table"), hint: t("Rows and columns"), icon: "▦", group: t("Basic blocks"), keywords: ["table", "grid"], run: ({ editor, range }) => chain(editor, range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { key: "image", title: t("Image"), hint: t("Upload a picture"), icon: "🖼", group: t("Media"), keywords: ["image", "picture", "photo", "upload", "screenshot"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.pickImage()) },
  { key: "subpage", title: t("Sub-page"), hint: t("A page inside this one"), icon: "📄", group: t("Pages & databases"), keywords: ["page", "subpage", "child", "new page"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.newSubPage()) },
  { key: "database", title: t("Database"), hint: t("A new table, board or calendar here"), icon: "🗂", group: t("Pages & databases"), keywords: ["database", "table", "board", "kanban", "calendar", "gallery", "new"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.newDatabase()) },
  picker("embed", { title: t("Embed …"), hint: t("A linked database, a page, a to-do list or a new inline sub-page — shown right here"), icon: "⧉", group: t("Pages & databases"), keywords: ["einbetten", "linked", "inline"] }),
  { key: "linked-db", under: "embed", title: t("Linked database"), hint: t("A view of an existing database"), icon: "🔗", group: t("Pages & databases"), keywords: ["linked", "database", "view", "embed"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.linkDatabase()) },
  { key: "embed", under: "embed", title: t("Embed page"), hint: t("A page or database shown right here — editable, not just a link"), icon: "⧉", group: t("Pages & databases"), keywords: ["embed", "inline", "page", "subpage", "database", "synced", "einbetten", "seite"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.embedPage()) },
  { key: "todo-embed", under: "embed", title: t("Embed a to-do list"), hint: t("A to-do list of another page, ticked and written right here"), icon: "☑", group: t("Pages & databases"), keywords: ["todo", "to-do", "list", "task", "embed", "aufgaben", "einbetten", "liste"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.embedTodoList()) },
  { key: "todo-db", title: t("Todo list (database)"), hint: t("A database with a Todo view - it can feed the Todo engine"), icon: "✅", group: t("Pages & databases"), keywords: ["todo", "to-do", "list", "task", "database", "aufgaben", "datenbank"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.newTodoList()) },
  { key: "subpage-inline", under: "embed", title: t("Sub-page (inline)"), hint: t("A new page below this one, written right here"), icon: "📑", group: t("Pages & databases"), keywords: ["page", "subpage", "inline", "embed", "new page", "unterseite", "einbetten"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.newInlinePage()) },
  { key: "mention", title: t("Mention"), hint: t("A person, page, todo or ticket"), icon: "@", group: t("Zeff"), keywords: ["mention", "person", "page", "todo", "ticket", "link", "@"], run: ({ editor, range }) => chain(editor, range).insertContent("@").run() },
  { key: "ai", title: t("AI …"), hint: t("What should Zeff do? Think along, write, or ask about this page"), icon: "✨", group: t("Zeff"), keywords: ["ai", "ki", "assist", "think", "write", "ask", "gpt", "claude"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.ai("composer")) },
  { key: "ai-block", under: "ai", title: t("AI block"), hint: t("The AI writes here — from this page and the databases in it"), icon: "✨", group: t("Zeff"), keywords: ["ai", "ki", "write", "summary", "briefing", "lage", "gpt", "claude"], run: ({ editor, range }) => chain(editor, range).insertContent({ type: "aiBlock", attrs: { prompt: "", text: "", at: "", auto: false } }).run() },
  { key: "ai-widget", under: "ai", title: t("Widget (AI-built)"), hint: t("Describe it and the AI builds it — a form that writes into a database, a chart, a calculator, a small app"), icon: "🧩", group: t("Zeff"), keywords: ["widget", "app", "form", "formular", "chart", "calculator", "rechner", "tool", "mini", "ai", "ki", "interactive"], run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffApp", attrs: { title: "", prompt: "", html: "", libs: "", writes: "", ai: false, state: "" } }).run() },
  // What Zeff knows about a ticket — of the row whose page it is, or the key given in the block: the modules of a detail view.
  picker("ticket", { title: t("Ticket …"), hint: t("What Zeff knows about this row's ticket — briefing, todos, questions, chat …"), icon: "🎫", group: t("Zeff"), keywords: ["zeff", "module", "briefing"] }),
  ...moduleList(t).map(([module, title, icon, keywords]): SlashItem => ({
    key: `module-${module}`,
    title,
    hint: t("About this row's ticket — or the key you give the block"),
    icon,
    group: t("Zeff"),
    under: "ticket",
    keywords: [...keywords, "ticket", "zeff"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffModule", attrs: { module, key: "" } }).run(),
  })),
  {
    key: "app-form",
    title: t("Form"),
    hint: t("A new form for a database, or one there is — filled in here, it makes a row (routines on new rows go on from there)"),
    icon: "📝",
    group: t("App blocks"),
    keywords: ["form", "formular", "eingabe", "umfrage", "survey", "input", "submit", "new row", "intake", "wizard"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffForm", attrs: { formId: null } }).run(),
  },
  picker("parts", { title: t("Entry parts …"), hint: t("A field, related rows, a button, or blocks shown only if — what an entry's layout is made of"), icon: "▭", group: t("App blocks"), keywords: ["field", "feld", "button", "related", "condition", "layout"] }),
  {
    key: "app-if",
    under: "parts",
    title: t("Shown only if …"),
    hint: t("Blocks that show only when a field of the entry has a value"),
    icon: "🔍",
    group: t("App blocks"),
    keywords: ["if", "condition", "conditional", "show", "hide", "bedingung", "nur wenn"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffIf", attrs: { field: "", op: "is", value: "" }, content: [{ type: "paragraph" }] }).run(),
  },
  {
    key: "calendar",
    title: t("Calendar (day, week, month)"),
    hint: t("A calendar in the page — a day, a week or a month of one calendar, its proposals among them"),
    icon: "📅",
    group: t("App blocks"),
    keywords: ["calendar", "kalender", "vorschlag", "proposal", "day", "week", "month", "tag", "woche", "monat", "plan"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "calendarEmbed", attrs: { calendarId: 0, view: "week", day: "" } }).run(),
  },
  picker("widget", { title: t("Widget …"), hint: t("What a plugin shows live — unread, dates coming up, workers, news — with its buttons"), icon: "🧩", group: t("App blocks"), keywords: ["dashboard", "live", "plugin"] }),
  {
    key: "widget",
    under: "widget",
    title: t("Choose a widget …"),
    hint: t("What a plugin shows live — unread, dates coming up, workers, news — with its buttons"),
    icon: "🧩",
    group: t("App blocks"),
    keywords: ["widget", "dashboard", "live", "unread", "news", "workers", "routines", "birthdays"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffWidget", attrs: { widget: "", config: "{}" } }).run(),
  },
  {
    key: "routine-controls",
    title: t("Routine controls"),
    hint: t("Run, schedule and permissions of an agent or an automation — for this page"),
    icon: "🤖",
    group: t("App blocks"),
    keywords: ["agent", "automation", "routine", "schedule", "run", "trigger", "workflow", "automatisierung"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffRoutine" }).run(),
  },
  // The parts an app's layout is made of.
  {
    key: "app-field",
    under: "parts",
    title: t("Field"),
    hint: t("One field of the entry, edited in place — pick which"),
    icon: "▭",
    group: t("App blocks"),
    keywords: ["field", "property", "feld", "eigenschaft", "input", "edit"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffField", attrs: { prop: "", label: true } }).run(),
  },
  {
    key: "app-related",
    under: "parts",
    title: t("Related rows"),
    hint: t("The rows of another database that belong to the entry — with a field to add one"),
    icon: "⛓",
    group: t("App blocks"),
    keywords: ["related", "relation", "list", "children", "tickets", "verknüpft", "liste"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffRelated", attrs: { dbId: null, prop: "" } }).run(),
  },
  {
    key: "app-button",
    under: "parts",
    title: t("Button"),
    hint: t("Sets a field of the entry, moves it to the trash, or reads the sources again"),
    icon: "◉",
    group: t("App blocks"),
    keywords: ["button", "action", "knopf", "aktion", "done", "erledigt"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffButton", attrs: { label: "", action: "set", prop: "", value: "" } }).run(),
  },
  // The detail view's blocks: tabs to put the rest in, what happened to the entry, everything that belongs to it.
  {
    key: "tabs",
    title: t("Tabs"),
    hint: t("Sections of a page, one shown at a time — rename them with a double click"),
    icon: "🗂",
    group: t("Entry"),
    keywords: ["tabs", "tab", "sections", "reiter", "abschnitte", "register"],
    run: ({ editor, range }) =>
      chain(editor, range)
        .insertContent({
          type: "zeffTabs",
          attrs: { active: 0 },
          content: [
            { type: "zeffTab", attrs: { title: t("Overview") }, content: [{ type: "paragraph" }] },
            { type: "zeffTab", attrs: { title: t("Details") }, content: [{ type: "paragraph" }] },
          ],
        })
        .run(),
  },
  {
    key: "activity",
    title: t("Activity"),
    hint: t("What happened to this entry — who changed what (you, the AI, a source)"),
    icon: "🕑",
    group: t("Entry"),
    keywords: ["activity", "history", "log", "verlauf", "aktivität", "changes", "änderungen"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffActivity", attrs: { limit: 12 } }).run(),
  },
  {
    key: "belongs",
    title: t("Everything that belongs"),
    hint: t("Linked pages, related rows, todos, tickets and pages about the same — gathered for this entry"),
    icon: "🧲",
    group: t("Entry"),
    keywords: ["belongs", "related", "links", "backlinks", "everything", "dazugehört", "verknüpft", "zusammenhang"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffBelongs" }).run(),
  },
  {
    key: "timeline",
    title: t("Timeline"),
    hint: t("What happened with this entry — mails, messages, ticket changes, todos, time — by day (or someone else's: a name or ref)"),
    icon: "🕰️",
    group: t("Entry"),
    keywords: ["timeline", "zeitleiste", "verlauf", "history", "events", "ereignisse", "what happened", "chronik"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffTimeline", attrs: { ref: "", limit: 20 } }).run(),
  },
  // The custom view a plugin brings for the rows of this database (a person's page) — one block; it starts a person's page by itself.
  {
    key: "row-view",
    title: t("Custom view of this entry"),
    hint: t("What a plugin shows for the rows of this database — a person's page"),
    icon: "👤",
    group: t("People"),
    keywords: ["person", "people", "profile", "view", "ansicht", "custom"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "rowView" }).run(),
  },
  { key: "date", title: t("Today's date"), hint: t("Insert the date"), icon: "📅", group: t("Zeff"), keywords: ["date", "today", "now"], run: ({ editor, range }) => chain(editor, range).insertContent(today()).run() },
  { key: "ai-continue", under: "ai", title: t("Continue writing"), hint: t("The AI goes on from here"), icon: "✨", group: t("AI"), keywords: ["ai", "continue", "write", "go on"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.ai("continue")) },
  { key: "ai-summarize", under: "ai", title: t("Summarize the page"), hint: t("Key points of what's above"), icon: "✨", group: t("AI"), keywords: ["ai", "summarize", "summary", "tldr"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.ai("summarize")) },
  { key: "ai-actions", under: "ai", title: t("Action items"), hint: t("Tasks and decisions from the page"), icon: "✨", group: t("AI"), keywords: ["ai", "action", "tasks", "decisions"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.ai("actions")) },
  { key: "ai-ask", under: "ai", title: t("Ask AI…"), hint: t("Tell it what to write"), icon: "✨", group: t("AI"), keywords: ["ai", "ask", "prompt", "write", "draft"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.ai("custom")) },
  { key: "ai-todos", under: "ai", title: t("Make Zeff todos"), hint: t("The AI finds todos in this page"), icon: "☑️", group: t("AI"), keywords: ["ai", "todos", "tasks", "zeff"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.todosFromPage()) },
];

/** Each widget a plugin brings, in the "Widget …" picker (its name and what it shows are what a search finds it by). */
function widgetItems(ctx: SlashContext): SlashItem[] {
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  return (ctx.widgets?.() ?? []).map((w) => ({
    key: `widget:${w.id}`,
    title: w.label,
    hint: w.description,
    icon: w.icon || "🧩",
    group: ctx.t("Widgets"),
    under: "widget",
    keywords: ["widget", ...w.id.split(/[._-]/), ...words(w.label), ...words(w.description)],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffWidget", attrs: { widget: w.id, config: "{}" } }).run(),
  }));
}

/**
 * What the menu lists for `query`: a bare slash the main items (not what is in a picker); "/ticket " (a picker's word and a space) what
 * is in that picker; anything else every item that matches — the ones in pickers too ("/todos" finds the widget).
 */
export function filterItems(all: SlashItem[], query: string): SlashItem[] {
  const raw = query.toLowerCase().trimStart();
  const pick = all.find((i) => i.opens && raw.startsWith(`${i.opens} `));
  if (pick) return rank(all.filter((i) => i.under === pick.opens), raw.slice(pick.opens!.length + 1).trim());
  const q = raw.trim();
  return q ? rank(all, q) : all.filter((i) => !i.under);
}

function rank(all: SlashItem[], q: string): SlashItem[] {
  if (!q) return all;
  const score = (i: SlashItem) => (i.title.toLowerCase().startsWith(q) ? 0 : i.keywords.some((k) => k.startsWith(q)) ? 1 : i.title.toLowerCase().includes(q) || i.keywords.some((k) => k.includes(q)) ? 2 : 9);
  return all.map((i) => [i, score(i)] as const).filter(([, s]) => s < 9).sort((a, b) => a[1] - b[1]).map(([i]) => i);
}

export function SlashMenu({ items, selected, onPick, onHover }: MenuProps<SlashItem>) {
  const t = useT();
  if (!items.length) return <div className="px-2 py-1.5 text-zinc-500">{t("No results")}</div>;
  return (
    <>
      {items.map((it, i) => {
        const head = it.group !== items[i - 1]?.group ? it.group : null;
        return (
          <div key={it.key}>
            {head && <div className="ws-pop-head">{head}</div>}
            <button type="button" role="option" aria-selected={i === selected} onClick={() => onPick(i)} onMouseEnter={() => onHover(i)} ref={(el) => {
                if (i === selected) el?.scrollIntoView({ block: "nearest" });
              }}>
              <span className="ws-pop-icon">{it.icon}</span>
              <span className="min-w-0">
                <span className="block">{it.title}</span>
                <span className="block truncate text-xs text-zinc-500">{it.hint}</span>
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
}

/** The slash command as an editor extension; `getContext` brings what the items need from the page. */
export const SlashCommand = Extension.create<{ getContext: () => SlashContext }>({
  name: "slashCommand",
  addOptions() {
    return { getContext: () => ({}) as SlashContext };
  },
  addProseMirrorPlugins() {
    const getContext = this.options.getContext;
    return [
      Suggestion<SlashItem, SlashItem>({
        pluginKey: new PluginKey("slashSuggestion"),
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allowSpaces: true,
        allowedPrefixes: [" ", "\n"],
        items: ({ query }) => filterItems([...slashItems(getContext().t), ...widgetItems(getContext())], query),
        command: ({ editor, range, props }) => props.run({ editor, range, ctx: getContext() }),
        render: suggestionRender<SlashItem>(SlashMenu, () => getContext().lang, { hideEmpty: true }),
      }),
    ];
  },
});
