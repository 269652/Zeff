"use client";

import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useReducer, useRef, useState } from "react";
import { answerPermissionAction, writeCodeAction, interruptCellAction, kernelCompleteAction, kernelVariablesAction, notebookStatusAction, readCellAction, restartKernelAction, runCellAction } from "@/plugins/notebook/server-actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { darkPage, setupMonaco } from "@/components/monaco";
import type { NbOutput } from "@/plugins/notebook/outputs";
import { GripBar } from "./app-nodes";
import { CellOutputs } from "./code-output";
import { COMPLETIONS, type CompleteItem } from "./code-complete";
import { Inline } from "./inline-edit";
import { giveName, usePage } from "./pipe-nodes";
import { Dropdown, MenuItem } from "./kit";

/**
 * A code cell in a page (codeCell): the language chosen per block — those of the installed Notebook plugins that can run here
 * (in Docker or on this computer) — an editor with highlighting and completion from the running session, Run (Shift+Enter),
 * Stop, Restart, the session's variables, and the outputs under it as a Jupyter notebook shows them. A page is one notebook:
 * the cells of a language share a session, so a variable of one cell is there in the next.
 */

type LangInfo = { id: string; label: string; monaco: string; where: "docker" | "host" | null };
type Status = { enabled: boolean; languages: LangInfo[] } | null;

let statusCache: { at: number; p: Promise<Status> } | null = null;
/** What the Notebook allows (read once in a while: the switch, the languages that can run). */
function loadStatus(force = false): Promise<Status> {
  if (!force && statusCache && Date.now() - statusCache.at < 15_000) return statusCache.p;
  const p = notebookStatusAction().then((r): Status => (r.ok ? { enabled: r.enabled, languages: r.languages.map((l) => ({ id: l.id, label: l.label, monaco: l.monaco, where: l.where })) } : null));
  statusCache = { at: Date.now(), p };
  return p;
}

/** The cells on screen, to run them in the order of the page ("Run all"). */
type Runner = { pageId: number; pos: () => number | undefined; run: () => Promise<boolean>; busy: () => boolean };
const runners = new Set<Runner>();
const runListeners = new Set<() => void>();
const tellRun = () => runListeners.forEach((f) => f());

/** How many code cells a page shows on screen, and whether one of them runs now (for the page's toolbar). */
export function useCellRunState(pageId: number): { cells: number; busy: boolean } {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    runListeners.add(bump);
    return () => void runListeners.delete(bump);
  }, []);
  const mine = [...runners].filter((r) => r.pageId === pageId);
  return { cells: mine.length, busy: mine.some((r) => r.busy()) };
}
export async function runAllCells(pageId: number, from?: number, to?: number): Promise<void> {
  const list = [...runners].filter((r) => r.pageId === pageId).map((r) => ({ r, pos: r.pos() })).filter((x): x is { r: Runner; pos: number } => x.pos !== undefined).sort((a, b) => a.pos - b.pos);
  for (const { r, pos } of list) {
    if (from !== undefined && pos < from) continue;
    if (to !== undefined && pos >= to) continue;
    if (!(await r.run())) break;
  }
}

/** For the editor's completion: which session and language a model belongs to. */
const cellOf = new Map<string, { session: () => string; language: () => string }>();
const completionFor = new Set<string>();
const KINDS = ["Variable", "Function", "Class", "Method", "Property"] as const;
const kindOf = (k: CompleteItem["kind"]) => KINDS[["variable", "function", "class", "method", "property"].indexOf(k)];

/**
 * What the editor completes: Zeff's own names in every language (the shared storage, zeff.*, inputs, display — code-complete.ts, there
 * with no session at all) and, when the session runs, what it knows (variables, modules), without doubling a name.
 */
