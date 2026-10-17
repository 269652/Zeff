import fs from "node:fs";
import path from "node:path";
import { t } from "@/lib/i18n/server";
import type { DocNode } from "./doc";
import { filesDir } from "./files";
import { cellText, noLabels, SYSTEM_PROPS } from "./model";
import { getPage, rowsOf } from "./store";

/**
 * A page (or a database) as one HTML file that cannot be changed: its text, lists, tables, pictures (inside the file), callouts and
 * toggles as they are, a database as its table. Sent to a colleague it opens in any browser - nothing of Zeff is reachable through it,
 * and what is not in the file cannot leak. The data blocks of a page (figures, charts) and the apps are left out. Server only.
 */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const MAX_IMAGE = 2 * 1024 * 1024;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

/** A picture's address as the file can hold it: a file of the Workspace inside the file (up to 2 MB), a web address as it is, else nothing. */
function imageSrc(src: string): string {
  const m = /^\/api\/workspace\/files\/([\w.-]+)$/.exec(src);
  if (m) {
    try {
      const file = path.join(filesDir(), m[1]);
      const mime = MIME[path.extname(file).toLowerCase()];
      if (mime && fs.statSync(file).size <= MAX_IMAGE) return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
    } catch {
      // gone
    }
    return "";
  }
  return /^https?:\/\//i.test(src) ? src : "";
}

function inline(nodes: DocNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "<br>";
      if (n.type === "image") {
        const src = imageSrc(String(n.attrs?.src ?? ""));
        return src ? `<img src="${esc(src)}" alt="${esc(n.attrs?.alt)}">` : "";
      }
      if (n.type === "zeffRef") return `<span class="ref">${esc(n.attrs?.label)}</span>`;
      let out = esc(n.text ?? "");
      for (const m of n.marks ?? []) {
        if (m.type === "bold") out = `<strong>${out}</strong>`;
        else if (m.type === "italic") out = `<em>${out}</em>`;
        else if (m.type === "strike") out = `<s>${out}</s>`;
        else if (m.type === "underline") out = `<u>${out}</u>`;
        else if (m.type === "code") out = `<code>${out}</code>`;
        else if (m.type === "highlight") out = `<mark>${out}</mark>`;
        else if (m.type === "link") {
          const href = String(m.attrs?.href ?? "");
          if (/^https?:\/\/|^mailto:/i.test(href)) out = `<a href="${esc(href)}" rel="noopener noreferrer">${out}</a>`;
        }
      }
      return out;
    })
    .join("");
}

