import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { syncKeepAction } from "@/plugins/keep/server-actions";
import { BetaBadge, BetaWarning } from "@/components/BetaBadge";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { SyncControls } from "@/components/SyncControls";
import { syncOverview } from "@/lib/sync/registry";
import { agoText } from "@/lib/teams/time";
import { pluginById } from "@/plugins/catalog";
import { keepNoteClass } from "@/plugins/keep/colors";
import { KeepBoardView } from "@/plugins/keep/KeepBoardView";
import { KeepNav } from "@/plugins/keep/KeepNav";
import { keepLabels, linkedKeepCount, listKeepNotes } from "@/plugins/keep/store";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "Google Keep" };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" }) : "");

/**
 * Google Keep in Zeff: your Keep notes as Zeff has them (the Keep sync reads them in the account's
 * automation Chrome). Pinned first, then the latest edited; search, labels, the archive. A view —
 * editing stays in Keep (each note links there) — unless "Google Keep schreiben" (beta) is
 * installed: then they're written here like your own boards, and saved in Keep itself.
 */
export default async function GoogleKeepPage({ searchParams }: { searchParams: Promise<{ q?: string; label?: string; archived?: string }> }) {
  await connection();
  if (!isInstalled("keep")) return <PluginNotInstalled id="keep" />;
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const label = sp.label?.trim() ?? "";
  const archived = sp.archived === "1";
  const notes = listKeepNotes({ q, label, archived, limit: 600 });
  const writable = isInstalled("keep-write");
  const linked = linkedKeepCount();
  const labels = keepLabels();
  const step = syncOverview().steps.find((s) => s.key === "keep");
  const href = (p: { label?: string; archived?: boolean }) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (p.label) u.set("label", p.label);
    if (p.archived) u.set("archived", "1");
    return `/keep/google${u.size ? `?${u}` : ""}`;
  };
  const filter = (active: boolean) => `flex items-baseline gap-2 rounded px-2 py-1 ${active ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"}`;

  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">Keep</h1>
        <KeepNav current="google" />
        {writable ? (
          <>
            <p className="text-sm text-zinc-500">
              Deine Google-Keep-Notizen — hier geschrieben und gleich in Google Keep gespeichert (über Keeps eigene Seite im Automations-Chrome).
              <BetaBadge warning={pluginById("keep-write").beta} />
            </p>
            <BetaWarning warning={pluginById("keep-write").beta ?? ""} />
          </>
        ) : (
          <p className="text-sm text-zinc-500">Deine Google-Keep-Notizen — gelesen vom Keep-Sync im Automations-Chrome; in Keep ändert sich nichts. Bearbeiten in Keep (jede Notiz verlinkt dorthin) — oder hier, mit dem Plugin „Google Keep schreiben“ (Beta).</p>
        )}
        <SyncControls
          syncKey="keep"
          label="Keep"
          syncMinutes={step?.everyMinutes ?? 0}
          last={step?.lastAt ? { at: step.lastAt, ago: agoText(step.lastAt), ok: !!step.lastOk, result: step.lastMessage ?? "" } : null}
          sync={syncKeepAction}
        />
        {linked > 0 && <p className="text-xs text-zinc-500">{linked} notes are synced with your boards and shown there — not here a second time.</p>}
        <form action="/keep/google">
          {label && <input type="hidden" name="label" value={label} />}
          {archived && <input type="hidden" name="archived" value="1" />}
          <input name="q" defaultValue={q} className="input" placeholder="Titel, Text, Label …" aria-label="Notizen durchsuchen" />
        </form>
        <nav className="flex flex-col gap-0.5 text-sm" aria-label="Labels">
          <Link href={href({})} aria-current={!label && !archived ? "page" : undefined} className={filter(!label && !archived)}>
            Alle Notizen
          </Link>
          {labels.map((l) => (
            <Link key={l.label} href={href({ label: l.label })} aria-current={label === l.label ? "page" : undefined} className={filter(label === l.label)}>
              <span className="truncate">{l.label}</span>
              <span className="ml-auto text-xs text-zinc-400">{l.count}</span>
            </Link>
          ))}
          <Link href={href({ archived: true })} aria-current={archived ? "page" : undefined} className={filter(archived)}>
            Archiv
          </Link>
        </nav>
      </div>

      {writable ? (
        <KeepBoardView
          source={{ kind: "google", labelHref: `/keep/google?${q ? `q=${encodeURIComponent(q)}&` : ""}label=` }}
          notes={notes.map((n) => ({ id: n.id, title: n.title, text: n.text, labels: n.labels, color: n.color, pinned: n.pinned, archived: n.archived, updatedAt: n.updatedAt, url: n.url }))}
          archived={archived}
          empty={q || label ? "Keine Notiz passt." : archived ? "Nichts im Archiv." : "Noch nichts synchronisiert — „Keep syncen“ liest deine Notizen."}
        />
      ) : notes.length ? (
        <section className="columns-1 gap-3 sm:columns-2 xl:columns-3">
          {notes.map((n) => (
            <article key={n.id} className={`card mb-3 break-inside-avoid space-y-1.5 p-3 ${keepNoteClass(n.color)}`}>
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
