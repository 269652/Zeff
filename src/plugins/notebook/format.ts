import { codeInputs, docText, docToMarkdown, markdownToDoc, sanitizeDoc, type Doc, type DocNode } from "@/plugins/workspace/doc";
import type { NbOutput } from "./outputs";

/**
 * The .znb file — a Zeff notebook: a Jupyter notebook (nbformat 4.5, JSON) with Zeff on top, so Jupyter opens it as it is and Zeff
 * loses nothing. A page's text is markdown cells, its code blocks are code cells (the language in the cell's metadata.zeff.language;
 * outputs as Jupyter keeps them), and every other block of Zeff — a widget, a panel, a transform, a database view, a table with its
 * name and protection — is a markdown cell with a plain note for readers that do not know it and the block itself in
 * metadata.zeff.node. Importing reads .znb and plain .ipynb. Pure and client-safe.
 */

export type NbCell = {
  cell_type: "markdown" | "code" | "raw";
  id: string;
  metadata: Record<string, unknown>;
  source: string | string[];
  execution_count?: number | null;
  outputs?: unknown[];
};
export type Notebook = { nbformat: 4; nbformat_minor: 5; metadata: Record<string, unknown>; cells: NbCell[] };

/** The blocks Markdown keeps whole: they make markdown cells. */
const MD = new Set(["paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "horizontalRule"]);

/** What the code blocks call a language, for another tool. */
const JUPYTER_NAME: Record<string, string> = { python: "python", node: "javascript", rust: "rust" };
const FROM_JUPYTER: Record<string, string> = { python: "python", python3: "python", ipython: "python", javascript: "node", node: "node", nodejs: "node", js: "node", rust: "rust", rs: "rust" };

const lines = (s: string): string[] => {
  const parts = s.split("\n");
  return parts.map((l, i) => (i < parts.length - 1 ? `${l}\n` : l)).filter((l, i, a) => !(i === a.length - 1 && l === ""));
};
const joinSource = (s: unknown): string => (Array.isArray(s) ? s.map(String).join("") : typeof s === "string" ? s : "");

/** A note for a reader that does not know the block (Jupyter shows it as Markdown). */
function fallback(node: DocNode): string {
  const title = String(node.attrs?.title ?? "").trim();
  switch (node.type) {
    case "table":
      return docToMarkdown({ type: "doc", content: [node] }).trim();
    case "zeffApp":
    case "zeffWidget":
      return `> 🧩 Zeff widget${title ? `: ${title}` : ""} — open this notebook in Zeff to use it.`;
    case "tablePipe":
      return `> 🔀 Zeff transform${node.attrs?.name ? `: ${String(node.attrs.name)}` : ""}${node.attrs?.desc ? ` — ${String(node.attrs.desc)}` : ""}`;
    case "pipeResult":
      return `> 📋 Zeff result table: ${String(node.attrs?.of ?? "")}`;
    case "databaseView":
      return `> 🗃 Zeff database view${title ? `: ${title}` : ""}`;
    case "panel":
    case "callout":
    case "details":
    case "flexBox":
    case "zeffTabs": {
      const text = docText({ type: "doc", content: [node] } as Doc).trim();
      return `> 🗂 Zeff ${node.type === "panel" ? "panel" : "container"}${title ? `: ${title}` : ""}${text ? `\n>\n${text.split("\n").map((l) => `> ${l}`).join("\n")}` : ""}`;
    }
    default:
      return `> 🧩 Zeff block (${node.type})`;
  }
}

/** A page as a notebook. */
export function pageToNotebook(title: string, doc: Doc | null | undefined, opts: { exportedAt?: string } = {}): Notebook {
  const cells: NbCell[] = [];
  let buf: DocNode[] = [];
  const next = () => `cell-${cells.length + 1}`;
  const flush = () => {
    if (!buf.length) return;
    const md = docToMarkdown({ type: "doc", content: buf } as Doc).trim();
    if (md) cells.push({ cell_type: "markdown", id: next(), metadata: {}, source: lines(md) });
    buf = [];
  };
  const languages = new Set<string>();
  for (const node of doc?.content ?? []) {
    if (MD.has(node.type)) buf.push(node);
    else if (node.type === "codeCell") {
      flush();
      const language = String(node.attrs?.language ?? "python");
      languages.add(language);
      let outputs: unknown[] = [];
      try {
        const v = node.attrs?.outputs ? (JSON.parse(String(node.attrs.outputs)) as unknown) : [];
        outputs = Array.isArray(v) ? v : [];
      } catch {
        outputs = [];
      }
      const count = Number(node.attrs?.count) || 0;
      cells.push({
        cell_type: "code",
        id: next(),
        metadata: { zeff: { language, ...(String(node.attrs?.name ?? "").trim() ? { name: String(node.attrs?.name).trim() } : {}), ...(codeInputs(node.attrs?.inputs).length ? { inputs: codeInputs(node.attrs?.inputs) } : {}), ...(node.attrs?.result ? { result: node.attrs.result } : {}) }, vscode: { languageId: JUPYTER_NAME[language] ?? language } },
        execution_count: count || null,
        source: lines(String(node.attrs?.source ?? "")),
        outputs: outputs.map((o) => (o && typeof o === "object" ? { ...(o as object), ...((o as { output_type?: string }).output_type === "execute_result" ? { execution_count: count || null } : {}) } : o)),
      });
    } else {
      flush();
      cells.push({ cell_type: "markdown", id: next(), metadata: { zeff: { node } }, source: lines(fallback(node)) });
    }
  }
  flush();
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python" },
      zeff: { format: "znb", version: 1, title, ...(opts.exportedAt ? { exportedAt: opts.exportedAt } : {}), languages: [...languages] },
    },
    cells,
  };
}

