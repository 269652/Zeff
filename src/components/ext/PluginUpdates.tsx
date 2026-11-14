"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { installFromSourceAction, pluginUpdatesAction, putOffUpdateAction, type UpdatesView } from "@/lib/ext/source-actions";
import { MergeResolver } from "./MergeResolver";

/**
 * The update notes, on every page: a newer version of a plugin was published in its repository (found by the half-hourly check, or when
 * packages.json changed) — what it brings (the commits since your version), Update on a click (merged with what you changed here), or
 * Later (this version isn't offered again). An update waiting for its conflicts says so and opens the merge. Asked every five minutes and
 * when the tab comes back.
 */
const EVERY = 5 * 60_000;

export function PluginUpdates() {
  const t = useT();
  const router = useRouter();
  const [view, setView] = useState<UpdatesView | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await pluginUpdatesAction(false).catch(() => null);
    if (r?.ok) setView({ updates: r.updates, packages: r.packages });
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 4000);
    const every = setInterval(() => document.visibilityState === "visible" && void load(), EVERY);
    const back = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", back);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener("visibilitychange", back);
    };
  }, [load]);

  const updates = view?.updates ?? [];
  if (!updates.length && !merging) return null;
  const update = async (u: (typeof updates)[number]) => {
    if (u.conflicts.length || !u.sourceId) return setMerging(u.id);
    setBusy(u.id);
    const r = await installFromSourceAction(u.sourceId, u.id);
    setBusy(null);
    if (!r.ok) return void toast(r.error, { tone: "error", ms: 12000 });
    toast(r.message, { tone: "ok", ms: 12000 });
    if (r.conflicts.length) setMerging(u.id);
    await load();
    router.refresh();
  };
  const later = async (u: (typeof updates)[number]) => {
    await putOffUpdateAction(u.id, u.to);
    await load();
  };
  const waiting = updates.filter((u) => u.conflicts.length).length;
  return (
    <>
      {updates.length > 0 && (
        <aside className="fixed right-4 bottom-4 z-40 w-[min(24rem,calc(100vw-2rem))] print:hidden" aria-label={t("Plugin updates")}>
          {!open ? (
            <button type="button" className="ml-auto flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-800 shadow-lg hover:bg-indigo-50 dark:border-indigo-900 dark:bg-zinc-900 dark:text-indigo-200 dark:hover:bg-indigo-950" onClick={() => setOpen(true)}>
              <span aria-hidden>🧩</span>
              {updates.length === 1
                ? waiting
                  ? t("{name} {to} waits for you", { name: updates[0].name, to: updates[0].to })
                  : t("{name} {to} is out", { name: updates[0].name, to: updates[0].to })
                : waiting
                  ? t("{n} plugin updates · {c} wait for you", { n: updates.length, c: waiting })
                  : t("{n} plugin updates", { n: updates.length })}
            </button>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-3 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
              <header className="mb-2 flex items-center gap-2">
                <span aria-hidden>🧩</span>
                <h2 className="flex-1 text-sm font-semibold">{t("Plugin updates")}</h2>
                <button type="button" className="rounded px-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={t("Close")} onClick={() => setOpen(false)}>
                  ✕
                </button>
              </header>
              <ul className="space-y-3">
                {updates.map((u) => (
                  <li key={u.id} className="rounded-xl border border-zinc-200 p-2.5 dark:border-zinc-800">
                    <div className="flex items-baseline gap-2">
                      <b className="min-w-0 flex-1 truncate text-sm">{u.name}</b>
                      <span className="text-xs text-zinc-500 tabular-nums">
                        {u.from ?? "—"} → <b className="text-zinc-800 dark:text-zinc-100">{u.to}</b>
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-zinc-400" title={u.source}>
                      {u.source}
                    </p>
                    {u.conflicts.length > 0 && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        {u.conflicts.length === 1 ? t("Waits for you: a conflict with what you changed ({files})", { files: u.conflicts[0] }) : t("Waits for you: {n} conflicts with what you changed ({files})", { n: u.conflicts.length, files: u.conflicts.slice(0, 3).join(", ") })}
                      </p>
                    )}
                    {u.notes.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                        {(notes === u.id ? u.notes : u.notes.slice(0, 3)).map((n) => (
                          <li key={n.sha} className="flex gap-1.5">
                            <span aria-hidden className="text-zinc-300">•</span>
                            <span className="min-w-0 flex-1">{n.subject}</span>
                          </li>
                        ))}
                        {u.notes.length > 3 && notes !== u.id && (
                          <li>
                            <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => setNotes(u.id)}>
                              {t("{n} more changes", { n: u.notes.length - 3 })}
                            </button>
                          </li>
                        )}
                      </ul>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy === u.id} onClick={() => void update(u)}>
                        {busy === u.id ? t("Working …") : u.conflicts.length ? t("Settle the conflicts") : t("Update")}
                      </button>
                      {!u.conflicts.length && (
                        <button type="button" className="btn btn-sm" onClick={() => void later(u)}>
                          {t("Later")}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-zinc-400">{t("What you changed in a plugin is merged with the new version; where both changed the same lines, you decide.")}</p>
            </div>
          )}
        </aside>
      )}
      {merging && (
        <MergeResolver
          pluginId={merging}
          onClose={() => {
            setMerging(null);
            void load();
          }}
        />
      )}
    </>
  );
}
