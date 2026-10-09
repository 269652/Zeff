/**
 * The Markdown used for context messages — a small, safe subset — parsed into blocks for
 * display (components/Markdown.tsx), flattened to plain text (headlines, search), and
 * re-indented for Jira. No DOM, no HTML: usable on the server and in the browser.
 *
 * Blocks: paragraphs (single line breaks kept), # headings, > quotes, nested * - + / 1.
 * lists (nesting by indentation, any width), ``` code, | tables |, --- rules.
 * Inline: **bold**, *italic* / _italic_, ~~strike~~, `code`, [links](https://…),
 * <https://…> and bare links, ![images](src).
 */

export type MdInline =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "strong" | "em" | "del"; c: MdInline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: MdInline[] }
  | { t: "img"; src: string; alt: string };

export type MdListItem = { c: MdInline[]; sub: MdBlock[] };

export type MdBlock =
  | { t: "p"; c: MdInline[] }
  | { t: "h"; level: number; c: MdInline[] }
  | { t: "quote"; c: MdBlock[] }
  | { t: "list"; ordered: boolean; items: MdListItem[] }
  | { t: "code"; v: string }
  | { t: "table"; head: MdInline[][]; rows: MdInline[][][] }
  | { t: "hr" };

const LIST_ITEM = /^(\s*)([*+-]|\d{1,3}[.)])\s+(.*)$/;
const SAFE_HREF = /^(https?:|mailto:|msteams:)/i;

/** The block structure of a Markdown text. */
export function parseMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // ``` code
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ t: "code", v: body.join("\n") });
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      blocks.push({ t: "h", level: h[1].length, c: parseInline(h[2]) });
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      blocks.push({ t: "quote", c: parseMarkdown(body.join("\n")) });
      continue;
    }
    // | table | (a header, a --- separator, rows)
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => parseInline(c.trim()));
      const head = cells(line);
      const rows: MdInline[][][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ t: "table", head, rows });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const start = i;
      while (i < lines.length && lines[i].trim() && (LIST_ITEM.test(lines[i]) || /^\s+\S/.test(lines[i]))) i++;
      blocks.push(parseList(lines.slice(start, i)));
      continue;
    }
    // A paragraph: up to a blank line or another kind of block; line breaks are kept.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !(para.length && (LIST_ITEM.test(lines[i]) || /^\s{0,3}(#{1,6}\s|>|```)/.test(lines[i])))
    ) {
      para.push(lines[i++].trim());
    }
    const c: MdInline[] = [];
    para.forEach((l, k) => {
      if (k) c.push({ t: "br" });
      c.push(...parseInline(l));
    });
    blocks.push({ t: "p", c });
  }
  return blocks;
}

/** Nested list items from their lines: deeper indentation (any width) nests; other indented lines continue an item. */
function parseList(lines: string[]): MdBlock {
  type Node = { indent: number; ordered: boolean; items: { text: string[]; sub: Node[] }[] };
  const root: Node = { indent: -1, ordered: false, items: [] };
  const stack: Node[] = [];
  for (const line of lines) {
    const m = LIST_ITEM.exec(line);
    if (!m) {
      const top = stack[stack.length - 1];
      top?.items[top.items.length - 1]?.text.push(line.trim());
      continue;
    }
    const indent = m[1].replace(/\t/g, "    ").length;
    const ordered = /\d/.test(m[2]);
    while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
    let list = stack[stack.length - 1];
    if (!list || indent > list.indent) {
      const node: Node = { indent, ordered, items: [] };
      const parentItem = list?.items[list.items.length - 1];
      if (parentItem) parentItem.sub.push(node);
      else root.items.push({ text: [], sub: [node] });
      stack.push(node);
      list = node;
    }
    list.items.push({ text: [m[3]], sub: [] });
  }
  const toBlock = (n: Node): MdBlock => ({
    t: "list",
    ordered: n.ordered,
    items: n.items.map((it) => ({
      c: it.text.flatMap((l, k) => (k ? [{ t: "br" } as MdInline, ...parseInline(l)] : parseInline(l))),
      sub: it.sub.map(toBlock),
    })),
  });
  const first = root.items[0]?.sub[0];
  return first ? toBlock(first) : { t: "p", c: [] };
}

