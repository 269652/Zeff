"use client";

import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { darkPage, setupMonaco } from "@/components/monaco";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { deleteLambdaAction, duplicateLambdaAction, installLambdaAction, lambdaAction, lambdaTypesAction, saveLambdaAction, testLambdaAction } from "../server-actions";
import { LAMBDA_DTS, LAMBDA_SCHEMA } from "./lambda-editor-types";

/**
 * A lambda in the Studio's IDE: its files on the left (lambda.json — its manifest — index.mjs and whatever else it has), each in the
 * editor of VS Code (Monaco: highlighting, completion with the types of event and context and of its packages, the manifest checked
 * against its schema, errors as you type); a test that runs what is in the editor (saved or not) with an event — a search, a hit's
 * details, any JSON — and shows its output checked, its log and how long it took; its npm packages installed. Ctrl+S saves,
 * Ctrl+Enter runs the test.
 */

setupMonaco();

type Files = Record<string, string>;
type Meta = { name: string; kind: "lookup" | "function"; builtin: boolean; changed: boolean };
type TestRun = { run: { ok: boolean; result?: unknown; error?: string; stack?: string; logs: string[]; ms: number }; problems: string[] };

const langOf = (f: string) => (f.endsWith(".json") ? "json" : f.endsWith(".md") ? "markdown" : f.endsWith(".txt") ? "plaintext" : "javascript");
const uriOf = (f: string) => `file:///${f}`;
const order = (a: string, b: string) => (a === "lambda.json" ? -1 : b === "lambda.json" ? 1 : a === "index.mjs" ? -1 : b === "index.mjs" ? 1 : a.localeCompare(b));

