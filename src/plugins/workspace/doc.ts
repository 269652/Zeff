/**
 * A page's content (the Workspace plugin): a ProseMirror document as the editor (Tiptap) keeps it, as
 * JSON. Here is what the server does with it without an editor: the plain text (search), Markdown both
 * ways (export, agents writing pages), the references in it (people, pages, todos, tickets — for
 * backlinks), and a whitelist that cleans what a client sends. Client-safe.
 */

import { COLORS, PERSON_MODULES } from "./model";

export type Mark = { type: string; attrs?: Record<string, unknown> };
export type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; marks?: Mark[]; text?: string };
export type Doc = { type: "doc"; content: DocNode[] };

export const emptyDoc = (): Doc => ({ type: "doc", content: [{ type: "paragraph" }] });

export type RefKind = "person" | "page" | "todo" | "ticket";
export type DocRef = { kind: RefKind; ref: string; label: string };

// ---------------------------------------------------------------------------
// Plain text and references
// ---------------------------------------------------------------------------

const BLOCKS = new Set(["paragraph", "heading", "listItem", "taskItem", "blockquote", "codeBlock", "tableRow", "detailsSummary", "callout", "horizontalRule"]);

/** The text of a document, a block per line — for search and for the AI. */
export function docText(doc: DocNode | null | undefined): string {
  const out: string[] = [];
  let line = "";
  const flush = () => {
    if (line.trim()) out.push(line.trim());
    line = "";
  };
  const walk = (n: DocNode) => {
    if (n.type === "text") line += n.text ?? "";
    else if (n.type === "hardBreak") line += " ";
    else if (n.type === "zeffRef") line += String(n.attrs?.label ?? "");
    else if (n.type === "tableCell" || n.type === "tableHeader") {
      (n.content ?? []).forEach(walk);
      line += " ";
    } else {
      if (BLOCKS.has(n.type)) flush();
      (n.content ?? []).forEach(walk);
      if (BLOCKS.has(n.type)) flush();
    }
  };
  if (doc) walk(doc);
  flush();
  return out.join("\n");
}