/** Outputs as the code cell keeps them: texts joined, only the kinds known. */
export function normalizeOutputs(raw: unknown): NbOutput[] {
  const out: NbOutput[] = [];
  const mime = (data: unknown): Record<string, unknown> => {
    const d: Record<string, unknown> = {};
    if (data && typeof data === "object") for (const [k, v] of Object.entries(data as Record<string, unknown>)) d[k] = Array.isArray(v) && v.every((x) => typeof x === "string") && !k.startsWith("application/json") ? v.join("") : v;
    return d;
  };
  for (const o of Array.isArray(raw) ? raw : []) {
    if (!o || typeof o !== "object") continue;
    const x = o as Record<string, unknown>;
    if (x.output_type === "stream") out.push({ output_type: "stream", name: x.name === "stderr" ? "stderr" : "stdout", text: joinSource(x.text) });
    else if (x.output_type === "display_data") out.push({ output_type: "display_data", data: mime(x.data), metadata: {} });
    else if (x.output_type === "execute_result") out.push({ output_type: "execute_result", execution_count: Number(x.execution_count) || null, data: mime(x.data), metadata: {} });
    else if (x.output_type === "error") out.push({ output_type: "error", ename: String(x.ename ?? "Error"), evalue: String(x.evalue ?? ""), traceback: (Array.isArray(x.traceback) ? x.traceback : []).map(String) });
  }
  return out;
}

/** A notebook (.znb or .ipynb) as a page's title and document; what is wrong with the file said in words (it throws). */
export function notebookToPage(raw: unknown, fallbackTitle = "Notebook"): { title: string; doc: Doc } {
  const nb = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!nb || !Array.isArray(nb.cells)) throw new Error("This is not a notebook file (no cells).");
  if (Number(nb.nbformat) !== 4) throw new Error(`Only notebooks of format 4 can be opened (this one is ${String(nb.nbformat ?? "unknown")}).`);
  const meta = (nb.metadata && typeof nb.metadata === "object" ? nb.metadata : {}) as Record<string, unknown>;
  const zeffMeta = (meta.zeff && typeof meta.zeff === "object" ? meta.zeff : {}) as Record<string, unknown>;
  const kernelLang = String(((meta.language_info as Record<string, unknown> | undefined)?.name ?? (meta.kernelspec as Record<string, unknown> | undefined)?.language ?? "python") as string).toLowerCase();
  const defaultLang = FROM_JUPYTER[kernelLang] ?? (/^[a-z][\w-]{0,19}$/.test(kernelLang) ? kernelLang : "python");
  const content: DocNode[] = [];
  for (const c of nb.cells.slice(0, 5000)) {
    if (!c || typeof c !== "object") continue;
    const cell = c as Record<string, unknown>;
    const cm = (cell.metadata && typeof cell.metadata === "object" ? cell.metadata : {}) as Record<string, unknown>;
    const z = (cm.zeff && typeof cm.zeff === "object" ? cm.zeff : {}) as Record<string, unknown>;
    const source = joinSource(cell.source);
    if (cell.cell_type === "code") {
      const lang = FROM_JUPYTER[String(z.language ?? "").toLowerCase()] ?? (typeof z.language === "string" && /^[a-z][\w-]{0,19}$/i.test(z.language) ? z.language.toLowerCase() : defaultLang);
      content.push({ type: "codeCell", attrs: { language: lang, source, outputs: JSON.stringify(normalizeOutputs(cell.outputs)), count: Number(cell.execution_count) || 0, name: z.name, inputs: JSON.stringify(codeInputs(z.inputs)), result: typeof z.result === "string" ? z.result : "" } });
    } else if (cell.cell_type === "markdown") {
      // A Zeff block kept whole in the cell's metadata comes back as that block (checked like any page's); else the text is Markdown.
      if (z.node && typeof z.node === "object") content.push(z.node as DocNode);
      else content.push(...markdownToDoc(source).content);
    } else if (cell.cell_type === "raw" && source.trim()) content.push({ type: "codeBlock", attrs: { language: "" }, content: [{ type: "text", text: source }] });
  }
  const doc = sanitizeDoc({ type: "doc", content: content.length ? content : [{ type: "paragraph" }] });
  const title = String(zeffMeta.title ?? "").trim() || String((meta as { title?: unknown }).title ?? "").trim() || fallbackTitle;
  return { title: title.slice(0, 200), doc };
}
