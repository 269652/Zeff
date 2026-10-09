import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { saveMailSyncAction, syncMailAction } from "@/app/actions";
import { MailFoldersForm } from "@/components/MailFoldersForm";
import { SyncControls } from "@/components/SyncControls";
import { TodoRefs } from "@/components/boards/TodoRefs";
import { getMailSettings, listMails, mailFolderCounts } from "@/lib/mail/store";
import { agoText } from "@/lib/teams/time";

export const metadata: Metadata = { title: "Mail" };

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
};

/**
 * Mail: your inbox's latest mails, read from Outlook in the automation Chrome — the mail list as
 * it shows them (sender, subject, the first lines): no mail is opened, none marked read. The
 * Ticket-Lage reads those that name a ticket.
 */
export default async function MailPage({ searchParams }: { searchParams: Promise<{ q?: string; folder?: string }> }) {
  await connection();
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const counts = mailFolderCounts();
  const folder = sp.folder && sp.folder in counts ? sp.folder : undefined;
  const settings = getMailSettings();
  const mails = listMails({ q, folder, limit: 300 });
  const href = (f?: string) => `/mail?${new URLSearchParams({ ...(f ? { folder: f } : {}), ...(q ? { q } : {}) })}`;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Mail</h1>
        <p className="text-sm text-zinc-500">
          Dein Posteingang, aus Outlook im Automation-Chrome gelesen — so, wie die Liste ihn zeigt (eine Zeile je Unterhaltung: Absender, Betreff, die ersten Zeilen): keine Mail wird geöffnet,
          keine als gelesen markiert. „Sync now“ liest zwei Monate, der Hintergrund-Sync die letzten Tage. Mails, die ein Ticket nennen, liest die Ticket-Lage mit.
        </p>
      </div>

      <section className="card p-4">
        <SyncControls
          sync={syncMailAction}
          save={saveMailSyncAction}
          syncMinutes={settings.syncMinutes}
          last={settings.lastSyncAt ? { at: settings.lastSyncAt, ago: agoText(settings.lastSyncAt), ok: !!settings.lastOk, result: settings.lastResult ?? "" } : null}
        />
        <MailFoldersForm folders={settings.folders} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
      <nav className="flex rounded-md border border-zinc-200 p-0.5 text-sm dark:border-zinc-700" aria-label="Ordner">
        {[undefined, ...Object.keys(counts)].map((f) => (
          <Link
            key={f ?? "all"}
            href={href(f)}
            aria-current={folder === f ? "page" : undefined}
            className={`rounded px-3 py-1 ${folder === f ? "bg-zinc-200 font-medium dark:bg-zinc-700" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
          >
            {f ?? "Alle"} <span className="text-xs text-zinc-400">{f ? counts[f] : total}</span>
          </Link>
        ))}
      </nav>
      <form action="/mail" className="flex justify-end gap-2">
        {folder && <input type="hidden" name="folder" value={folder} />}
        <input name="q" defaultValue={q} className="input max-w-md" placeholder="Absender, Betreff, Text …" aria-label="Mails durchsuchen" />
        <button type="submit" className="btn">Suchen</button>
      </form>
      </div>

      {mails.length ? (
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {mails.map((m) => (
            <li key={m.key} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${m.unread ? "bg-indigo-500" : "bg-transparent"}`} title={m.unread ? "Ungelesen" : undefined} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`truncate ${m.unread ? "font-semibold" : "font-medium"}`} title={m.fromEmail ?? undefined}>
                    {m.fromName ?? m.fromEmail ?? "?"}
                  </span>
                  {m.folder !== "Posteingang" && <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-500 dark:bg-zinc-800">{m.folder}</span>}
                  <span className="ml-auto shrink-0 text-xs text-zinc-400">{when(m.receivedAt)}</span>
                </div>
                <div className={m.unread ? "font-medium" : ""}>
                  <TodoRefs text={m.subject} />
                </div>
                <div className="line-clamp-2 text-xs text-zinc-500">{m.preview}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">
          {q ? "Keine Mail passt." : "Noch nichts synchronisiert — „Sync now“ öffnet Outlooks Posteingang im Automation-Chrome, falls er nicht offen ist."}
        </p>
      )}
      {mails.length === 300 && <p className="text-center text-xs text-zinc-400">Die neuesten 300 — such, um ältere zu finden.</p>}
    </div>
  );
}