function registerCompletion(monaco: Monaco, lang: string) {
  if (completionFor.has(lang)) return;
  completionFor.add(lang);
  monaco.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: ["."],
    async provideCompletionItems(model, position) {
      const own = COMPLETIONS[lang];
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: word.endColumn };
      const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
      const dotted = /([A-Za-z_$][\w$]*)\.$/.exec(before);
      const items: CompleteItem[] = own ? (dotted ? (own.members[dotted[1]] ?? (own.anyDot && model.getValue().includes(own.anyDot.when) ? own.anyDot.items : [])) : own.top) : [];
      const suggestions = items.map((i) => ({
        label: i.label,
        kind: monaco.languages.CompletionItemKind[kindOf(i.kind)],
        detail: i.detail,
        documentation: i.doc,
        insertText: i.snippet ?? i.label,
        ...(i.snippet ? { insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet } : {}),
        range,
        sortText: `0_${i.label}`,
      }));
      // What the running session knows, on top (a name Zeff gave already is not said twice).
      const meta = cellOf.get(model.uri.toString());
      if (meta) {
        const r = await kernelCompleteAction(meta.session(), meta.language(), model.getValue(), model.getOffsetAt(position));
        if (r.ok && r.items.length) {
          const a2 = model.getPositionAt(r.from);
          const b2 = model.getPositionAt(r.to);
          const range2 = { startLineNumber: a2.lineNumber, startColumn: a2.column, endLineNumber: b2.lineNumber, endColumn: b2.column };
          const have = new Set(suggestions.map((x) => String(x.label)));
          for (const label of r.items) if (!have.has(label) && !(dotted && label.startsWith(`${dotted[1]}.`) && have.has(label.slice(dotted[1].length + 1)))) suggestions.push({ label, kind: monaco.languages.CompletionItemKind.Variable, detail: "", documentation: "", insertText: label, range: range2, sortText: `1_${label}` } as (typeof suggestions)[number]);
        }
      }
      return { suggestions };
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Outputs as they are kept: images are dropped when the whole would be too big for a page. */
function fit(outputs: NbOutput[]): NbOutput[] {
  const json = JSON.stringify(outputs);
  if (json.length < 1_400_000) return outputs;
  return outputs.map((o) => (o.output_type === "display_data" || o.output_type === "execute_result" ? { ...o, data: Object.fromEntries(Object.entries(o.data).filter(([k]) => !k.startsWith("image/"))) } : o));
}

function parseOutputs(raw: unknown): NbOutput[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as NbOutput[]) : [];
  } catch {
    return [];
  }
}

/** What a cell returned, in a few words ("table 3 × 2", "a list of 5", "42"). */
function summarize(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as { cols?: unknown }).cols) && Array.isArray((v as { rows?: unknown }).rows)) return `table ${(v as { rows: unknown[] }).rows.length} × ${(v as { cols: unknown[] }).cols.length}`;
    if (Array.isArray(v)) return `list of ${v.length}`;
    if (v && typeof v === "object") return `object (${Object.keys(v).length} keys)`;
    return String(v).length > 40 ? `${String(v).slice(0, 40)}…` : String(v);
  } catch {
    return "";
  }
}