/** Inline Markdown into text, emphasis, code, links and images. */
export function parseInline(s: string): MdInline[] {
  const out: MdInline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if (rest[0] === "\\" && /[\\`*_{}[\]()#+\-.!|~>]/.test(rest[1] ?? "")) {
      text += rest[1];
      i += 2;
    } else if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ t: "code", v: m[1] });
      i += m[0].length;
    } else if ((m = /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
      flush();
      out.push({ t: "img", alt: m[1], src: m[2] });
      i += m[0].length;
    } else if ((m = /^\[((?:[^\]\\]|\\.)+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/.exec(rest))) {
      flush();
      out.push(SAFE_HREF.test(m[2]) ? { t: "link", href: m[2], c: parseInline(m[1]) } : { t: "text", v: m[1] });
      i += m[0].length;
    } else if ((m = /^<((?:https?:|mailto:|msteams:)[^>\s]+)>/.exec(rest))) {
      flush();
      out.push({ t: "link", href: m[1], c: [{ t: "text", v: m[1] }] });
      i += m[0].length;
    } else if ((m = /^https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]/.exec(rest)) && !/[\w/]$/.test(s.slice(0, i))) {
      flush();
      out.push({ t: "link", href: m[0], c: [{ t: "text", v: m[0] }] });
      i += m[0].length;
    } else if ((m = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest))) {
      flush();
      out.push({ t: "strong", c: parseInline(m[2]) });
      i += m[0].length;
    } else if ((m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) {
      flush();
      out.push({ t: "del", c: parseInline(m[1]) });
      i += m[0].length;
    } else if ((m = /^\*(?=[^\s*])([^*]*?[^\s*])\*/.exec(rest)) || ((m = /^_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/.exec(rest)) && !/\w$/.test(s.slice(0, i)))) {
      flush();
      out.push({ t: "em", c: parseInline(m[1]) });
      i += m[0].length;
    } else {
      text += rest[0];
      i += 1;
    }
  }
  flush();
  return out;
}

/** Inline content as plain text (images dropped). */
function inlineText(c: MdInline[]): string {
  return c
    .map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? " " : n.t === "img" ? "" : inlineText(n.c)))
    .join("");
}

/** A Markdown text as plain lines — for headlines, previews and search. */
export function markdownToPlain(md: string): string {
  const lines: string[] = [];
  const walk = (blocks: MdBlock[], prefix = "") => {
    for (const b of blocks) {
      if (b.t === "p" || b.t === "h") lines.push(prefix + inlineText(b.c));
      else if (b.t === "quote") walk(b.c, prefix);
      else if (b.t === "code") lines.push(...b.v.split("\n"));
      else if (b.t === "list") for (const it of b.items) {
        lines.push(prefix + inlineText(it.c));
        walk(it.sub, prefix);
      }
      else if (b.t === "table") for (const r of [b.head, ...b.rows]) lines.push(r.map(inlineText).join(" · "));
    }
  };
  walk(parseMarkdown(md));
  return lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

/**
 * Lists re-indented to two spaces per level ("* a" / "  * b" / "    * c"), whatever width
 * they were written with — the nesting Jira's Markdown conversion understands.
 */
export function normalizeListIndent(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let stack: number[] = [];
  return lines
    .map((line) => {
      const m = LIST_ITEM.exec(line);
      if (!m) {
        if (!line.trim()) stack = [];
        return line;
      }
      const indent = m[1].replace(/\t/g, "    ").length;
      while (stack.length && indent < stack[stack.length - 1]) stack.pop();
      if (!stack.length || indent > stack[stack.length - 1]) stack.push(indent);
      return `${"  ".repeat(stack.length - 1)}${m[2]} ${m[3]}`;
    })
    .join("\n");
}

/** Every image reference's target in a Markdown text, e.g. "attachment:12" or "paste:k3x9". */
export function imageTargets(md: string): string[] {
  return [...md.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)].map((m) => m[1]);
}

/** Rewrite image targets (`![alt](target)`) — e.g. paste tokens to stored files, files to Jira names. */
export function mapImageTargets(md: string, map: (target: string, alt: string) => string): string {
  return md.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)((?:\s+"[^"]*")?\s*)\)/g, (_all, alt: string, target: string, title: string) => `![${alt}](${map(target, alt)}${title})`);
}
