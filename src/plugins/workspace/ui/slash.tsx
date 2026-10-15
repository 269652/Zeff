"use client";

import { Extension, type Editor, type Range } from "@tiptap/react";
import { useT } from "@/components/I18nProvider";
import { PluginKey } from "@tiptap/pm/state";
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
  /** The AI works: `mode` on the text before the caret (or the page), the answer inserted. */
  ai: (mode: "continue" | "summarize" | "actions" | "custom") => void;
  /** Make todos of the page (the AI proposes, you choose). */
  todosFromPage: () => void;
};

export type SlashItem = { key: string; title: string; hint: string; icon: string; group: string; keywords: string[]; run: (c: { editor: Editor; range: Range; ctx: SlashContext }) => void };

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
  {
    key: "callout",
    title: t("Callout"),
    hint: t("Make text stand out"),
    icon: "💡",
    group: t("Basic blocks"),
    keywords: ["callout", "note", "info", "warning", "box"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "callout", attrs: { icon: "💡", tone: "gray" }, content: [{ type: "paragraph" }] }).run(),
  },
  { key: "divider", title: t("Divider"), hint: t("A line between blocks"), icon: "—", group: t("Basic blocks"), keywords: ["divider", "line", "hr", "rule", "---"], run: ({ editor, range }) => chain(editor, range).setHorizontalRule().run() },
  { key: "code", title: t("Code block"), hint: t("Code with highlighting"), icon: "</>", group: t("Basic blocks"), keywords: ["code", "snippet", "```"], run: ({ editor, range }) => chain(editor, range).setCodeBlock().run() },
  { key: "table", title: t("Table"), hint: t("Rows and columns"), icon: "▦", group: t("Basic blocks"), keywords: ["table", "grid"], run: ({ editor, range }) => chain(editor, range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { key: "image", title: t("Image"), hint: t("Upload a picture"), icon: "🖼", group: t("Media"), keywords: ["image", "picture", "photo", "upload", "screenshot"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.pickImage()) },
  { key: "subpage", title: t("Sub-page"), hint: t("A page inside this one"), icon: "📄", group: t("Pages & databases"), keywords: ["page", "subpage", "child", "new page"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.newSubPage()) },
  { key: "database", title: t("Database"), hint: t("A new table, board or calendar here"), icon: "🗂", group: t("Pages & databases"), keywords: ["database", "table", "board", "kanban", "calendar", "gallery", "new"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.newDatabase()) },
  { key: "linked-db", title: t("Linked database"), hint: t("A view of an existing database"), icon: "🔗", group: t("Pages & databases"), keywords: ["linked", "database", "view", "embed"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.linkDatabase()) },
  { key: "mention", title: t("Mention"), hint: t("A person, page, todo or ticket"), icon: "@", group: t("Zeff"), keywords: ["mention", "person", "page", "todo", "ticket", "link", "@"], run: ({ editor, range }) => chain(editor, range).insertContent("@").run() },
  // What Zeff knows about a ticket — of the row whose page it is, or the key given in the block: the modules of a detail view.
  ...(
    [
      ["briefing", t("Briefing"), "🧭", ["lage", "briefing", "status", "attention"]],
      ["todos", t("Todos"), "☑", ["todos", "checklist", "tasks"]],
      ["questions", t("Questions"), "❓", ["questions", "fragen"]],
      ["actions", t("Suggested actions"), "⚡", ["actions", "aktionen", "suggestions"]],
      ["flags", t("Flags"), "⚑", ["flags", "risks", "markierungen"]],
      ["context", t("Context"), "🔗", ["context", "kontext", "sources"]],
      ["chat", t("Chat"), "💬", ["chat", "ask", "frag"]],
    ] as const
  ).map(([module, title, icon, keywords]): SlashItem => ({
    key: `module-${module}`,
    title,
    hint: t("About this row's ticket — or the key you give the block"),
    icon,
    group: t("Zeff"),
    keywords: [...keywords, "ticket", "zeff"],
    run: ({ editor, range }) => chain(editor, range).insertContent({ type: "zeffModule", attrs: { module, key: "" } }).run(),
  })),
  { key: "date", title: t("Today's date"), hint: t("Insert the date"), icon: "📅", group: t("Zeff"), keywords: ["date", "today", "now"], run: ({ editor, range }) => chain(editor, range).insertContent(today()).run() },
  { key: "ai-continue", title: t("Continue writing"), hint: t("The AI goes on from here"), icon: "✨", group: t("AI"), keywords: ["ai", "continue", "write", "go on"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.ai("continue")) },
  { key: "ai-summarize", title: t("Summarize the page"), hint: t("Key points of what's above"), icon: "✨", group: t("AI"), keywords: ["ai", "summarize", "summary", "tldr"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.ai("summarize")) },
  { key: "ai-actions", title: t("Action items"), hint: t("Tasks and decisions from the page"), icon: "✨", group: t("AI"), keywords: ["ai", "action", "tasks", "decisions"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.ai("actions")) },
  { key: "ai-ask", title: t("Ask AI…"), hint: t("Tell it what to write"), icon: "✨", group: t("AI"), keywords: ["ai", "ask", "prompt", "write", "draft"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.ai("custom")) },
  { key: "ai-todos", title: t("Make Zeff todos"), hint: t("The AI finds todos in this page"), icon: "☑️", group: t("AI"), keywords: ["ai", "todos", "tasks", "zeff"], run: ({ editor, range, ctx }) => (chain(editor, range).run(), ctx.todosFromPage()) },
];

function filterItems(all: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
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
        items: ({ query }) => filterItems(slashItems(getContext().t), query),
        command: ({ editor, range, props }) => props.run({ editor, range, ctx: getContext() }),
        render: suggestionRender<SlashItem>(SlashMenu, () => getContext().lang, { hideEmpty: true }),
      }),
    ];
  },
});