/** The people, pages, todos and tickets a document names — each once, in the order they come. */
export function docRefs(doc: DocNode | null | undefined): DocRef[] {
  const seen = new Map<string, DocRef>();
  const add = (kind: RefKind, ref: string, label: string) => {
    if (ref && !seen.has(`${kind}:${ref}`)) seen.set(`${kind}:${ref}`, { kind, ref, label });
  };
  const walk = (n: DocNode) => {
    if (n.type === "zeffRef") {
      const kind = String(n.attrs?.kind ?? "");
      if (kind === "person" || kind === "page" || kind === "todo" || kind === "ticket") add(kind, String(n.attrs?.ref ?? ""), String(n.attrs?.label ?? ""));
    }
    for (const m of n.marks ?? []) {
      const href = m.type === "link" ? String(m.attrs?.href ?? "") : "";
      const page = /^\/workspace\/(\d+)(?:[/?#]|$)/.exec(href);
      if (page) add("page", page[1], n.text ?? "");
    }
    (n.content ?? []).forEach(walk);
  };
  if (doc) walk(doc);
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Markdown out
// ---------------------------------------------------------------------------

const ESC = /([\\`*_[\]<>])/g;

function inline(nodes: DocNode[] | undefined): string {
  let out = "";
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") {
      out += "  \n";
      continue;
    }
    if (n.type === "zeffRef") {
      const label = String(n.attrs?.label ?? "");
      const kind = String(n.attrs?.kind ?? "");
      const ref = String(n.attrs?.ref ?? "");
      // A mention as the reference it is ([[page:12|Label]]), so writing the text back keeps it a mention.
      if ((kind === "page" || kind === "todo" || kind === "ticket" || kind === "person") && ref) out += `[[${kind}:${ref}${label ? `|${label.replace(/[\]|]/g, "")}` : ""}]]`;
      else out += label;
      continue;
    }
    if (n.type === "image") {
      out += `![${String(n.attrs?.alt ?? "")}](${String(n.attrs?.src ?? "")})`;
      continue;
    }
    let t = n.text ?? "";
    const marks = n.marks ?? [];
    const code = marks.some((m) => m.type === "code");
    if (!code) t = t.replace(ESC, "\\$1");
    for (const m of marks) {
      if (m.type === "code") t = `\`${t}\``;
      else if (m.type === "bold") t = `**${t}**`;
      else if (m.type === "italic") t = `*${t}*`;
      else if (m.type === "strike") t = `~~${t}~~`;
      else if (m.type === "underline") t = `<u>${t}</u>`;
      else if (m.type === "highlight") t = `==${t}==`;
      else if (m.type === "link") t = `[${t}](${String(m.attrs?.href ?? "")})`;
    }
    out += t;
  }
  return out;
}

const indentLines = (s: string, pad: string) => s.split("\n").map((l) => (l ? pad + l : l)).join("\n");

function block(n: DocNode, ctx: { ordered?: number } = {}): string {
  const kids = n.content ?? [];
  const blocks = (list: DocNode[]) => list.map((c) => block(c)).filter((s) => s !== "").join("\n\n");
  switch (n.type) {
    case "paragraph":
      return inline(kids);
    case "heading":
      return `${"#".repeat(Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1))))} ${inline(kids)}`;
    case "bulletList":
      return kids.map((li) => block(li, {})).join("\n");
    case "orderedList":
      return kids.map((li, i) => block(li, { ordered: Number(n.attrs?.start ?? 1) + i })).join("\n");
    case "taskList":
      return kids.map((li) => block(li, {})).join("\n");
    case "listItem":
    case "taskItem": {
      const mark = n.type === "taskItem" ? (n.attrs?.checked ? "- [x] " : "- [ ] ") : ctx.ordered ? `${ctx.ordered}. ` : "- ";
      const parts = kids.map((c) => (c.type === "bulletList" || c.type === "orderedList" || c.type === "taskList" ? indentLines(block(c), "  ") : block(c)));
      const [first = "", ...rest] = parts;
      return `${mark}${first}${rest.length ? `\n${rest.map((r) => (/^\s*(-|\d+\.) /.test(r) ? r : indentLines(r, "  "))).join("\n")}` : ""}`;
    }
    case "blockquote":
      return blocks(kids).split("\n").map((l) => `> ${l}`.trimEnd()).join("\n");
    case "callout":
      return `:::callout ${String(n.attrs?.icon ?? "💡")} ${String(n.attrs?.tone ?? "gray")}\n${blocks(kids)}\n:::`;
    case "codeBlock":
      return `\`\`\`${String(n.attrs?.language ?? "")}\n${kids.map((c) => c.text ?? "").join("")}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "image":
      return `![${String(n.attrs?.alt ?? "")}](${String(n.attrs?.src ?? "")})`;
    case "details": {
      const summary = kids.find((c) => c.type === "detailsSummary");
      const body = kids.find((c) => c.type === "detailsContent");
      return `:::toggle ${inline(summary?.content)}\n${blocks(body?.content ?? [])}\n:::`;
    }
    case "table": {
      const rows = kids.map((r) => (r.content ?? []).map((c) => blocks(c.content ?? []).replace(/\n+/g, " ").replace(/\|/g, "\\|")));
      if (!rows.length) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return [line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
    }
    case "aiBlock":
      return `:::ai ${n.attrs?.auto ? "auto " : ""}${String(n.attrs?.prompt ?? "").replace(/\n/g, " ")}\n${String(n.attrs?.text ?? "")}\n:::`;
    case "zeffModule":
      return `:::zeff ${String(n.attrs?.module ?? "")}${n.attrs?.key ? ` ${String(n.attrs.key)}` : ""}`;
    case "databaseView":
      return `:::database ${String(n.attrs?.dbId ?? "")}${n.attrs?.title ? ` ${String(n.attrs.title)}` : ""}`;
    case "pageEmbed":
      return `:::page ${String(n.attrs?.pageId ?? "")}${n.attrs?.title ? ` ${String(n.attrs.title)}` : ""}`;
    case "doc":
      return blocks(kids);
    default:
      return kids.length ? blocks(kids) : inline([n]);
  }
}

/** A document as Markdown. */
export function docToMarkdown(doc: DocNode | null | undefined): string {
  return doc ? `${block(doc).trim()}\n` : "";
}

// ---------------------------------------------------------------------------
// Markdown in (for what an agent writes — the editor itself parses pasted Markdown)
// ---------------------------------------------------------------------------

function parseInline(src: string): DocNode[] {
  const out: DocNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(==[^=]+==)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[\[(?:page|todo|ticket|person):[^\]|]+(?:\|[^\]]*)?\]\])|(!?\[[^\]]*\]\([^)\s]+\))/g;
  let at = 0;
  const text = (t: string, marks: Mark[] = []) => {
    if (t) out.push(marks.length ? { type: "text", text: t.replace(/\\([\\`*_[\]<>])/g, "$1"), marks } : { type: "text", text: t.replace(/\\([\\`*_[\]<>])/g, "$1") });
  };
  for (const m of src.matchAll(re)) {
    const i = m.index ?? 0;
    text(src.slice(at, i));
    const s = m[0];
    if (s.startsWith("`")) text(s.slice(1, -1), [{ type: "code" }]);
    else if (s.startsWith("**")) text(s.slice(2, -2), [{ type: "bold" }]);
    else if (s.startsWith("~~")) text(s.slice(2, -2), [{ type: "strike" }]);
    else if (s.startsWith("==")) text(s.slice(2, -2), [{ type: "highlight" }]);
    else if (s.startsWith("*") || s.startsWith("_")) text(s.slice(1, -1), [{ type: "italic" }]);
    else if (s.startsWith("[[")) {
      const r = /^\[\[(page|todo|ticket|person):([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(s)!;
      const ref = r[2].trim();
      out.push({ type: "zeffRef", attrs: { kind: r[1], ref, label: (r[3] ?? "").trim() || (r[1] === "todo" ? `T-${ref}` : ref), href: r[1] === "page" ? `/workspace/${ref}` : "" } });
    } else {
      const l = /^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/.exec(s)!;
      if (l[1]) out.push({ type: "image", attrs: { src: l[3], alt: l[2] } });
      else text(l[2], [{ type: "link", attrs: { href: l[3] } }]);
    }
    at = i + s.length;
  }
  text(src.slice(at));
  return out;
}

const para = (s: string): DocNode => ({ type: "paragraph", content: parseInline(s) });

/** Markdown as a document: headings, lists (nested), task lists, quotes, code fences, rules, tables, paragraphs, inline marks. */
export function markdownToDoc(md: string): Doc {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  const parseBlocks = (stop: (l: string) => boolean = () => false): DocNode[] => {
    const out: DocNode[] = [];
    while (i < lines.length && !stop(lines[i])) {
      const l = lines[i];
      if (!l.trim()) {
        i++;
        continue;
      }
      const fence = /^```(\S*)\s*$/.exec(l);
      if (fence) {
        const code: string[] = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push({ type: "codeBlock", attrs: { language: fence[1] || null }, content: code.length ? [{ type: "text", text: code.join("\n") }] : undefined });
        continue;
      }
      const h = /^(#{1,6})\s+(.*)$/.exec(l);
      if (h) {
        out.push({ type: "heading", attrs: { level: Math.min(3, h[1].length) }, content: parseInline(h[2].trim()) });
        i++;
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
        out.push({ type: "horizontalRule" });
        i++;
        continue;
      }
      // :::ai [auto] instruction / its text / :::  - an AI block: what the AI wrote by the instruction, from the page
      const ai = /^:::ai\s+(auto\s+)?(.*)$/.exec(l);
      if (ai) {
        const text: string[] = [];
        i++;
        while (i < lines.length && lines[i].trim() !== ":::") text.push(lines[i++]);
        i++;
        out.push({ type: "aiBlock", attrs: { prompt: ai[2].trim(), text: text.join("\n").trim(), at: "", auto: !!ai[1] } });
        continue;
      }
      // :::zeff briefing [KEY]  - what Zeff knows about a ticket (its row's, or the key's), as a block
      const zm = /^:::zeff\s+([a-z]+)\s*([A-Za-z][A-Za-z0-9]*-\d+)?\s*$/.exec(l);
      if (zm && (BLOCK_MODULES as readonly string[]).includes(zm[1])) {
        out.push({ type: "zeffModule", attrs: { module: zm[1], key: (zm[2] ?? "").toUpperCase() } });
        i++;
        continue;
      }
      // :::page 12 [title]  - another page shown in this one (an inline page)
      const pg = /^:::page\s+(\d+)\s*(.*)$/.exec(l);
      if (pg) {
        out.push({ type: "pageEmbed", attrs: { pageId: Number(pg[1]), title: pg[2].trim() } });
        i++;
        continue;
      }
      // :::database 12 [title]  - a database shown in the page
      const db = /^:::database\s+(\d+)\s*(.*)$/.exec(l);
      if (db) {
        out.push({ type: "databaseView", attrs: { dbId: Number(db[1]), viewId: "", title: db[2].trim() } });
        i++;
        continue;
      }
      // :::callout 💡 blue ... :::   and   :::toggle Summary ... :::   (nested blocks inside; they may nest)
      const dir = /^:::(callout|toggle)\s*(.*)$/.exec(l);
      if (dir) {
        const inner: string[] = [];
        let depth = 1;
        i++;
        while (i < lines.length) {
          if (/^:::(callout|toggle)\b/.test(lines[i])) depth++;
          else if (/^:::\s*$/.test(lines[i]) && --depth === 0) break;
          inner.push(lines[i++]);
        }
        i++;
        const kids = markdownToDoc(inner.join("\n")).content;
        if (dir[1] === "callout") {
          const parts = dir[2].trim().split(/\s+/).filter(Boolean);
          const tone = parts.find((x) => (COLORS as readonly string[]).includes(x));
          const icon = parts.find((x) => x !== tone) ?? "💡";
          out.push({ type: "callout", attrs: { icon, tone: tone ?? "gray" }, content: kids });
        } else out.push({ type: "details", attrs: { open: false }, content: [{ type: "detailsSummary", content: parseInline(dir[2].trim() || "Details") }, { type: "detailsContent", content: kids }] });
        continue;
      }
      if (/^>\s?/.test(l)) {
        const q: string[] = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
        const inner = markdownToDoc(q.join("\n")).content;
        out.push({ type: "blockquote", content: inner });
        continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(l)) {
        out.push(parseList(l.match(/^\s*/)![0].length));
        continue;
      }
      if (/^\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        const cells = (s: string) => s.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
        const rows = [cells(l)];
        i += 2;
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push({
          type: "table",
          content: rows.map((r, ri) => ({ type: "tableRow", content: r.map((c) => ({ type: ri === 0 ? "tableHeader" : "tableCell", content: [para(c)] })) })),
        });
        continue;
      }
      // A paragraph: lines up to a blank line or the start of another block.
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|:::|>\s?|\s*([-*+]|\d+\.)\s+|-{3,}\s*$)/.test(lines[i])) buf.push(lines[i++].trim());
      if (!buf.length) buf.push(lines[i++]);
      out.push(para(buf.join(" ")));
    }
    return out;
  };

  const parseList = (indent: number): DocNode => {
    const first = /^\s*(?:([-*+])|(\d+)\.)\s+/.exec(lines[i])!;
    const ordered = !!first[2];
    const items: DocNode[] = [];
    // A list is all tasks or none: a task item after plain ones (or the other way) starts another list.
    const isTask = (text: string) => /^\[( |x|X)\]\s+/.test(text);
    const tasks = isTask(lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""));
    while (i < lines.length) {
      const m = /^(\s*)(?:([-*+])|(\d+)\.)\s+(.*)$/.exec(lines[i]);
      if (!m || m[1].length !== indent || !!m[3] !== ordered || isTask(m[4]) !== tasks) break;
      i++;
      let text = m[4];
      const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
      if (task) text = task[2];
      const kids: DocNode[] = [para(text)];
      // Nested lists and continuation lines belong to the item.
      while (i < lines.length) {
        const nm = /^(\s*)(?:[-*+]|\d+\.)\s+/.exec(lines[i]);
        if (nm && nm[1].length > indent) kids.push(parseList(nm[1].length));
        else break;
      }
      items.push(task ? { type: "taskItem", attrs: { checked: task[1] !== " " }, content: kids } : { type: "listItem", content: kids });
    }
    return tasks ? { type: "taskList", content: items } : ordered ? { type: "orderedList", attrs: { start: Number(first[2]) || 1 }, content: items } : { type: "bulletList", content: items };
  };

  const content = parseBlocks();
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

// ---------------------------------------------------------------------------
// Cleaning what a client sends
// ---------------------------------------------------------------------------

const NODE_ATTRS: Record<string, string[]> = {
  doc: [],
  paragraph: [],
  heading: ["level"],
  bulletList: [],
  orderedList: ["start", "type"],
  listItem: [],
  taskList: [],
  taskItem: ["checked"],
  blockquote: [],
  codeBlock: ["language"],
  horizontalRule: [],
  hardBreak: [],
  text: [],
  image: ["src", "alt", "title", "width"],
  table: [],
  tableRow: [],
  tableHeader: ["colspan", "rowspan", "colwidth"],
  tableCell: ["colspan", "rowspan", "colwidth"],
  details: ["open"],
  detailsSummary: [],
  detailsContent: [],
  callout: ["icon", "tone"],
  flexBox: ["dir", "gap", "wrap", "span"],
  zeffField: ["prop", "label"],
  zeffRelated: ["dbId", "prop"],
  zeffButton: ["label", "action", "prop", "value"],
  zeffRef: ["kind", "ref", "label", "href"],
  databaseView: ["dbId", "viewId", "title"],
  pageEmbed: ["pageId", "title"],
  zeffModule: ["module", "key"],
  aiBlock: ["prompt", "text", "at", "auto"],
};

/** The modules a page can hold as a block (what Zeff knows about a ticket — of its row, or the key given). */
export const BLOCK_MODULES = ["briefing", "todos", "questions", "actions", "flags", "context", "chat", "properties", "subtasks", "suggested", "page", ...PERSON_MODULES] as const;
/** The blocks about a row itself (its properties, subtasks, suggested actions, its own page) — in its detail view, or on its page. */
export const ROW_MODULES = ["properties", "source", "subtasks", "suggested", "page", ...PERSON_MODULES] as const;
const MARKS: Record<string, string[]> = { bold: [], italic: [], strike: [], underline: [], code: [], highlight: ["color"], link: ["href", "target"] };
const MAX_NODES = 40000;
const MAX_DEPTH = 40;

/** A link a page may hold: web, mail, phone, or inside Zeff — never javascript: or data:. */
export const safeHref = (h: unknown): string | null => {
  const s = String(h ?? "").trim();
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(s) ? s : null;
};
/** A picture a page may show: uploaded to the workspace, or on the web. */
export const safeImageSrc = (h: unknown): string | null => {
  const s = String(h ?? "").trim();
  return /^(https?:\/\/|\/api\/workspace\/files\/)/i.test(s) ? s : null;
};

/** The document with only what the editor can make: known blocks, marks and attributes, safe links and pictures, bounded in size. */
export function sanitizeDoc(input: unknown): Doc {
  let count = 0;
  const clean = (n: unknown, depth: number): DocNode | null => {
    if (!n || typeof n !== "object" || depth > MAX_DEPTH || ++count > MAX_NODES) return null;
    const o = n as DocNode;
    const allowed = NODE_ATTRS[o.type];
    if (!allowed) return null;
    const out: DocNode = { type: o.type };
    if (allowed.length && o.attrs && typeof o.attrs === "object") {
      const attrs: Record<string, unknown> = {};
      for (const k of allowed) {
        const v = (o.attrs as Record<string, unknown>)[k];
        if (v === undefined) continue;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null || (Array.isArray(v) && v.every((x) => typeof x === "number"))) attrs[k] = typeof v === "string" ? v.slice(0, 2000) : v;
      }
      if (o.type === "image") {
        const src = safeImageSrc(attrs.src);
        if (!src) return null;
        attrs.src = src;
      }
      if (o.type === "zeffRef") {
        const href = attrs.href === undefined ? "" : safeHref(attrs.href);
        if (href === null) delete attrs.href;
      }
      if (o.type === "zeffModule") {
        if (!(BLOCK_MODULES as readonly unknown[]).includes(attrs.module)) return null;
        attrs.key = String(attrs.key ?? "").trim().toUpperCase().slice(0, 40);
      }
      if (o.type === "zeffRelated") {
        const id = Math.floor(Number(attrs.dbId));
        if (!(id > 0)) return null;
        attrs.dbId = id;
      }
      if (o.type === "zeffButton") {
        if (!["set", "trash", "refresh"].includes(String(attrs.action))) attrs.action = "set";
        attrs.label = String(attrs.label ?? "").slice(0, 80);
      }
      if (o.type === "flexBox") {
        attrs.dir = attrs.dir === "col" ? "col" : "row";
        attrs.gap = attrs.gap === "sm" || attrs.gap === "lg" ? attrs.gap : "md";
        if (attrs.wrap !== true) delete attrs.wrap;
        const span = Math.round(Number(attrs.span));
        if (Number.isFinite(span) && span > 0) attrs.span = Math.min(4, span);
        else delete attrs.span;
      }
      if (o.type === "heading") attrs.level = Math.min(3, Math.max(1, Number(attrs.level) || 1));
      if (o.type === "pageEmbed") {
        const id = Math.floor(Number(attrs.pageId));
        if (!(id > 0)) return null;
        attrs.pageId = id;
        attrs.title = String(attrs.title ?? "").slice(0, 300);
      }
      if (Object.keys(attrs).length) out.attrs = attrs;
    }
    if (o.type === "text") {
      if (typeof o.text !== "string" || !o.text) return null;
      out.text = o.text.slice(0, 100000);
      const marks: Mark[] = [];
      for (const m of Array.isArray(o.marks) ? o.marks : []) {
        const keys = MARKS[m?.type];
        if (!keys) continue;
        const mark: Mark = { type: m.type };
        if (m.type === "link") {
          const href = safeHref(m.attrs?.href);
          if (!href) continue;
          mark.attrs = { href };
        } else if (keys.length && m.attrs) {
          const a: Record<string, unknown> = {};
          for (const k of keys) if (typeof m.attrs[k] === "string") a[k] = String(m.attrs[k]).slice(0, 100);
          if (Object.keys(a).length) mark.attrs = a;
        }
        marks.push(mark);
      }
      if (marks.length) out.marks = marks;
      return out;
    }
    if (Array.isArray(o.content)) {
      const kids = o.content.map((c) => clean(c, depth + 1)).filter((c): c is DocNode => !!c);
      if (kids.length) out.content = kids;
    }
    return out;
  };
  const d = clean(input, 0);
  if (!d || d.type !== "doc" || !d.content?.length) return emptyDoc();
  return d as Doc;
}

/** A line of a card's preview (a note in the gallery): a line of text, or a checklist item with its place among them. */
export type PreviewLine = { kind: "text"; text: string } | { kind: "task"; text: string; checked: boolean; index: number };

/** A page as a card shows it, as Keep does a note: its lines of text and its checklist items (to tick in place) — at most `max`. */
export function previewLines(doc: DocNode | null | undefined, max = 12): PreviewLine[] {
  const out: PreviewLine[] = [];
  let task = 0;
  const walk = (nodes: DocNode[]) => {
    for (const n of nodes) {
      if (out.length >= max) return;
      if (n.type === "taskList") {
        for (const item of n.content ?? []) {
          const text = docText(item).trim();
          if (out.length < max) out.push({ kind: "task", text, checked: !!item.attrs?.checked, index: task });
          task++;
        }
      } else if (n.type === "bulletList" || n.type === "orderedList") {
        for (const item of n.content ?? []) if (out.length < max) out.push({ kind: "text", text: `• ${docText(item).trim()}` });
      } else if (n.type === "aiBlock" || n.type === "zeffModule" || n.type === "databaseView" || n.type === "pageEmbed" || n.type === "image") {
        continue;
      } else if (n.type === "details" || n.type === "blockquote" || n.type === "callout") {
        walk(n.content ?? []);
      } else {
        const text = docText(n).trim();
        if (text) out.push({ kind: "text", text });
      }
    }
  };
  walk(doc?.content ?? []);
  return out;
}

/** The page with its `index`-th checklist item ticked or not (no such item: as it was). */
export function toggleTask(doc: Doc, index: number, checked: boolean): Doc {
  let task = 0;
  const walk = (n: DocNode): DocNode => {
    if (n.type === "taskItem") return task++ === index ? { ...n, attrs: { ...n.attrs, checked } } : n;
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return walk(doc) as Doc;
}
