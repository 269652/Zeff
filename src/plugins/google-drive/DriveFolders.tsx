"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { addPullFolderAction, listDriveFoldersAction, removePullFolderAction } from "./server-actions";

/**
 * Folders of your Drive Zeff reads: the ones chosen (each removable), and a browser of your Drive to choose one — My Drive,
 * then its folders, one level after the other. What you put in a chosen folder comes into the documents with the next sync.
 */
export function DriveFolders({ folders, connected, fullAccess }: { folders: { id: string; path: string }[]; connected: boolean; fullAccess: boolean }) {
  const t = useT();
  const router = useRouter();
  const root = t("My Drive");
  const [trail, setTrail] = useState<{ id: string; name: string }[] | null>(null);
  const [list, setList] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const open = async (next: { id: string; name: string }[]) => {
    setBusy(true);
    const r = await listDriveFoldersAction(next.at(-1)!.id);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setTrail(next);
    setList(r.folders);
  };
  const say = (r: { ok: boolean; message?: string; error?: string } | null | undefined) => {
    toast((r?.ok ? r.message : r?.error) ?? t("Didn't work."), { tone: r?.ok ? "ok" : "error" });
    router.refresh();
  };
  const here = trail ? trail.map((x) => x.name).join(" / ") : "";
  return (
    <section className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Folders of your Drive")}</h2>
      <p className="text-sm text-zinc-500">{t("Choose folders of your own Drive — e.g. where you keep your bank statements. What you put there comes into the documents with each sync; Zeff only reads there.")}</p>
      {folders.length > 0 && (
        <ul className="space-y-1 text-sm">
          {folders.map((f) => (
            <li key={f.id} className="flex items-center gap-2">
              <span aria-hidden>📁</span>
              <span className="min-w-0 flex-1 truncate">{f.path}</span>
              <button type="button" className="btn btn-sm" onClick={() => void removePullFolderAction(f.id).then(say)}>
                {t("Remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {folders.length > 0 && connected && !fullAccess && <p className="text-sm text-amber-700 dark:text-amber-400">{t("To read the files you put there, connect again — Google then asks for access to all of Drive.")}</p>}
      {!connected ? (
        <p className="text-sm text-zinc-400">{t("Connect Google Drive first (step 2) — then choose its folders here.")}</p>
      ) : trail === null ? (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void open([{ id: "root", name: root }])}>
          {busy ? "…" : t("Choose a folder …")}
        </button>
      ) : (
        <div className="space-y-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-1 text-sm">
            {trail.map((x, i) => (
              <span key={x.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-zinc-400">/</span>}
                <button type="button" className="hover:underline" disabled={busy} onClick={() => void open(trail.slice(0, i + 1))}>
                  {x.name}
                </button>
              </span>
            ))}
            <span className="ml-auto flex gap-1">
              <button type="button" className="btn btn-sm" onClick={() => setTrail(null)}>
                {t("Done")}
              </button>
            </span>
          </div>
          {busy ? (
            <p className="text-sm text-zinc-400">…</p>
          ) : list.length ? (
            <ul className="max-h-64 space-y-0.5 overflow-auto text-sm">
              {list.map((f) => {
                const chosen = folders.some((x) => x.id === f.id);
                return (
                  <li key={f.id} className="flex items-center gap-2 rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    {/* The name opens it (its folders); the button on the right takes it — as many as you like, the list stays open. */}
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left" title={t("Open")} onClick={() => void open([...trail, f])}>
                      <span aria-hidden>📁</span>
                      <span className="truncate">{f.name}</span>
                    </button>
                    {chosen ? (
                      <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">✓ {t("Chosen")}</span>
                    ) : (
                      <button type="button" className="btn btn-sm shrink-0" onClick={() => void addPullFolderAction({ id: f.id, path: `${here} / ${f.name}` }).then(say)}>
                        {t("Add")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-zinc-400">{t("No folders in here.")}</p>
          )}
        </div>
      )}
    </section>
  );
}
