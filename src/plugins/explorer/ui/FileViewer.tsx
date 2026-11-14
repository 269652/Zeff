"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { Markdown } from "@/components/Markdown";
import { darkPage, setupMonaco } from "@/components/monaco";
import { toast } from "@/components/Toaster";
import { confirmAction } from "@/components/confirm";
import { formatDateTime } from "@/lib/format";
import { sizeText } from "@/plugins/documents/shared";
import { fileUrl, parseCsv, type Opened } from "../shared";
import { importFilesAction, openHereAction, saveFileAction } from "../server-actions";

/**
 * The Explorer's viewer: a file shown as what it is — text and code in an editor (saved with Ctrl+S), Markdown and CSV as a
 * preview or as text, pictures, PDFs, audio and video as the browser shows them, Office files as the text Documents reads out of
 * them. Above it: import into Documents, open with this computer's program, show in Windows Explorer, download.
 */
export function FileViewer({ file, canOpen, onClose, onChanged }: { file: Opened; canOpen: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [text, setText] = useState(file.text ?? "");
  const [mtime, setMtime] = useState(file.mtime);
  const [size, setSize] = useState(file.size);
  const [saved, setSaved] = useState(file.text ?? "");
  const [mode, setMode] = useState<"preview" | "edit">(file.view === "markdown" || file.view === "csv" ? "preview" : "edit");
  const dirty = file.editable && text !== saved;
  // (What the editor's Ctrl+S and the page's leave-warning read: kept current after each render.)
  const live = useRef({ dirty, save: () => {} });

  const save = () => {
    if (!file.editable) return;
    const value = text;
    start(async () => {
      const r = await saveFileAction(file.path, value, mtime);
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setMtime(r.mtime);
      setSize(r.size);
      setSaved(value);
      toast(r.message, { tone: "ok" });
      onChanged();
    });
  };
  useEffect(() => {
    live.current = { dirty, save };
  });

  // A page left with unsaved changes asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (live.current.dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const close = () => {
    if (dirty && !confirmAction(t("Close without saving your changes?"))) return;
    onClose();
  };
  const act = (f: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await f();
      if (!r.ok) return void toast(r.error, { tone: "error" });
      toast(r.message, { tone: "ok" });
      onChanged();
    });

  const onMount: OnMount = (ed, monaco) => {
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => live.current.save());
  };
  setupMonaco();

  const inDocs = file.docId !== null;
  const textual = file.view === "text" || file.view === "markdown" || file.view === "csv";
  const rows = useMemo(() => (file.view === "csv" && mode === "preview" ? parseCsv(text, file.name.toLowerCase().endsWith(".tsv")) : []), [file.view, file.name, mode, text]);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={file.name} data-explorer-dirty={dirty || undefined}>
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="min-w-0 flex-1 basis-48">
          <h3 className="truncate text-sm font-semibold" title={file.path}>
            {file.name}
            {dirty && <span className="ml-1 text-amber-600" title={t("Not saved")}>●</span>}
          </h3>
          <p className="text-xs text-zinc-500">
            {sizeText(size)} · {formatDateTime(new Date(mtime).toISOString())}
            {inDocs && <> · <a className="underline" href="/documents">{file.changed ? t("in Documents (changed since)") : t("in Documents")}</a></>}
          </p>
        </div>
        {(file.view === "markdown" || file.view === "csv") && (
          <div className="flex overflow-hidden rounded-md border border-zinc-200 text-xs dark:border-zinc-700" role="tablist">
            {(["preview", "edit"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} className={`px-2 py-1 ${mode === m ? "bg-zinc-200 dark:bg-zinc-700" : ""}`} onClick={() => setMode(m)}>
                {m === "preview" ? (file.view === "csv" ? t("Table") : t("Preview")) : file.editable ? t("Edit") : t("Text")}
              </button>
            ))}
          </div>
        )}
        {file.editable && (
          <button className="btn btn-sm btn-primary" disabled={!dirty || pending} onClick={save} title="Ctrl+S">
            {t("Save")}
          </button>
        )}
        {file.importable && (!inDocs || file.changed) && (
          <button className="btn btn-sm" disabled={pending || dirty} onClick={() => act(async () => importFilesAction([file.path]))}>
            {inDocs ? t("Update in Documents") : t("Import to Documents")}
          </button>
        )}
        {canOpen && (
          <>
            <button className="btn btn-sm" disabled={pending} onClick={() => act(() => openHereAction(file.path, false))} title={t("Open with this computer's program for it")}>
              {t("Open")}
            </button>
            <button className="btn btn-sm" disabled={pending} onClick={() => act(() => openHereAction(file.path, true))}>
              {t("Show in folder")}
            </button>
          </>
        )}
        <a className="btn btn-sm" href={fileUrl(file.path, true)} download={file.name}>
          {t("Download")}
        </a>
        <button className="btn btn-sm" onClick={close} aria-label={t("Close")}>
          ✕
        </button>
      </header>

      {file.readOnlyWhy && <p className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">{file.readOnlyWhy}</p>}

      <div className="min-h-0 flex-1 overflow-auto">
        {textual && file.text !== null && mode === "edit" && (
          <div className="h-full min-h-[420px]">
            <Editor
              value={text}
              language={file.language}
              theme={darkPage() ? "vs-dark" : "light"}
              onChange={(v) => setText(v ?? "")}
              onMount={onMount}
              options={{ readOnly: !file.editable, minimap: { enabled: false }, wordWrap: file.view === "text" && file.language !== "plaintext" ? "off" : "on", fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true }}
            />
          </div>
        )}
        {file.view === "markdown" && mode === "preview" && <Markdown text={text} className="prose prose-sm max-w-none p-4 dark:prose-invert" />}
        {file.view === "csv" && mode === "preview" && (
          <table className="min-w-full border-collapse text-xs">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={i === 0 ? "sticky top-0 bg-zinc-100 font-semibold dark:bg-zinc-800" : "border-t border-zinc-100 dark:border-zinc-800"}>
                  {r.map((c, j) => (
                    <td key={j} className="max-w-[24ch] truncate px-2 py-1" title={c}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {file.view === "image" && (
          <div className="flex h-full items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-900">
            {/* eslint-disable-next-line @next/next/no-img-element -- a file of this computer, not a page asset */}
            <img src={`${fileUrl(file.path)}&v=${mtime}`} alt={file.name} className="max-h-full max-w-full object-contain" />
          </div>
        )}
        {file.view === "pdf" && <iframe src={`${fileUrl(file.path)}&v=${mtime}`} title={file.name} className="h-full min-h-[560px] w-full border-0" />}
        {file.view === "audio" && (
          <div className="p-6">
            <audio src={fileUrl(file.path)} controls className="w-full" />
          </div>
        )}
        {file.view === "video" && (
          <div className="flex h-full items-center justify-center bg-black">
            <video src={fileUrl(file.path)} controls className="max-h-full max-w-full" />
          </div>
        )}
        {file.view === "office" && (file.text !== null ? <pre className="whitespace-pre-wrap p-4 font-sans text-sm">{file.text || t("No text in it.")}</pre> : null)}
        {file.view === "none" && (
          <p className="p-6 text-sm text-zinc-500">
            {canOpen ? t("Zeff can't show this kind of file — open it with this computer's program, or download it.") : t("Zeff can't show this kind of file — download it.")}
          </p>
        )}
      </div>
    </section>
  );
}
