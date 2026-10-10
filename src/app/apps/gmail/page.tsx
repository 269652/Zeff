import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { TodoRefs } from "@/components/boards/TodoRefs";
import { getMailSettings, listMails, mailFolderCounts } from "@/lib/mail/store";
import { agoText } from "@/lib/teams/time";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Gmail" };

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
};

/**
 * The Gmail app: your Gmail accounts' mails as Zeff has them (the list's lines — the mail sync
 * reads them, none opened), one filter per account. A view for now; a client later.
 */
export default async function GmailAppPage({ searchParams }: { searchParams: Promise<{ q?: string; folder?: string }> }) {
  await connection();
  if (!isInstalled("gmail")) return <PluginNotInstalled id="gmail" />;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const counts = Object.fromEntries(Object.entries(mailFolderCounts()).filter(([f]) => f.startsWith("Gmail")));
  const folder = sp.folder && sp.folder in counts ? sp.folder : undefined;
  const mails = listMails({ q, ...(folder ? { folder } : { folderPrefix: "Gmail" }), limit: 300 });
  const settings = getMailSettings();
  const href = (f?: string) => `/apps/gmail?${new URLSearchParams({ ...(f ? { folder: f } : {}), ...(q ? { q } : {}) })}`;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Gmail</h1>
        <p className="text-sm text-zinc-500">Deine Gmail-Mails, wie Gmails Liste sie zeigt — gelesen vom Mail-Sync (Sync-Menü), keine geöffnet.</p>
        {settings.lastSyncAt && <p className="text-xs text-zinc-400">Zuletzt synchronisiert {agoText(settings.lastSyncAt)}.</p>}
        <nav className="flex flex-col gap-0.5 text-sm" aria-label="Konten">
          {[undefined, ...Object.keys(counts)].map((f) => (
            <Link
              key={f ?? "all"}
              href={href(f)}
              aria-current={folder === f ? "page" : undefined}
              className={`flex justify-between rounded px-2 py-1 ${folder === f ? "bg-zinc-200 font-medium dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
            >
              {f ? f.replace(/^Gmail · /, "") || f : "Alle Konten"} <span className="text-xs text-zinc-400">{f ? counts[f] : total}</span>
            </Link>
          ))}
        </nav>
        <form action="/apps/gmail" className="flex gap-2">
          {folder && <input type="hidden" name="folder" value={folder} />}
          <input name="q" defaultValue={q} className="input" placeholder="Absender, Betreff, Text …" aria-label="Mails durchsuchen" />
        </form>
        <Link href="/gmail" className="block text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          Konten einstellen
        </Link>
      </div>

      {mails.length ? (
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {mails.map((m) => (
            <li key={m.key} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${m.unread ? "bg-red-500" : "bg-transparent"}`} title={m.unread ? "Ungelesen" : undefined} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`truncate ${m.unread ? "font-semibold" : "font-medium"}`} title={m.fromEmail ?? undefined}>
                    {m.fromName ?? m.fromEmail ?? "?"}
                  </span>
                  {!folder && Object.keys(counts).length > 1 && <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-500 dark:bg-zinc-800">{m.folder.replace(/^Gmail · /, "")}</span>}
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
        <p className="py-6 text-center text-sm text-zinc-500">{q ? "Keine Mail passt." : "Noch nichts synchronisiert — der Mail-Sync (Sync-Menü) liest die Konten."}</p>
      )}
    </div>
  );
}
