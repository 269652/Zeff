"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { formatDateTime } from "@/lib/format";
import type { LocalFolder, FolderMode } from "./folders";
import { addFolderAction, browseFoldersAction, removeFolderAction, scanFoldersAction, setFolderModeAction } from "./server-actions";

type Listing = { path: string | null; parent: string | null; dirs: { name: string; path: string }[] };

/**
 * Settings → Documents → Local folders: folders on this computer whose documents Zeff reads in by itself (subfolders
 * too) — each either going on to the AI by itself or waiting for your confirmation. Added through a small browser of
 * the drives and folders, or by pasting a path.
 */
export function LocalFoldersForm({ folders }: { folders: LocalFolder[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [browsing, setBrowsing] = useState<Listing | null>(null);
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState<FolderMode>("confirm");
  const act = (f: () => Promise<{ error?: string; message?: string } | null | void>) =>
    start(async () => {
      const r = await f();
      if (r && "error" in r && r.error) return void toast(r.error, { tone: "error" });
      if (r && r.message) toast(r.message, { tone: "ok" });
      router.refresh();
    });
  const open = (path: string | null) =>
    start(async () => {
      const r = await browseFoldersAction(path);
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setBrowsing({ path: r.path, parent: r.parent, dirs: r.dirs });
    });
  const add = (path: string) => act(async () => {
    const r = await addFolderAction(path, mode);
    if (!r?.error) {
      setBrowsing(null);
      setTyped("");
    }
    return r;
  });
  const modes: [FolderMode, string][] = [
    ["confirm", t("Wait for my confirmation")],
    ["auto", t("Automatically")],
  ];

  return (
    <section id="folders" className="card space-y-4 p-4">
      <header className="space-y-1">
        <h2 className="text-base font-semibold">{t("Local folders")}</h2>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          {t(
            "Zeff reads in every document from these folders by itself (subfolders too) — new and changed files on each run, a deleted file stays as a document. “Automatically”: the AI reads, compiles and looks at them right away. “Wait for my confirmation”: only the text of plain files is read; the AI (reading scans and pictures, compiling, todos) waits until you confirm them in Documents.",
          )}
        </p>
      </header>

      {folders.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {folders.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1 basis-64">
                <span className="block truncate font-mono text-[13px]" title={f.path}>
                  📁 {f.path}
                </span>
                <span className="text-xs text-zinc-500">
                  {f.lastScanAt ? t("{n} documents · read in {when}", { n: f.files, when: formatDateTime(f.lastScanAt) }) : t("not read in yet")}
                </span>
              </span>
              <label className="sr-only" htmlFor={`mode-${f.id}`}>
                {t("When the AI may read it")}
              </label>
              <select id={`mode-${f.id}`} className="input w-auto" value={f.mode} disabled={pending} onChange={(e) => act(() => setFolderModeAction(f.id, e.target.value as FolderMode))}>
                {modes.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-sm text-red-600 dark:text-red-400" disabled={pending} onClick={() => act(() => removeFolderAction(f.id))}>
                {t("Remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{t("New folder:")}</span>
          <select className="input w-auto" value={mode} onChange={(e) => setMode(e.target.value as FolderMode)} aria-label={t("When the AI may read it")}>
            {modes.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => open(null)}>
            {t("Choose a folder …")}
          </button>
          {folders.length > 0 && (
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act(() => scanFoldersAction())}>
              {t("Read in now")}
            </button>
          )}
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) add(typed.trim());
          }}
        >
          <input className="input min-w-0 flex-1 font-mono text-[13px]" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("or paste a path, e.g. C:\\Users\\me\\Documents\\Rechnungen")} aria-label={t("Folder path")} />
          <button type="submit" className="btn btn-sm" disabled={pending || !typed.trim()}>
            {t("Add")}
          </button>
        </form>
      </div>

      {browsing && (
        <div className="space-y-2 rounded-lg border border-indigo-200 p-3 dark:border-indigo-900" role="dialog" aria-label={t("Choose a folder")}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => open(browsing.parent)} aria-label={t("Up")}>
              ↑ {browsing.parent ? t("Up") : t("Drives")}
            </button>
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{browsing.path ?? t("This computer")}</span>
            {browsing.path && (
              <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => add(browsing.path!)}>
                {t("Add this folder")}
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setBrowsing(null)}>
              {t("Cancel")}
            </button>
          </div>
          <ul className="max-h-72 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-800">
            {browsing.dirs.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">{t("No subfolders.")}</li>}
            {browsing.dirs.map((d) => (
              <li key={d.path}>
                <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800" disabled={pending} onClick={() => open(d.path)}>
                  📁 <span className="truncate">{d.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