function block(n: DocNode): string {
  const kids = n.content ?? [];
  const all = (list: DocNode[]) => list.map(block).join("\n");
  switch (n.type) {
    case "paragraph":
      return `<p>${inline(kids)}</p>`;
    case "heading": {
      const l = Math.min(3, Math.max(1, Number(n.attrs?.level ?? 1)));
      return `<h${l}>${inline(kids)}</h${l}>`;
    }
    case "bulletList":
      return `<ul>${all(kids)}</ul>`;
    case "orderedList":
      return `<ol>${all(kids)}</ol>`;
    case "taskList":
      return `<ul class="tasks">${all(kids)}</ul>`;
    case "listItem":
      return `<li>${all(kids)}</li>`;
    case "taskItem":
      return `<li class="task"><span aria-hidden>${n.attrs?.checked ? "☑" : "☐"}</span> <div>${all(kids)}</div></li>`;
    case "blockquote":
      return `<blockquote>${all(kids)}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${esc(kids.map((c) => c.text ?? "").join(""))}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "image": {
      const src = imageSrc(String(n.attrs?.src ?? ""));
      return src ? `<p><img src="${esc(src)}" alt="${esc(n.attrs?.alt)}"></p>` : "";
    }
    case "table":
      return `<table>${kids.map((r) => `<tr>${(r.content ?? []).map((c) => `<${c.type === "tableHeader" ? "th" : "td"}>${all(c.content ?? [])}</${c.type === "tableHeader" ? "th" : "td"}>`).join("")}</tr>`).join("")}</table>`;
    case "callout":
      return `<div class="callout"><span class="icon">${esc(n.attrs?.icon ?? "💡")}</span><div>${all(kids)}</div></div>`;
    case "details": {
      const summary = kids.find((c) => c.type === "detailsSummary");
      const body = kids.find((c) => c.type === "detailsContent");
      return `<details open><summary>${inline(summary?.content)}</summary>${all(body?.content ?? [])}</details>`;
    }
    case "zeffTabs":
      return kids.map((tab) => `<section class="tab"><h3>${esc(tab.attrs?.title)}</h3>${all(tab.content ?? [])}</section>`).join("\n");
    case "flexBox":
      return `<div class="flex">${all(kids)}</div>`;
    case "doc":
      return all(kids);
    default:
      // Blocks that need Zeff (figures, charts, appointments, apps, the entry's own blocks) are not part of the file.
      return "";
  }
}

const PAGE = (title: string, icon: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark}body{font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;max-width:46rem;margin:2.5rem auto;padding:0 1.25rem;color:#18181b;background:#fff}
@media(prefers-color-scheme:dark){body{color:#e4e4e7;background:#09090b}table,th,td{border-color:#3f3f46!important}.callout{background:#1c1c20!important}code,pre{background:#1c1c20!important}}
h1{font-size:2rem;line-height:1.2;margin:.2em 0 .6em}h2{margin-top:1.6em}img{max-width:100%;border-radius:8px}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.92rem}th,td{border:1px solid #e4e4e7;padding:.35rem .55rem;text-align:left;vertical-align:top}th{background:rgba(127,127,127,.1)}
blockquote{border-left:3px solid #a1a1aa;margin:1em 0;padding:.1em 1em;color:#52525b}pre,code{background:#f4f4f5;border-radius:6px}pre{padding:.8rem;overflow:auto}code{padding:.1em .3em}
.callout{display:flex;gap:.7rem;background:#f4f4f5;border-radius:10px;padding:.8rem 1rem;margin:1em 0}.callout p{margin:.2em 0}ul.tasks{list-style:none;padding-left:.2rem}li.task{display:flex;gap:.5rem}li.task p{margin:0}
.ref{background:rgba(99,102,241,.12);border-radius:4px;padding:0 .25em}.meta{color:#71717a;font-size:.85rem;margin-top:3rem;border-top:1px solid rgba(127,127,127,.3);padding-top:.8rem}.tab{margin:1.2em 0}
</style></head><body>
<h1>${icon ? `${esc(icon)} ` : ""}${esc(title)}</h1>
${body}
<p class="meta">${esc(t("A read-only copy from Zeff, {date}. It cannot be changed here.", { date: new Date().toLocaleString() }))}</p>
</body></html>`;

/** A page, or a database as its table, as one HTML file - `filename` for saving. */
export function pageToHtml(pageId: number): { filename: string; html: string } {
  const p = getPage(pageId);
  if (!p || p.archivedAt) throw new Error(t("This page is gone."));
  let body = "";
  if (p.kind === "database") {
    const d = rowsOf(p.id);
    if (d) {
      const props = d.schema.properties.filter((q) => !SYSTEM_PROPS.has(q.id) && q.id !== "srcurl" && !["person", "relation", "todo", "ai"].includes(q.type));
      body = `<table><tr><th>${esc(d.schema.titleName)}</th>${props.map((q) => `<th>${esc(q.name)}</th>`).join("")}</tr>${d.rows
        .slice(0, 1000)
        .map((r) => `<tr><td>${esc(`${r.icon ? `${r.icon} ` : ""}${r.title}`)}</td>${props.map((q) => `<td>${esc(cellText(q, r.cells[q.id], noLabels))}</td>`).join("")}</tr>`)
        .join("")}</table>`;
    }
  } else body = block(p.content as unknown as DocNode);
  const name = (p.title || "page").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 80) || "page";
  return { filename: `${name}.html`, html: PAGE(p.title || t("Untitled"), p.icon, body) };
}
