/**
 * Rich text for views: <markdown value="{{ text }}"/> turns Markdown into the view's own nodes (headings, bold, italic, code, links, lists,
 * quotes, rules, code blocks) — no HTML ever passes through, so what is written can only be what these nodes are. A picture block of an
 * agent's message (```svg, ```plot, ```chart, ```widget) is its widget in the sandboxed frame. Client-safe.
 */
import type { VNode } from "./card-template";
import { BLOCK_KINDS, blockWidget, type BlockKind } from "@/lib/widgets/inline";

const SAFE_LINK = /^(https?:\/\/|\/|mailto:|tel:)/i;
export const MAX_MARKDOWN = 60_000;

/** Inline Markdown (**bold**, *italic*, `code`, [text](address)) as nodes. */
export function inlineMarkdown(s: string): VNode[] {
  const out: VNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[2] ?? m[3]) out.push({ t: "b", a: {}, c: inlineMarkdown(m[2] ?? m[3]) });
    else if (m[4]) out.push({ t: "i", a: {}, c: inlineMarkdown(m[4]) });
    else if (m[5]) out.push({ t: "code", a: {}, c: [m[5]] });
    else if (SAFE_LINK.test(m[7])) out.push({ t: "a", a: { href: m[7] }, c: inlineMarkdown(m[6]) });
    else out.push(m[6]);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Markdown as one column of blocks. */
export function markdownNodes(src: string): VNode[] {
  const lines = src.slice(0, MAX_MARKDOWN).replace(/\r\n?/g, "\n").split("\n");
  const blocks: VNode[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "text", a: {}, c: inlineMarkdown(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const lang = line.trim().slice(3).trim().toLowerCase();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      // An agent's picture block (```svg, ```plot, ```chart, ```widget — an exercise set of the kit): its widget, sandboxed, as in the chat.
      if ((BLOCK_KINDS as readonly string[]).includes(lang)) {
        const w = blockWidget(lang as BlockKind, code.join("\n"));
        if (w.ok) {
          blocks.push({ t: "codewidget", a: { html: w.html, libs: w.libs.join(","), title: w.title }, c: [] });
          continue;
        }
      }
      blocks.push({ t: "text", a: { pre: "true" }, c: [{ t: "mono", a: {}, c: [code.join("\n")] }] });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ t: "heading", a: { level: String(Math.min(3, h[1].length)) }, c: inlineMarkdown(h[2].trim()) });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ t: "divider", a: {}, c: [] });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      flush();
      const quoted = [q[1]];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) quoted.push(lines[++i].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", a: {}, c: inlineMarkdown(quoted.join(" ")) });
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const items: VNode[] = [];
      let k = i;
      for (; k < lines.length; k++) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[k]);
        if (!m) break;
        const depth = Math.min(4, Math.floor(m[1].replace(/\t/g, "  ").length / 2));
        items.push({ t: "text", a: {}, c: [`${"   ".repeat(depth)}${/^\d/.test(m[2]) ? m[2] : "•"} `, ...inlineMarkdown(m[3])] });
      }
      i = k - 1;
      blocks.push({ t: "col", a: { gap: "1" }, c: items });
      continue;
    }
    if (!line.trim()) flush();
    else para.push(line.trim());
  }
  flush();
  return [{ t: "col", a: { gap: "2" }, c: blocks }];
}