let configured = false;
function configure(monaco: Monaco) {
  if (configured) return;
  configured = true;
  const js = monaco.languages.typescript.javascriptDefaults;
  js.setCompilerOptions({ target: monaco.languages.typescript.ScriptTarget.ESNext, module: monaco.languages.typescript.ModuleKind.ESNext, moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs, allowJs: true, checkJs: true, allowNonTsExtensions: true, lib: ["esnext", "dom"] });
  js.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: [80001, 7016, 2307] });
  js.addExtraLib(LAMBDA_DTS, "file:///zeff-lambda.d.ts");
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: false, schemas: [{ uri: "zeff://lambda.schema.json", fileMatch: ["file:///lambda.json"], schema: LAMBDA_SCHEMA }] });
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export function LambdaIDE({ name, onChanged, onOpen, onList }: { name: string; onChanged: () => void; onOpen: (name: string) => void; /** Shows the list of lambdas again (it folds while one is open). */ onList?: () => void }) {
  const t = useT();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [files, setFiles] = useState<Files>({});
  const [saved, setSaved] = useState("");
  const [file, setFile] = useState("index.mjs");
  const [event, setEvent] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TestRun | null>(null);
  const [busy, setBusy] = useState<"" | "test" | "install" | "save">("");
  const [installLog, setInstallLog] = useState("");
  const [full, setFull] = useState(false);
  const [dark] = useState(darkPage);
  const monacoRef = useRef<Monaco | null>(null);
  const libs = useRef<{ dispose(): void }[]>([]);
  // (The keyboard's commands run with what is in the editor now.)
  const latest = useRef({ save: () => undefined as unknown, test: () => undefined as unknown });

  const load = useCallback(async () => {
    const r = await lambdaAction(name);
    if (!r.ok) return toast(r.error, { tone: "error" });
    const l = r.lambda;
    const all: Files = { "lambda.json": pretty(l.manifest), ...l.files };
    setFiles(all);
    setSaved(JSON.stringify(all));
    setMeta({ name: l.manifest.name, kind: l.manifest.kind, builtin: l.builtin, changed: l.changed });
    setEvent(pretty(l.manifest.kind === "lookup" ? { mode: "search", query: "Dune", language: "de-DE" } : { name: "Zeff" }));
    setResult(null);
  }, [name]);
  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // Every file a model of its own: an import of ./lib.mjs finds it, the completion knows what it exports.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    for (const [f, code] of Object.entries(files)) {
      const uri = monaco.Uri.parse(uriOf(f));
      const m = monaco.editor.getModel(uri);
      if (!m) monaco.editor.createModel(code, langOf(f), uri);
      else if (m.getValue() !== code) m.setValue(code);
    }
    for (const m of monaco.editor.getModels()) {
      const f = m.uri.path.replace(/^\//, "");
      if (m.uri.scheme === "file" && !f.startsWith("node_modules/") && !f.startsWith("__") && f !== "zeff-lambda.d.ts" && !(f in files)) m.dispose();
    }
  }, [files]);

  const dirty = JSON.stringify(files) !== saved;
  const manifest = useMemo(() => {
    try {
      return JSON.parse(files["lambda.json"] ?? "{}") as { kind?: string; dependencies?: Record<string, string>; fields?: Record<string, string> };
    } catch {
      return null;
    }
  }, [files]);

  const loadTypes = useCallback(async (fs: Files) => {
    const monaco = monacoRef.current;
    if (!monaco || !Object.keys(JSON.parse(fs["lambda.json"] || "{}").dependencies ?? {}).length) return;
    const r = await lambdaTypesAction(fs);
    if (!r.ok) return;
    for (const d of libs.current) d.dispose();
    libs.current = r.libs.map((x) => monaco.languages.typescript.javascriptDefaults.addExtraLib(x.content, x.path));
  }, []);

  const save = async () => {
    setBusy("save");
    const r = await saveLambdaAction(files, meta?.name);
    setBusy("");
    if (!r.ok) return toast(r.error, { tone: "error" });
    toast(t("Saved."), { tone: "ok" });
    onChanged();
    if (r.lambda.manifest.name !== meta?.name) return onOpen(r.lambda.manifest.name);
    await load();
  };

  const test = async (ev?: unknown) => {
    let e: unknown = ev;
    if (e === undefined) {
      try {
        e = JSON.parse(event);
      } catch (err) {
        return toast(`${t("The event")}: ${(err as Error).message}`, { tone: "error" });
      }
    } else setEvent(pretty(e));
    setBusy("test");
    const r = await testLambdaAction(files, e);
    setBusy("");
    if (!r.ok) return toast(r.error, { tone: "error" });
    setResult(r as TestRun);
  };

  const install = async () => {
    setBusy("install");
    const r = await installLambdaAction(files);
    setBusy("");
    if (!r.ok) return toast(r.error, { tone: "error" });
    setInstallLog(r.log || (r.ok ? t("Nothing to install.") : ""));
    await loadTypes(files);
  };

  useEffect(() => {
    latest.current = { save: () => void save(), test: () => void test() };
  });
  // Full screen: Esc (outside the editor, where it closes its own widgets) goes back.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement | null)?.closest(".monaco-editor") && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const onMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    // eslint-disable-next-line no-bitwise -- Monaco's key chords are bit masks
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => latest.current.save());
    // eslint-disable-next-line no-bitwise -- Monaco's key chords are bit masks
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => latest.current.test());
    setFiles((f) => ({ ...f }));
    void loadTypes(files);
  };

  const addFile = () => {
    const f = window.prompt(t("New file (e.g. parse.mjs)"), "util.mjs");
    if (!f) return;
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.(mjs|js|json|txt|md)$/.test(f) || f in files) return toast(t("That name can't be used (letters, digits, - _ . ending in .mjs, .js, .json, .txt, .md)."), { tone: "error" });
    setFiles((x) => ({ ...x, [f]: f.endsWith(".mjs") || f.endsWith(".js") ? "export function helper() {}\n" : "" }));
    setFile(f);
  };
  const removeFile = (f: string) => {
    if (!window.confirm(t("Delete {file}?", { file: f }))) return;
    setFiles((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== f)));
    setFile("index.mjs");
  };
  const reset = async () => {
    if (!meta || !window.confirm(meta.builtin ? t("Throw your changes away and take Zeff's again?") : t("Delete this lambda?"))) return;
    const r = await deleteLambdaAction(meta.name);
    if (!r.ok) return toast(r.error, { tone: "error" });
    onChanged();
    if (meta.builtin) await load();
    else onOpen("");
  };
  const duplicate = async () => {
    if (!meta) return;
    const as = window.prompt(t("Name of the copy (lowercase, dots)"), `my.${meta.name}`);
    if (!as) return;
    const r = await duplicateLambdaAction(meta.name, as);
    if (!r.ok) return toast(r.error, { tone: "error" });
    onChanged();
    onOpen(r.lambda.manifest.name);
  };
  const addDep = () => {
    const spec = window.prompt(t("An npm package (name or name@version)"), "");
    if (!spec || !manifest) return;
    const m = /^(@?[^@\s]+)(?:@(.+))?$/.exec(spec.trim());
    if (!m) return;
    const next = { ...manifest, dependencies: { ...(manifest.dependencies ?? {}), [m[1]]: m[2] ?? "*" } };
    setFiles((x) => ({ ...x, "lambda.json": pretty(next) }));
  };

  if (!meta) return <p className="text-sm text-zinc-500">{t("Loading …")}</p>;
  const lookup = manifest?.kind !== "function";
  const out = result?.run;

  return (
    <div className={`@container flex flex-col gap-2 ${full ? "fixed inset-0 z-50 h-dvh bg-zinc-50 p-3 dark:bg-zinc-950" : "h-[calc(100dvh-7.5rem)] min-h-[34rem]"}`}>
      <header className="flex flex-wrap items-center gap-2">
        {onList && !full && (
          <button type="button" className="btn btn-sm" onClick={onList} title={t("All lambdas")}>
            ☰ {t("Lambdas")}
          </button>
        )}
        <span className="text-lg" aria-hidden>
          λ
        </span>
        <h2 className="font-mono text-base font-semibold">{meta.name}</h2>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] dark:bg-zinc-800">{lookup ? t("lookup") : t("function")}</span>
        {meta.builtin && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-700 dark:bg-sky-950 dark:text-sky-300">{meta.changed ? t("Zeff's, changed by you") : t("Zeff's")}</span>}
        {dirty && <span className="text-xs text-amber-600">● {t("not saved")}</span>}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-sm" onClick={() => void duplicate()}>
            {t("Duplicate")}
          </button>
          {(!meta.builtin || meta.changed) && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void reset()}>
              {meta.builtin ? t("Back to Zeff's") : t("Delete")}
            </button>
          )}
          <button type="button" className="btn btn-sm" disabled={busy !== ""} onClick={() => void test()} title="Ctrl+Enter">
            ▶ {busy === "test" ? t("Running …") : t("Test")}
          </button>
          <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || busy !== ""} onClick={() => void save()} title="Ctrl+S">
            {t("Save")}
          </button>
          <button type="button" className="btn btn-sm" aria-pressed={full} title={full ? t("Leave full screen (Esc)") : t("Full screen")} aria-label={full ? t("Leave full screen (Esc)") : t("Full screen")} onClick={() => setFull((f) => !f)}>
            {full ? "⤡" : "⤢"}
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[8.5rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_16rem] gap-2 @[72rem]:grid-cols-[9.5rem_minmax(0,1fr)_23rem] @[72rem]:grid-rows-1">
        {/* The files and the packages. */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-xl border border-zinc-200 p-2 text-sm dark:border-zinc-800">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label mb-0">{t("Files")}</span>
              <button type="button" className="icon-btn size-6" aria-label={t("New file")} title={t("New file")} onClick={addFile}>
                +
              </button>
            </div>
            <ul className="space-y-0.5">
              {Object.keys(files)
                .sort(order)
                .map((f) => (
                  <li key={f} className="group flex items-center">
                    <button type="button" className={`min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left font-mono text-xs ${f === file ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`} onClick={() => setFile(f)}>
                      {f === "lambda.json" ? "⚙ " : "📄 "}
                      {f}
                    </button>
                    {f !== "lambda.json" && f !== "index.mjs" && (
                      <button type="button" className="icon-btn icon-btn-danger size-5 opacity-0 group-hover:opacity-100" aria-label={t("Delete {file}?", { file: f })} onClick={() => removeFile(f)}>
                        ×
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label mb-0">{t("Packages")}</span>
              <button type="button" className="icon-btn size-6" aria-label={t("Add a package")} title={t("Add a package")} onClick={addDep}>
                +
              </button>
            </div>
            <ul className="space-y-0.5 font-mono text-xs">
              {Object.entries(manifest?.dependencies ?? {}).map(([k, v]) => (
                <li key={k} className="truncate">
                  {k} <span className="text-zinc-500">{v}</span>
                </li>
              ))}
              {!Object.keys(manifest?.dependencies ?? {}).length && <li className="text-zinc-500">{t("none — fetch is there")}</li>}
            </ul>
            {Object.keys(manifest?.dependencies ?? {}).length > 0 && (
              <button type="button" className="btn btn-sm mt-1 w-full" disabled={busy !== ""} onClick={() => void install()}>
                {busy === "install" ? t("Installing …") : t("Install")}
              </button>
            )}
            {installLog && <pre className="mt-1 max-h-32 overflow-auto rounded bg-zinc-50 p-1 text-[10px] whitespace-pre-wrap dark:bg-zinc-950">{installLog}</pre>}
          </div>
        </aside>

        {/* The editor. */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
          <div className="flex gap-0.5 overflow-x-auto border-b border-zinc-200 bg-zinc-50 px-1 pt-1 dark:border-zinc-800 dark:bg-zinc-900">
            {Object.keys(files)
              .sort(order)
              .map((f) => (
                <button key={f} type="button" className={`rounded-t-md px-2.5 py-1 font-mono text-xs ${f === file ? "bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`} onClick={() => setFile(f)}>
                  {f}
                </button>
              ))}
          </div>
          <div className="min-h-0 flex-1">
            <Editor
              path={uriOf(file)}
              language={langOf(file)}
              value={files[file] ?? ""}
              theme={dark ? "vs-dark" : "vs"}
              beforeMount={configure}
              onMount={onMount}
              onChange={(v) => setFiles((x) => ({ ...x, [file]: v ?? "" }))}
              options={{ fontSize: 13, minimap: { enabled: true }, scrollBeyondLastLine: false, tabSize: 2, automaticLayout: true, wordWrap: "on", fixedOverflowWidgets: true, quickSuggestions: { other: true, strings: true, comments: false }, suggest: { showWords: false }, bracketPairColorization: { enabled: true }, guides: { bracketPairs: true } }}
              loading={<p className="p-3 text-sm text-zinc-500">{t("Loading the editor …")}</p>}
            />
          </div>
        </div>

        {/* The test. */}
        <aside className="col-span-2 flex min-h-0 flex-col gap-2 overflow-y-auto rounded-xl border border-zinc-200 p-2 @[72rem]:col-span-1 dark:border-zinc-800">
          <span className="label mb-0">{t("Test")}</span>
          {lookup && (
            <form className="flex gap-1.5" onSubmit={(e) => (e.preventDefault(), void test({ mode: "search", query, language: "de-DE" }))}>
              <input className="input py-1 text-sm" placeholder={t("Search for …")} value={query} onChange={(e) => setQuery(e.target.value)} />
              <button type="submit" className="btn btn-sm" disabled={busy !== "" || !query.trim()}>
                {t("Search")}
              </button>
            </form>
          )}
          <div className="h-36 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
            <Editor path="file:///__event.json" language="json" value={event} theme={dark ? "vs-dark" : "vs"} onChange={(v) => setEvent(v ?? "")} options={{ fontSize: 12, minimap: { enabled: false }, lineNumbers: "off", scrollBeyondLastLine: false, automaticLayout: true, folding: false }} />
          </div>
          {out && (
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 font-medium ${out.ok && !result.problems.length ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}>{out.ok ? (result.problems.length ? t("doesn't fit") : t("ok")) : t("failed")}</span>
                <span className="font-mono text-zinc-500">{out.ms} ms</span>
              </div>
              {out.error && <pre className="overflow-x-auto rounded bg-red-50 p-2 whitespace-pre-wrap text-red-800 dark:bg-red-950/40 dark:text-red-300">{out.error}{out.stack ? `\n\n${out.stack}` : ""}</pre>}
              {result.problems.length > 0 && (
                <ul className="space-y-0.5 rounded bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  {result.problems.map((p) => (
                    <li key={p}>⚠ {p}</li>
                  ))}
                </ul>
              )}
              {lookup && out.ok && Array.isArray((out.result as { hits?: unknown[] })?.hits) && (
                <ul className="space-y-1">
                  {((out.result as { hits: { id: string; title: string; subtitle?: string; image?: string }[] }).hits ?? []).slice(0, 8).map((h) => (
                    <li key={String(h.id)}>
                      <button type="button" className="flex w-full gap-2 rounded border border-zinc-200 p-1.5 text-left hover:border-indigo-300 dark:border-zinc-800" title={t("Its details")} onClick={() => void test({ mode: "details", id: String(h.id), language: "de-DE" })}>
                        {h.image ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a source's own picture, linked
                          <img src={h.image} alt="" className="h-10 w-7 shrink-0 rounded object-cover" referrerPolicy="no-referrer" />
                        ) : null}
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{h.title}</span>
                          {h.subtitle && <span className="block truncate text-zinc-500">{h.subtitle}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {out.ok && (
                <details open={!lookup || !Array.isArray((out.result as { hits?: unknown[] })?.hits)}>
                  <summary className="cursor-pointer text-zinc-500">{t("Output")}</summary>
                  <pre className="max-h-80 overflow-auto rounded bg-zinc-50 p-2 dark:bg-zinc-950">{pretty(out.result)}</pre>
                </details>
              )}
              {out.logs.length > 0 && (
                <details open>
                  <summary className="cursor-pointer text-zinc-500">{t("Log")}</summary>
                  <pre className="max-h-40 overflow-auto rounded bg-zinc-50 p-2 whitespace-pre-wrap dark:bg-zinc-950">{out.logs.join("\n")}</pre>
                </details>
              )}
            </div>
          )}
          {!out && <p className="text-xs text-zinc-500">{lookup ? t("Search above, or run the event (Ctrl+Enter); a hit's click gives its details.") : t("Run the event (Ctrl+Enter).")}</p>}
        </aside>
      </div>
    </div>
  );
}
