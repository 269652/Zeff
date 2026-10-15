import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/i18n/server";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { TodoRefs } from "@/components/boards/TodoRefs";
import { getMailSettings, listMails, mailFolderCounts } from "@/lib/mail/store";
import { agoText } from "@/lib/teams/time";
import { formatSmart } from "@/lib/format";
import { gmailLink, isMine } from "@/lib/mail/shared";
import { UnreadDot, UnreadDotSlot } from "@/components/UnreadDot";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Gmail" };

/**
 * The Gmail app: your Gmail accounts' mails as Zeff has them (the list's lines — the mail sync
 * reads them, none opened), one filter per account. A view for now; a client later.
 */
export default async function GmailAppPage({ searchParams }: { searchParams: Promise<{ q?: string; folder?: string; limit?: string }> }) {
  await connection();
  if (!isInstalled("gmail")) return <PluginNotInstalled id="gmail" />;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const counts = Object.fromEntries(Object.entries(mailFolderCounts()).filter(([f]) => f.startsWith("Gmail")));
  const folder = sp.folder && sp.folder in counts ? sp.folder : undefined;
  const limit = Math.min(2000, Math.max(300, Math.floor(Number(sp.limit)) || 300));
  const mails = listMails({ q, ...(folder ? { folder } : { folderPrefix: "Gmail" }), limit });
  const settings = getMailSettings();
  const href = (f?: string, n?: number) => `/apps/gmail?${new URLSearchParams({ ...(f ? { folder: f } : {}), ...(q ? { q } : {}), ...(n ? { limit: String(n) } : {}) })}`;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Gmail</h1>
        <p className="text-sm text-zinc-500">{t("Your Gmail mails as Gmail's list shows them — read by the mail sync (sync menu), none opened.")}</p>
        {settings.lastSyncAt && <p className="text-xs text-zinc-400">{t("Last synced {ago}.", { ago: agoText(settings.lastSyncAt) })}</p>}
        <nav className="flex flex-col gap-0.5 text-sm" aria-label={t("Accounts")}>
          {[undefined, ...Object.keys(counts)].map((f) => (
            <Link
              key={f ?? "all"}
              href={href(f)}
              aria-current={folder === f ? "page" : undefined}
              className={`flex justify-between rounded px-2 py-1 ${folder === f ? "bg-zinc-200 font-medium dark:bg-zinc-800" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
            >
              {f ? f.replace(/^Gmail · /, "") || f : t("All accounts")} <span className="text-xs text-zinc-400">{f ? counts[f] : total}</span>
            </Link>
          ))}
        </nav>
        <form action="/apps/gmail" className="flex gap-2">
          {folder && <input type="hidden" name="folder" value={folder} />}
          <input name="q" defaultValue={q} className="input min-w-0 flex-1" placeholder={t("Sender, subject, text…")} aria-label={t("Search mails")} />
          <button type="submit" className="btn shrink-0">{t("Search")}</button>
        </form>
        <Link href="/gmail" className="block text-xs text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Set up accounts")}
        </Link>
      </div>

      {mails.length ? (
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {mails.map((m) => (
            <li key={m.key} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              {m.unread ? <span className="mt-1.5 flex"><UnreadDot className="bg-red-500" /></span> : <UnreadDotSlot />}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`truncate ${m.unread ? "font-semibold" : "font-medium"}`} title={m.fromEmail ?? undefined}>
                    {isMine(m) ? t("Me") : (m.fromName ?? m.fromEmail ?? "?")}
                  </span>
                  {!folder && Object.keys(counts).length > 1 && <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-xs text-zinc-500 dark:bg-zinc-800">{m.folder.replace(/^Gmail · /, "")}</span>}
                  <span className="ml-auto shrink-0 text-xs text-zinc-400">{formatSmart(m.receivedAt)}</span>
                </div>
                <div className={m.unread ? "font-medium" : ""}>
                  <TodoRefs text={m.subject} />
                </div>
                <div className="line-clamp-2 text-xs text-zinc-500">{m.preview}</div>
                {gmailLink(m) && (
                  <a href={gmailLink(m)!} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-sky-700 hover:underline dark:text-sky-400">
                    {t("Open in Gmail")} ↗<span className="sr-only"> {t("(opens in a new tab)")}</span>
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">{q ? t("No mail matches.") : t("Nothing synced yet — the mail sync (sync menu) reads the accounts.")}</p>
      )}
      {mails.length >= limit && (
        <p className="text-center text-xs text-zinc-500">
          {t("The newest {n} mails — search to find older ones.", { n: mails.length })}
          {limit < 2000 && <> · <Link href={href(folder, Math.min(2000, limit + 300))} className="font-medium text-indigo-700 hover:underline dark:text-indigo-400">{t("Show more")}</Link></>}
        </p>
      )}
    </div>
  );
}
