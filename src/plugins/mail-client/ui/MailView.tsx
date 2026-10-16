"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { AppViewProps } from "@/plugins/workspace/ui/app-view";
import type { Row } from "@/plugins/workspace/model";

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
  const [folder, setFolder] = useState<string>("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const folderOf = (r: Row) => `${optName(data, "mailaccount", r.cells.mailaccount)} · ${optName(data, "mailfolder", r.cells.mailfolder)}`;
  const folders = useMemo(() => {
    const m = new Map<string, { all: number; unread: number }>();
    for (const r of rows) {
      const f = folderOf(r);
      const c = m.get(f) ?? { all: 0, unread: 0 };
      c.all++;
      if (r.cells.mailunread) c.unread++;
      m.set(f, c);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- folderOf reads data, which rows come with
  }, [rows, data]);
  const list = rows
    .filter((r) => (!folder || folderOf(r) === folder) && (!unreadOnly || r.cells.mailunread))
    .sort((a, b) => String(b.cells.mailreceived ?? "").localeCompare(String(a.cells.mailreceived ?? "")));
  const row = list.find((r) => r.id === picked) ?? list[0] ?? null;
  const unread = rows.filter((r) => r.cells.mailunread).length;
  const folderButton = (key: string, label: string, n: number, u: number) => (
    <button
      key={key}
      type="button"
      onClick={() => (setFolder(key), setPicked(null))}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${folder === key ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {u > 0 ? <span className="text-xs font-semibold text-indigo-600">{u}</span> : <span className="text-xs text-zinc-400">{n}</span>}
    </button>
  );
  return (
    <div className="grid h-[70vh] min-h-96 grid-cols-[12rem_minmax(0,22rem)_minmax(0,1fr)] overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800" data-app-view="mail">
      <nav className="space-y-0.5 overflow-y-auto border-r border-zinc-200 p-2 dark:border-zinc-800" aria-label={t("Folders")}>
        {folderButton("", t("All mails"), rows.length, unread)}
        {folders.map(([f, c]) => folderButton(f, f, c.all, c.unread))}
        <label className="mt-3 flex items-center gap-1.5 px-2 text-xs text-zinc-500">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          {t("Unread only")}
        </label>
      </nav>
      <ul className="overflow-y-auto border-r border-zinc-200 dark:border-zinc-800" aria-label={t("Mails")}>
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
          {data.extras?.capabilities?.readOnly && <span className="self-center text-xs text-zinc-500" data-read-only>🔒 {t("Read-only — reply in Outlook / Gmail")}</span>}
        </div>
      </header>
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
    </article>
  );
}
