"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import type { Row } from "@/plugins/workspace/model";
import { MailReply } from "./MailReply";
import { SuggestedActions } from "@/plugins/workspace/ui/suggested";
import { NewInbox } from "./NewInbox";

/**
 * The mail client: a mail database (its rows a pipeline keeps from Outlook and Gmail) as folders, a list and a reading
 * pane — the conversation of the mail picked, its sender and time, open in Outlook / Gmail, the row itself.
 */

type Msg = { key: string; name: string; email: string | null; at: string; unread: boolean; subject: string; preview: string; mine: boolean };

const optName = (data: AppViewProps["data"], prop: string, v: unknown) => data.schema.properties.find((p) => p.id === prop)?.options?.find((o) => o.id === v)?.name ?? "";
const fromName = (from: unknown) => String(from ?? "").replace(/\s*<[^>]*>$/, "") || "?";
const when = (v: unknown) => {
  const d = v ? new Date(String(v)) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
};

export default function MailView({ data, rows, openRow }: AppViewProps) {
  const t = useT();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const list = rows
    .filter((r) => !unreadOnly || r.cells.mailunread)
    .sort((a, b) => String(b.cells.mailreceived ?? "").localeCompare(String(a.cells.mailreceived ?? "")));
  const row = list.find((r) => r.id === picked) ?? list[0] ?? null;
  const unread = rows.filter((r) => r.cells.mailunread).length;
  return (
    <div className="grid h-[70vh] min-h-96 grid-cols-[minmax(0,24rem)_minmax(0,1fr)] overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800" data-app-view="mail">
      <div className="flex min-h-0 flex-col border-r border-zinc-200 dark:border-zinc-800">
      {/* The inboxes are databases under this one (the sidebar shows them); here: unread only, and a new one. */}
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1 dark:border-zinc-800">
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          {t("Unread only")} {unread > 0 && <span className="font-semibold text-indigo-600">({unread})</span>}
        </label>
        <span className="flex-1" />
        <NewInbox dbId={data.id} dataType="mail" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label={t("Mails")}>
        {list.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setPicked(r.id)}
              className={`block w-full border-b border-zinc-100 px-3 py-2 text-left dark:border-zinc-800 ${row?.id === r.id ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}
            >
              <span className="flex items-baseline gap-2">
                <span className={`min-w-0 flex-1 truncate text-sm ${r.cells.mailunread ? "font-semibold" : ""}`}>{fromName(r.cells.mailfrom)}</span>
                <span className="shrink-0 text-xs text-zinc-400">{when(r.cells.mailreceived)}</span>
              </span>
              <span className={`block truncate text-sm ${r.cells.mailunread ? "font-medium text-indigo-700 dark:text-indigo-300" : ""}`}>{r.title}</span>
              <span className="block truncate text-xs text-zinc-500">{data.extras?.previews[r.id]?.map((l) => l.text).join(" ") ?? ""}</span>
            </button>
          </li>
        ))}
        {!list.length && <li className="p-4 text-sm text-zinc-500">{t("No mails here.")}</li>}
      </ul>
      </div>
      <section className="min-w-0 overflow-y-auto p-4" aria-label={t("Reading pane")}>{row ? <Reading key={row.id} row={row} data={data} openRow={openRow} /> : <p className="text-sm text-zinc-500">{t("Pick a mail.")}</p>}</section>
    </div>
  );
}

/** A mail opened: its subject, sender, folder, the actions — and the conversation it's in, oldest first. */
function Reading({ row, data, openRow }: { row: Row; data: AppViewProps["data"]; openRow: (id: number) => void }) {
  const t = useT();
  const conv = String(row.cells.mailconv ?? "");
  const [thread, setThread] = useState<Msg[] | null>(null);
  useEffect(() => {
    let live = true;
    if (conv)
      void fetch(`/api/mail/thread?conv=${encodeURIComponent(conv)}`)
        .then((r) => (r.ok ? r.json() : { messages: [] }))
        .then((j: { messages: Msg[] }) => live && setThread(j.messages));
    return () => {
      live = false;
    };
  }, [conv]);
  const link = typeof row.cells.srcurl === "string" ? row.cells.srcurl : "";
  const account = optName(data, "mailaccount", row.cells.mailaccount);
  return (
    <article className="space-y-3">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{row.title}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {String(row.cells.mailfrom ?? "")} · {when(row.cells.mailreceived)} · {account} · {optName(data, "mailfolder", row.cells.mailfolder)}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="btn btn-sm">
              ↗ {account === "Gmail" ? t("Open in Gmail") : t("Open in Outlook")}
            </a>
          )}
          <button type="button" className="btn btn-sm" onClick={() => openRow(row.id)}>
            ▤ {t("Open as row")}
          </button>
          {!data.extras?.capabilities?.reply.includes(account || "Outlook") && <span className="self-center text-xs text-zinc-500" data-read-only>🔒 {t("Read-only — reply in Outlook / Gmail")}</span>}
        </div>
      </header>
      {typeof row.cells.filterwhy === "string" && row.cells.filterwhy && <p className="rounded bg-amber-50 px-2 py-1 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">⭐ {row.cells.filterwhy}</p>}
      {thread === null ? (
        <p className="text-sm text-zinc-400">…</p>
      ) : (
        <ol className="space-y-3">
          {(thread.length ? thread : [{ key: "row", name: String(row.cells.mailfrom ?? ""), email: null, at: when(row.cells.mailreceived), unread: !!row.cells.mailunread, subject: row.title, preview: data.extras?.previews[row.id]?.map((l) => l.text).join("\n") ?? "", mine: false }]).map((m) => (
            <li key={m.key} className={`rounded-lg border p-3 text-sm ${m.mine ? "border-indigo-200 bg-indigo-50/50 dark:border-indigo-900 dark:bg-indigo-950/20" : "border-zinc-200 dark:border-zinc-800"}`}>
              <p className="mb-1 flex gap-2 text-xs text-zinc-500">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{m.mine ? t("Me") : m.name}</span>
                <span>{m.at}</span>
              </p>
              <p className="whitespace-pre-wrap">{m.preview}</p>
            </li>
          ))}
        </ol>
      )}
      <SuggestedActions rowId={row.id} value={row.cells.rowactions} />
      {data.extras?.capabilities?.reply.includes(account || "Outlook") && <MailReply key={row.id} rowId={row.id} account={account || "Outlook"} to={/<([^>]+)>/.exec(String(row.cells.mailfrom ?? ""))?.[1] ?? ""} subject={/^(AW|RE|Re|Aw):/.test(row.title) ? row.title : `AW: ${row.title}`} />}
    </article>
  );
}
