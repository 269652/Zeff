"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { runSyncAction } from "@/app/actions";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { setBoardEnabledAction } from "@/plugins/jira/server-actions";
import { convertTaskListAction, createSourceDatabaseAction, followTaskListAction, keepSourceDatabasesAction, taskListMetaAction } from "../actions";
import type { SourceView } from "../sources";
import { SyncEvery } from "./pipeline";
import { KeepAccountForm } from "@/plugins/keep/KeepAccountForm";

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
  const info: Record<string, string> = {
    jira: t("Each board switched on is a board database here, kept by every Jira sync — read-only (Jira is where tickets change); My briefing a page over the briefing's tickets."),
    keep: t("Google Keep's notes as a gallery database, kept by every Keep sync — read-only."),
    todos: t("Your todos — a database of them, or a step of any database's pipeline."),
    mail: t("Your mails (Outlook, Gmail) — a database of them, shown by the mail client; filter them with AI in its steps."),
    messages: t("Your chats (Teams, WhatsApp, Signal) — a database of them, shown by the chat; filter them with AI in its steps."),
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
            <h2 className="text-lg font-semibold">{s.key.startsWith("ext:") ? t(s.name) : s.name}</h2>
            <span className="text-sm text-zinc-500">{s.key.startsWith("ext:") ? t("{n} records", { n: s.count }) : s.key === "jira" ? t("{n} boards on", { n: s.count }) : s.key === "keep" ? t("{n} notes", { n: s.count }) : s.key === "todos" ? t("{n} open todos", { n: s.count }) : s.key === "mail" ? t("{n} mails", { n: s.count }) : t("{n} messages", { n: s.count })}</span>
            <span className="flex-1" />
            {s.setup && (
              <Link href={s.setup.href} className="btn btn-sm">
                {s.ready ? t("Settings") : t("Set up")}
              </Link>
            )}
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await createSourceDatabaseAction(s.key);
                  if (!r.ok) return void toast(r.error, { tone: "error" });
                  router.push(`/workspace/${r.id}?steps=1`);
                })
              }
            >
              ＋ {t("New database from it")}
            </button>
            {s.step && (
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => sync(s)}>
                {pending ? "…" : t("Sync now")}
              </button>
            )}
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{info[s.key] ?? (s.hint ? t(s.hint) : "")}</p>
          {(s.key === "jira" || s.key === "keep" || s.key === "mail") && <SyncEvery syncKey={s.key} name={s.name} />}
          {s.keepAccount !== undefined && <KeepAccountForm account={s.keepAccount} />}
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
          {s.lists && (
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800" data-task-lists>
              {s.lists.map((l) => (
                <li key={l.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <Link href={`/workspace/${l.pageId}`} className="min-w-0 flex-1 truncate hover:underline" title={l.key}>
                    ☑ {l.path}
                  </Link>
                  <span className="text-xs text-zinc-500 tabular-nums">{l.open}/{l.total}</span>
                  <label className="flex items-center gap-1 text-xs" title={t("Its open items are todos of the Todos tab too.")}>
                    <input
                      type="checkbox"
                      checked={l.engine}
                      disabled={pending}
                      onChange={(e) =>
                        start(async () => {
                          const r = await taskListMetaAction(l.pageId, l.listId, { engine: e.target.checked });
                          if (!r.ok) toast(r.error, { tone: "error" });
                          router.refresh();
                        })
                      }
                    />
                    {t("Todo engine")}
                  </label>
                  {l.database ? (
                    <Link href={l.database} className="ws-chip hover:underline">
                      {t("Followed by a database")}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await followTaskListAction(l.pageId, l.listId);
                          if (!r.ok) return void toast(r.error, { tone: "error" });
                          router.push(`/workspace/${r.dbId}`);
                        })
                      }
                    >
                      {t("Follow as a database")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={pending}
                    title={t("The list becomes a database in its page; this is how the block turns into rows.")}
                    onClick={() =>
                      start(async () => {
                        const r = await convertTaskListAction(l.pageId, l.listId);
                        if (!r.ok) return void toast(r.error, { tone: "error" });
                        router.push(`/workspace/${r.dbId}`);
                      })
                    }
                  >
                    ▦ {t("Turn into a database")}
                  </button>
                </li>
              ))}
              {!s.lists.length && <li className="py-1.5 text-zinc-500">{t("No to-do lists in your pages yet — type “/to-do list” in a page.")}</li>}
            </ul>
          )}
          {s.databases.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-500">{t("Used by")}:</span>
              {s.databases.map((d) => (
                <Link key={d.href} href={d.href} className="ws-chip hover:underline">
                  {d.title}
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}
      <p className="text-sm text-zinc-500" data-catalog-hint>
        {t("An inbox is a database like any other: name the channels as its sources (New → Inbox, or View → Inbox in any database).")}
      </p>
    </div>
  );
}
