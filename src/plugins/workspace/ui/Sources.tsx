"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { runSyncAction } from "@/app/actions";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { setBoardEnabledAction } from "@/plugins/jira/server-actions";
import { keepSourceDatabasesAction } from "../actions";
import type { SourceView } from "../sources";
import { SyncEvery } from "./pipeline";

/**
 * The Workspace's data sources: Jira (its boards switched on here, each a board database), Google Keep (a gallery
 * database), your todos — what each brings, the databases it keeps, Sync now.
 */
export function SourcesView({ sources }: { sources: SourceView[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const sync = (s: SourceView) =>
    start(async () => {
      const r = s.step ? await runSyncAction(s.step) : null;
      if (r && !r.ok) toast(r.error ?? t("Failed."), { tone: "error" });
      const d = await keepSourceDatabasesAction(s.key);
      if (!d.ok) toast(d.error, { tone: "error" });
      else toast(t("{name}: synced", { name: s.name }), { tone: "ok" });
      router.refresh();
    });
  const toggle = (boardId: number, on: boolean) =>
    start(async () => {
      const fd = new FormData();
      fd.set("boardId", String(boardId));
      if (on) fd.set("enabled", "on");
      await setBoardEnabledAction(fd);
      // Switched on: its database right away (switched off: it stays, Jira's sync doesn't change it any more).
      if (on) await keepSourceDatabasesAction("jira");
      router.refresh();
    });
  const info: Record<SourceView["key"], string> = {
    jira: t("Each board switched on is a board database here, kept by every Jira sync — read-only (Jira is where tickets change); My briefing a page over the briefing's tickets."),
    keep: t("Google Keep's notes as a gallery database, kept by every Keep sync — read-only."),
    todos: t("Your todos — to be taken in by a board or any database as a step of its pipeline (coming)."),
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("Data sources")}</h1>
        <p className="text-sm text-zinc-500">{t("What fills the Workspace's databases from elsewhere.")}</p>
      </div>
      {sources.map((s) => (
        <section key={s.key} className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{s.name}</h2>
            <span className="text-sm text-zinc-500">{s.key === "jira" ? t("{n} boards on", { n: s.count }) : s.key === "keep" ? t("{n} notes", { n: s.count }) : t("{n} open todos", { n: s.count })}</span>
            <span className="flex-1" />
            {s.setup && (
              <Link href={s.setup.href} className="btn btn-sm">
                {s.ready ? t("Settings") : t("Set up")}
              </Link>
            )}
            {s.step && (
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => sync(s)}>
                {pending ? "…" : t("Sync now")}
              </button>
            )}
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{info[s.key]}</p>
          {(s.key === "jira" || s.key === "keep") && <SyncEvery syncKey={s.key} name={s.name} />}
          {s.boards && (
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {s.boards.map((b) => (
                <li key={b.id} className="flex items-center gap-3 py-1.5">
                  <label className="flex flex-1 items-center gap-2">
                    <input type="checkbox" checked={b.enabled} disabled={pending} onChange={(e) => toggle(b.id, e.target.checked)} />
                    <span>{b.name}</span>
                    {b.project && <span className="font-mono text-xs text-zinc-400">{b.project}</span>}
                  </label>
                  {b.href ? (
                    <Link href={b.href} className="text-indigo-600 hover:underline dark:text-indigo-400">
                      {t("Open")} →
                    </Link>
                  ) : (
                    b.enabled && <span className="text-xs text-zinc-400">{t("Its database comes with the next sync.")}</span>
                  )}
                </li>
              ))}
              {!s.boards.length && <li className="py-1.5 text-zinc-500">{t("No Jira boards known yet — sync Jira first.")}</li>}
            </ul>
          )}
          {s.databases.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-500">{t("Databases")}:</span>
              {s.databases.map((d) => (
                <Link key={d.href} href={d.href} className="ws-chip hover:underline">
                  {d.title}
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
