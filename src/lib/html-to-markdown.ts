/**
 * Pasted HTML (Teams, Jira, Outlook, web pages) as Markdown, in the subset markdown.ts
 * reads: paragraphs and line breaks, # headings, **bold**, *italic*, ~~strike~~, `code`,
 * [links](…), nested * / 1. lists (two spaces per level), > quotes, ``` code, | tables |.
 * Browser only (DOMParser). `image` says what an <img> becomes: a Markdown image target
 * (a stored paste, a URL) or null to leave it out.
 */
export function htmlToMarkdown(html: string, image: (img: { src: string; alt: string }) => string | null): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, meta, link, title, template, noscript, xml, head").forEach((n) => n.remove());
  return tidy(convert(doc.body, { depth: 0, pre: false, image }));
}

type Ctx = { depth: number; pre: boolean; image: (img: { src: string; alt: string }) => string | null };

const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE", "FIGURE", "FIGCAPTION", "CENTER", "ADDRESS", "DL", "DT", "DD"]);
const SAFE_HREF = /^(https?:|mailto:|msteams:)/i;
/** A picture as convert() writes it (its target has no spaces or parentheses). */
const PICTURE = /!\[[^\]\n]*\]\([^)\s]*\)/g;
/** A link or picture target that stays one: no spaces or parentheses. */
const target = (url: string) => url.replace(/\s/g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

function children(node: Node, ctx: Ctx): string {
  return [...node.childNodes].map((n) => convert(n, ctx)).join("");
}

/** Wrap inline content in a marker (**, *, ~~), keeping its outer spaces outside: " **x** ". */
function wrap(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}

function convert(node: Node, ctx: Ctx): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent ?? "";
    return ctx.pre ? t : t.replace(/[ \t\r\n\f ]+/g, " ");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();
  const style = (el.getAttribute("style") ?? "").toLowerCase();

  switch (tag) {
    case "BR":
      return "\n";
    case "B":
    case "STRONG":
      return wrap(children(el, ctx), "**");
    case "I":
    case "EM":
    case "CITE":
      return wrap(children(el, ctx), "*");
    case "S":
    case "STRIKE":
    case "DEL":
      return wrap(children(el, ctx), "~~");
    case "CODE":
    case "KBD":
    case "SAMP":
      return ctx.pre ? children(el, ctx) : `\`${(el.textContent ?? "").replace(/`/g, "'")}\``;
    case "A": {
      const href = el.getAttribute("href") ?? "";
      const inner = children(el, ctx);
      // A linked picture — GitLab, Jira and Teams link a screenshot to its full size — is just the
      // picture; one inside link text goes after the link.
      const pictures = inner.match(PICTURE) ?? [];
      const text = inner.replace(PICTURE, " ").replace(/\s+/g, " ").trim();
      if (!SAFE_HREF.test(href) || !text) return inner;
      const link = text === href ? `<${href}>` : `[${text.replace(/[[\]]/g, "")}](${target(href)})`;
      return link + pictures.map((p) => `\n\n${p}\n\n`).join("");
    }
    case "EMOJI":
      // Teams writes emoji as <emoji alt="😄">.
      return el.getAttribute("alt") ?? "";
    case "IMG": {
      // An emoji as a picture (Teams, Skype): the emoji itself.
      if (/schema\.skype\.com\/Emoji/i.test(el.getAttribute("itemtype") ?? "")) return el.getAttribute("alt") ?? "";
      // Lazy-loading pages (GitLab) keep the real address in data-src until the picture scrolls into view.
      const src = el.getAttribute("data-src") || el.getAttribute("src") || "";
      const alt = (el.getAttribute("alt") ?? "").replace(/[[\]\n]/g, " ").trim();
      const to = ctx.image({ src, alt });
      return to ? `\n\n![${alt || "image"}](${target(to)})\n\n` : "";
    }
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return `\n\n${"#".repeat(Number(tag[1]))} ${children(el, ctx).replace(/\s+/g, " ").trim()}\n\n`;
    case "UL":
    case "OL":
      return `\n\n${list(el, ctx)}\n\n`;
    case "LI":
      return `\n${children(el, ctx)}\n`; // only outside a list (stray <li>)
    case "BLOCKQUOTE": {
      const inner = tidy(children(el, ctx));
      return `\n\n${inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")}\n\n`;
    }
    case "PRE":
      return `\n\n\`\`\`\n${(el.textContent ?? "").replace(/\n+$/, "")}\n\`\`\`\n\n`;
    case "TABLE":
      return `\n\n${table(el as HTMLTableElement, ctx)}\n\n`;
    case "HR":
      return "\n\n---\n\n";
    default: {
      let inner = children(el, ctx);
      // Styled spans (Word, Google Docs) carry bold / italic / strike in their style.
      if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) inner = wrap(inner, "**");
      if (/font-style\s*:\s*italic/.test(style)) inner = wrap(inner, "*");
      if (/text-decoration[^;]*line-through/.test(style)) inner = wrap(inner, "~~");
      return BLOCK.has(tag) ? `\n${inner}\n${tag === "P" ? "\n" : ""}` : inner;
    }
  }
}

/** A <ul>/<ol> as Markdown list lines, nested lists two spaces deeper (also when they sit right in the list). */
function list(el: HTMLElement, ctx: Ctx): string {
  const ordered = el.tagName.toUpperCase() === "OL";
  const pad = "  ".repeat(ctx.depth);
  const lines: string[] = [];
  let n = Number(el.getAttribute("start")) || 1;
  for (const child of [...el.childNodes]) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const c = child as HTMLElement;
    const tag = c.tagName.toUpperCase();
    if (tag === "UL" || tag === "OL") {
      lines.push(list(c, { ...ctx, depth: ctx.depth + 1 }));
      continue;
    }
    if (tag !== "LI") continue;
    let text = "";
    const nested: string[] = [];
    for (const part of [...c.childNodes]) {
      const ptag = part.nodeType === Node.ELEMENT_NODE ? (part as HTMLElement).tagName.toUpperCase() : "";
      if (ptag === "UL" || ptag === "OL") nested.push(list(part as HTMLElement, { ...ctx, depth: ctx.depth + 1 }));
      else text += ` ${convert(part, ctx)} `;
    }
    lines.push(`${pad}${ordered ? `${n++}.` : "*"} ${text.replace(/\s+/g, " ").trim()}`, ...nested);
  }
  return lines.join("\n");
}

/** A table as a Markdown table: the first row is the header. */
function table(el: HTMLTableElement, ctx: Ctx): string {
  const rows = [...el.rows].map((r) => [...r.cells].map((c) => convert(c, ctx).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()));
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |`;
  return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
}

/** Trim lines (list indents and code kept), and keep at most one blank line between blocks. */
function tidy(md: string): string {
  let fence = false;
  const lines = md.replace(/ /g, " ").split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      return line.trim();
    }
    if (fence) return line;
    return /^\s*([*+-]|\d{1,3}\.)\s/.test(line) ? line.replace(/\s+$/, "") : line.trim();
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
