import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { syncKeepAction } from "@/app/actions";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { SyncControls } from "@/components/SyncControls";
import { syncOverview } from "@/lib/sync/registry";
import { agoText } from "@/lib/teams/time";
import { KeepAccountForm } from "@/plugins/keep/KeepAccountForm";
import { keepLabels, keepSettings, listKeepNotes } from "@/plugins/keep/store";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Keep" };

/** Keep's note colours, softened (static class names — Tailwind only sees what's written out). */
const COLORS: Record<string, string> = {
  red: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
  orange: "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30",
  yellow: "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30",
  green: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30",
  teal: "border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950/30",
  blue: "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30",
  cerulean: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30",
  purple: "border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/30",
  pink: "border-pink-200 bg-pink-50 dark:border-pink-900 dark:bg-pink-950/30",
  brown: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
  gray: "border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60",
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" }) : "");

/**
 * The Keep app: your Google Keep notes as Zeff has them (the Keep sync reads them in the account's
 * automation Chrome — nothing in Keep changes). Pinned first, then the latest edited; search, labels,
 * the archive. A view — editing stays in Keep (each note links there).
 */
export default async function KeepAppPage({ searchParams }: { searchParams: Promise<{ q?: string; label?: string; archived?: string }> }) {
  await connection();
  if (!isInstalled("keep")) return <PluginNotInstalled id="keep" />;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const label = sp.label?.trim() ?? "";
  const archived = sp.archived === "1";
  const notes = listKeepNotes({ q, label, archived, limit: 600 });
  const labels = keepLabels();
  const step = syncOverview().steps.find((s) => s.key === "keep");
  const href = (p: { label?: string; archived?: boolean }) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (p.label) u.set("label", p.label);
    if (p.archived) u.set("archived", "1");
    return `/apps/keep${u.size ? `?${u}` : ""}`;
  };

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Keep</h1>
        <p className="text-sm text-zinc-500">Deine Google-Keep-Notizen — gelesen vom Keep-Sync im Automations-Chrome; in Keep ändert sich nichts. Bearbeiten in Keep (jede Notiz verlinkt dorthin).</p>
        <SyncControls
          syncKey="keep"
          label="Keep"
          syncMinutes={step?.everyMinutes ?? 0}
          last={step?.lastAt ? { at: step.lastAt, ago: agoText(step.lastAt), ok: !!step.lastOk, result: step.lastMessage ?? "" } : null}
          sync={syncKeepAction}
        />
        <form action="/apps/keep">
          {label && <input type="hidden" name="label" value={label} />}
          {archived && <input type="hidden" name="archived" value="1" />}
          <input name="q" defaultValue={q} className="input" placeholder="Titel, Text, Label …" aria-label="Notizen durchsuchen" />
        </form>
        <nav className="flex flex-col gap-0.5 text-sm" aria-label="Labels">
          <Link href={href({})} aria-current={!label && !archived ? "page" : undefined} className={`rounded px-2 py-1 ${!label && !archived ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"}`}>
            Notizen
          </Link>
          {labels.map((l) => (
            <Link
              key={l.label}
              href={href({ label: l.label })}
              aria-current={label === l.label ? "page" : undefined}
              className={`flex items-baseline gap-2 rounded px-2 py-1 ${label === l.label ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"}`}
            >
              <span className="truncate">{l.label}</span>
              <span className="ml-auto text-xs text-zinc-400">{l.count}</span>
            </Link>
          ))}
          <Link href={href({ archived: true })} aria-current={archived ? "page" : undefined} className={`rounded px-2 py-1 ${archived ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"}`}>
            Archiv
          </Link>
        </nav>
        <KeepAccountForm account={keepSettings().account} />
      </div>

      {notes.length ? (
        <section className="columns-1 gap-3 sm:columns-2 xl:columns-3">
          {notes.map((n) => (
            <article key={n.id} className={`card mb-3 break-inside-avoid space-y-1.5 p-3 ${n.color ? (COLORS[n.color] ?? "") : ""}`}>
              {(n.title || n.pinned) && (
                <h2 className="flex items-baseline gap-2 font-medium">
                  <span className="min-w-0 flex-1 break-words">{n.title}</span>
                  {n.pinned && (
                    <span className="text-xs text-zinc-400" title="Angeheftet">
                      📌
                    </span>
                  )}
                </h2>
              )}
              {n.text && <p className="line-clamp-[12] text-sm whitespace-pre-line break-words">{n.text}</p>}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-zinc-500">
                {n.labels.map((l) => (
                  <Link key={l} href={href({ label: l })} className="rounded-full bg-zinc-200/70 px-2 py-0.5 hover:bg-zinc-300 dark:bg-zinc-700/70 dark:hover:bg-zinc-600">
                    {l}
                  </Link>
                ))}
                <span className="ml-auto">{day(n.updatedAt ?? n.createdAt)}</span>
                <a href={n.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline dark:text-indigo-400">
                  Keep ↗
                </a>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">{q || label ? "Keine Notiz passt." : archived ? "Nichts im Archiv." : "Noch nichts synchronisiert — „Keep syncen“ liest deine Notizen."}</p>
      )}
    </div>
  );
}