function parseInputs(raw: unknown): string[] {
  try {
    const v = typeof raw === "string" && raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

type Vars = { name: string; type: string; preview: string; shape?: string; size?: number }[];

function CodeCellView({ node, updateAttributes, editor, extension, getPos, deleteNode }: NodeViewProps) {
  const t = useT();
  const pageId = Number((extension.options as { pageId: number }).pageId) || 0;
  const session = `page-${pageId}`;
  const editable = editor.isEditable;
  const language = String(node.attrs.language || "python");
  const saved = String(node.attrs.source ?? "");
  const count = Number(node.attrs.count) || 0;
  const [status, setStatus] = useState<Status>(null);
  const [src, setSrc] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<NbOutput[] | null>(null);
  const [showVars, setShowVars] = useState(false);
  const [vars, setVars] = useState<Vars>([]);
  const [asks, setAsks] = useState<{ id: string; key: string; label: string; description: string; write: boolean }[]>([]);
  const execId = useRef("");
  // The AI writes the code: a description in the row under the header; what was there is kept to go back.
  const [aiOpen, setAiOpen] = useState(false);
  const [wish, setWish] = useState("");
  const [writing, setWriting] = useState(false);
  const [before, setBefore] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState("");
  const page = usePage(editor);
  const name = String(node.attrs.name ?? "");
  const inputs = parseInputs(node.attrs.inputs);
  const nameRef = useRef(name);
  const inputsRef = useRef(inputs);
  useEffect(() => {
    nameRef.current = name;
    inputsRef.current = parseInputs(node.attrs.inputs);
  });
  const [height, setHeight] = useState(60);
  const [dark] = useState(() => darkPage());
  const srcRef = useRef(src);
  const langRef = useRef(language);
  const busyRef = useRef(false);

  useEffect(() => {
    setupMonaco();
    void loadStatus().then(setStatus);
  }, []);
  // (What was written from outside — undo, the AI — shows unless it is being typed.)
  useEffect(() => {
    if (saved !== srcRef.current) {
      srcRef.current = saved;
      setSrc(saved);
    }
  }, [saved]);
  useEffect(() => {
    langRef.current = language;
  }, [language]);

  const info = status?.languages.find((l) => l.id === language);
  const outputs = live ?? parseOutputs(node.attrs.outputs);
  const commit = (v: string) => {
    srcRef.current = v;
    if (v !== String(node.attrs.source ?? "")) updateAttributes({ source: v });
  };

  const loadVars = async () => {
    const r = await kernelVariablesAction(session, langRef.current);
    if (r.ok) setVars(r.items);
  };

  const run = async (): Promise<boolean> => {
    if (busyRef.current) return false;
    const code = srcRef.current;
    commit(code);
    if (!code.trim()) return true;
    busyRef.current = true;
    setBusy(true);
    tellRun();
    setLive([]);
    let ok = true;
    try {
      const started = await runCellAction(session, langRef.current, code, inputsRef.current, nameRef.current);
      if (!started.ok) {
        toast(started.error, { tone: "error" });
        setLive(null);
        return false;
      }
      execId.current = started.id;
      let rev = -1;
      let last: NbOutput[] = [];
      for (;;) {
        await sleep(250);
        const p = await readCellAction(started.id, rev);
        if (!p.ok) {
          toast(p.error, { tone: "error" });
          ok = false;
          break;
        }
        rev = p.rev;
        setAsks(p.permissions);
        if (p.outputs) {
          last = p.outputs as NbOutput[];
          setLive(last);
        }
        if (p.status !== "queued" && p.status !== "running") {
          ok = p.status === "ok";
          updateAttributes({ outputs: JSON.stringify(fit(last)), count: p.count, ...(p.status === "ok" ? { result: p.returned !== undefined ? JSON.stringify(p.returned) : "" } : {}) });
          break;
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      tellRun();
      setLive(null);
      setAsks([]);
      if (showVars) void loadVars();
    }
    return ok;
  };
  const writeIt = async () => {
    if (writing || !wish.trim()) return;
    setWriting(true);
    // What the cell takes in, for the AI to know: a table's columns and a few rows (a database: only that it is one).
    const given = inputsRef.current.map((n) => {
      if (n.startsWith("db:")) return { name: page.dbs.find((d) => `db:${d.id}` === n)?.title ?? n, kind: "database" as const };
      const grid = page.tables.find((x) => x.name.trim().toLowerCase() === n.toLowerCase())?.grid ?? page.outcomes.get(n.toLowerCase())?.grid;
      return { name: n, kind: "table" as const, columns: grid?.cols ?? [], sample: (grid?.rows ?? []).slice(0, 3).map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))) };
    });
    const r = await writeCodeAction(langRef.current, wish, srcRef.current, given, nameRef.current);
    setWriting(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setBefore(srcRef.current);
    srcRef.current = r.code;
    setSrc(r.code);
    commit(r.code);
    setAiNote(r.note);
    setWish("");
  };
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  // Registered for "Run all", in the order the page has its cells.
  useEffect(() => {
    const r: Runner = { pageId, pos: () => (typeof getPos === "function" ? getPos() : undefined), run: () => runRef.current(), busy: () => busyRef.current };
    runners.add(r);
    tellRun();
    return () => {
      runners.delete(r);
      tellRun();
    };
  }, [pageId, getPos]);

  const onMount: OnMount = (ed, monaco) => {
    registerCompletion(monaco, info?.monaco ?? "python");
    const uri = ed.getModel()?.uri.toString();
    if (uri) cellOf.set(uri, { session: () => session, language: () => langRef.current });
    const size = () => setHeight(Math.min(420, Math.max(54, ed.getContentHeight() + 4)));
    ed.onDidContentSizeChange(size);
    size();
    ed.onDidBlurEditorText(() => commit(ed.getValue()));
    ed.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => void runRef.current());
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runRef.current());
  };

  const where = info?.where;
  const blocked = !status?.enabled ? t("Running code is off — turn it on in Settings → Notebook.") : !info ? t("This language is not available here.") : !where ? t("This language can run nowhere here (no Docker, not installed).") : "";
  const monacoLang = info?.monaco ?? (language === "node" ? "javascript" : language);
  const langs = status?.languages ?? [];

  const pos = typeof getPos === "function" ? getPos() : undefined;
  const runMany = (which: "all" | "below" | "above") => {
    if (pos === undefined) return;
    void runAllCells(pageId, which === "below" ? pos : undefined, which === "above" ? pos : undefined);
  };

  return (
    <NodeViewWrapper className="ws-module-block ws-code-cell my-2 rounded-lg border border-zinc-300 bg-white/70 dark:border-zinc-700 dark:bg-zinc-900/40" contentEditable={false}>
      <GripBar editor={editor} node={node} getPos={getPos} deleteNode={deleteNode} label={t("Code")} />
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700">
        <span className="w-12 shrink-0 font-mono text-zinc-400" title={t("Run number")}>{busy ? "[*]" : count ? `[${count}]` : "[ ]"}</span>
        {editable ? (
          <select className="input h-7 w-auto py-0 text-xs" value={language} aria-label={t("Language")} onChange={(e) => updateAttributes({ language: e.target.value })}>
            {!langs.some((l) => l.id === language) && <option value={language}>{language}</option>}
            {langs.map((l) => (
              <option key={l.id} value={l.id} disabled={!l.where}>
                {l.label}
                {l.where ? "" : ` (${t("not available")})`}
              </option>
            ))}
          </select>
        ) : (
          <span>{info?.label ?? language}</span>
        )}
        {where && <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[10px] text-zinc-500" title={where === "docker" ? t("Runs in a Docker container") : t("Runs on this computer")}>{where === "docker" ? "🐳 Docker" : t("This computer")}</span>}
        <span className="ml-auto flex items-center gap-1">
          {editable && (
            <button type="button" className={`btn btn-sm h-7 ${aiOpen ? "btn-primary" : ""}`} title={t("Describe it — the AI writes the code")} aria-expanded={aiOpen} onClick={() => setAiOpen((v) => !v)}>
              ✨ {t("AI")}
            </button>
          )}
          {editable && !busy && (
            <button type="button" className="btn btn-sm h-7" disabled={!!blocked} title={blocked || t("Run (Shift+Enter)")} onClick={() => void run()}>
              ▶ {t("Run")}
            </button>
          )}
          {editable && busy && (
            <button type="button" className="btn btn-sm h-7" title={t("Stop")} onClick={() => void interruptCellAction(session, language)}>
              ■ {t("Stop")}
            </button>
          )}
          {editable && (
            <Dropdown label="⋯" align="right" title={t("More")} ariaLabel={t("More")} className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-500/10">
              {(close) => (
                <div className="w-60">
                  <MenuItem disabled={!!blocked} onClick={() => (close(), runMany("all"))}>▶▶ {t("Run all cells of the page")}</MenuItem>
                  <MenuItem disabled={!!blocked} onClick={() => (close(), runMany("below"))}>⤓ {t("Run this and the cells below")}</MenuItem>
                  <MenuItem disabled={!!blocked} onClick={() => (close(), runMany("above"))}>⤒ {t("Run the cells above")}</MenuItem>
                  <MenuItem
                    onClick={() => {
                      close();
                      void restartKernelAction(session, language).then(() => {
                        setVars([]);
                        updateAttributes({ count: 0 });
                        toast(t("The session was restarted — its variables are gone."));
                      });
                    }}
                  >
                    ↻ {t("Restart the session")}
                  </MenuItem>
                  <MenuItem onClick={() => (close(), updateAttributes({ outputs: "" }))}>🧹 {t("Clear the output")}</MenuItem>
                  <MenuItem
                    onClick={() => {
                      close();
                      setShowVars((v) => !v);
                      if (!showVars) void loadVars();
                    }}
                  >
                    𝑥 {showVars ? t("Hide the variables") : t("Show the variables")}
                  </MenuItem>
                </div>
              )}
            </Dropdown>
          )}
        </span>
      </div>
      {aiOpen && editable && (
        <div className="space-y-1 border-b border-violet-200 bg-violet-50/50 px-2 py-1.5 text-xs dark:border-violet-900 dark:bg-violet-950/20">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden>✨</span>
            <input
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && wish.trim() && !writing) {
                  e.preventDefault();
                  void writeIt();
                }
              }}
              placeholder={src.trim() ? t("What should change? e.g. only rows over 50, sorted") : t("What should the code do? e.g. sum the amounts per category")}
              aria-label={t("Describe what the code should do")}
              className="input h-7 min-w-48 flex-1 py-0 text-xs"
            />
            <button type="button" className="btn btn-sm btn-primary h-7" disabled={writing || !wish.trim()} onClick={() => void writeIt()}>
              {writing ? "…" : src.trim() ? t("Change the code") : t("Write the code")}
            </button>
            {before !== null && (
              <button
                type="button"
                className="btn btn-sm h-7"
                onClick={() => {
                  srcRef.current = before;
                  setSrc(before);
                  commit(before);
                  setBefore(null);
                  setAiNote("");
                }}
                title={t("Bring back the code that was there before")}
              >
                ↶ {t("Undo")}
              </button>
            )}
          </div>
          {aiNote && <p className="pl-6 text-violet-700 dark:text-violet-300">{aiNote}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200 px-2 py-1 text-xs text-zinc-500 dark:border-zinc-700">
        <span className="flex flex-wrap items-center gap-1">
          <span className="font-semibold uppercase tracking-wide text-[10px] text-zinc-400">{t("Inputs")}</span>
          {inputs.map((i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200" title={t("In the code: inputs[\"{name}\"], and as a variable of that name", { name: i })}>
              {i.startsWith("db:") ? `🗃 ${page.dbs.find((d) => `db:${d.id}` === i)?.title ?? i}` : i}
              {editable && (
                <button type="button" aria-label={t("Remove this input")} className="text-sky-500 hover:text-red-600" onClick={() => updateAttributes({ inputs: JSON.stringify(inputs.filter((x) => x !== i)) })}>
                  ✕
                </button>
              )}
            </span>
          ))}
          {inputs.length === 0 && !editable && <span>{t("none")}</span>}
          {editable && (
            <Dropdown label={`＋ ${t("Input")}`} title={t("What this cell takes in")} ariaLabel={t("Add an input")} className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-zinc-500 hover:text-zinc-800 dark:border-zinc-600">
              {(close) => {
                const own = name.trim().toLowerCase();
                const taken = (n: string) => page.tables.some((x) => x.name.trim().toLowerCase() === n.toLowerCase()) || page.pipes.some((x) => x.name.trim().toLowerCase() === n.toLowerCase()) || page.results.some((x) => x.title.trim().toLowerCase() === n.toLowerCase());
                const choices: { value: string; label: string; make?: () => string }[] = [
                  ...page.tables.filter((x) => x.name.trim() && x.name.trim().toLowerCase() !== own).map((x) => ({ value: x.name, label: `▦ ${x.name}` })),
                  // (A table without a name is named when it is chosen: the code reads it by that name.)
                  ...page.tables.filter((x) => !x.name.trim()).map((x) => ({ value: `@table:${x.pos}`, label: `▦ ${t("Table")} ${page.tables.findIndex((y) => y.pos === x.pos) + 1} ${t("(gets a name)")}`, make: () => giveName(editor, page, x.pos, t("Table")) })),
                  ...page.pipes.filter((x) => x.name.trim() && x.name.trim().toLowerCase() !== own).map((x) => ({ value: x.name, label: `🔀 ${x.name}` })),
                  // (A result table — the calculated one — is a table too: it gets a title that names it.)
                  ...page.results.map((r, i) => ({
                    value: r.title.trim() || `@result:${r.pos}`,
                    label: `📋 ${r.title.trim() || `${t("Result table")} ${i + 1}`}${r.title.trim() ? "" : ` ${t("(gets a name)")}`}`,
                    make: () => {
                      let n = `${t("Result table")} ${i + 1}`;
                      while (taken(n)) n += "*";
                      const rn = editor.state.doc.nodeAt(r.pos);
                      if (rn?.type.name === "pipeResult") editor.view.dispatch(editor.state.tr.setNodeMarkup(r.pos, undefined, { ...rn.attrs, title: n }));
                      return n;
                    },
                  })),
                  ...page.dbs.map((d) => ({ value: `db:${d.id}`, label: `🗃 ${d.title}` })),
                ].filter((c, i, all) => all.findIndex((y) => y.value === c.value) === i);
                return (
                  <div className="w-64">
                    {choices.length === 0 && <p className="px-2 py-1.5 text-xs text-zinc-500">{t("No table, transform or database on this page yet.")}</p>}
                    {choices.map((c) => (
                      <MenuItem
                        key={c.value}
                        checked={inputs.includes(c.value)}
                        onClick={() => {
                          close();
                          const v = c.make ? c.make() : c.value;
                          updateAttributes({ inputs: JSON.stringify(inputs.includes(v) ? inputs.filter((x) => x !== v) : [...inputs, v]) });
                        }}
                      >
                        <span className="truncate">{c.label}</span>
                      </MenuItem>
                    ))}
                  </div>
                );
              }}
            </Dropdown>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold uppercase tracking-wide text-[10px] text-zinc-400">{t("Output")}</span>
          <Inline value={name} onCommit={(v) => updateAttributes({ name: v })} label={t("Name of this cell's output")} placeholder={t("Name (other blocks read it by this)")} readOnly={!editable} className="text-xs text-zinc-700 dark:text-zinc-200" />
          {summarize(node.attrs.result) && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300" title={t("What the cell returned last: its last expression, or return")}>
              ↩ {summarize(node.attrs.result)}
            </span>
          )}
        </span>
      </div>
      <div style={{ height }} className="overflow-hidden">
        <Editor
          language={monacoLang}
          path={`znb-${pageId}-${pos ?? 0}-${language}`}
          value={src}
          theme={dark ? "vs-dark" : "vs"}
          onMount={onMount}
          onChange={(v) => {
            srcRef.current = v ?? "";
            setSrc(v ?? "");
          }}
          options={{ readOnly: !editable, fontSize: 13, minimap: { enabled: false }, lineNumbers: "off", glyphMargin: false, folding: false, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", tabSize: 4, renderLineHighlight: "none", overviewRulerLanes: 0, hideCursorInOverviewRuler: true, scrollbar: { vertical: "hidden", alwaysConsumeMouseWheel: false }, padding: { top: 6, bottom: 6 }, fixedOverflowWidgets: true }}
          loading={<p className="p-3 text-sm text-zinc-500">{t("Loading the editor …")}</p>}
        />
      </div>
      {blocked && editable && <p className="border-t border-zinc-200 px-3 py-1.5 text-xs text-amber-700 dark:border-zinc-700 dark:text-amber-300">{blocked}</p>}
      {asks.map((a) => (
        <div key={a.id} className="space-y-1.5 border-t border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/30">
          <p className="font-medium text-amber-900 dark:text-amber-100">{a.write ? `✏️ ${t("This code wants to change Zeff: {what}.", { what: a.label })}` : `🔐 ${t("This code wants to read {what}.", { what: a.label })}`}</p>
          <p className="text-amber-800/80 dark:text-amber-200/80">{a.description} {t("It waits for your answer, then goes on.")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void answerPermissionAction(execId.current, a.id, "page")}>{t("Allow for this page")}</button>
            <button type="button" className="btn btn-sm" onClick={() => void answerPermissionAction(execId.current, a.id, "always")}>{t("Allow for every page")}</button>
            <button type="button" className="btn btn-sm" onClick={() => void answerPermissionAction(execId.current, a.id, "deny")}>{t("Don't allow")}</button>
          </div>
        </div>
      ))}
      <CellOutputs outputs={outputs} />
      {showVars && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <div className="mb-1 flex items-center gap-2 text-xs text-zinc-500">
            <span className="font-semibold">{t("Variables")}</span>
            <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => void loadVars()}>{t("Refresh")}</button>
          </div>
          {vars.length === 0 ? (
            <p className="text-xs text-zinc-400">{t("No variables (the session is not running, or nothing was defined yet).")}</p>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {vars.map((v) => (
                  <tr key={v.name} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-0.5 pr-2 font-mono font-semibold">{v.name}</td>
                    <td className="pr-2 text-zinc-500">{v.type}{v.shape ? ` ${v.shape}` : v.size !== undefined ? ` [${v.size}]` : ""}</td>
                    <td className="truncate font-mono text-zinc-600 dark:text-zinc-300">{v.preview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const CodeCellNode = Node.create<{ pageId: number }>({
  name: "codeCell",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { pageId: 0 };
  },
  addAttributes() {
    return { language: { default: "python" }, source: { default: "" }, outputs: { default: "" }, count: { default: 0 }, name: { default: "" }, inputs: { default: "" }, result: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-code-cell]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-code-cell": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeCellView);
  },
});
