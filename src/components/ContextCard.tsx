"use client";

import Link from "next/link";
import { startTransition, useState, type ReactNode } from "react";
import { deleteContextAction, unlinkContextAction, updateContextAction } from "@/app/actions";
import {
  contextKindLabels,
  contextHeadline,
  inlineFileIds,
  itemSource,
  jiraSyncState,
  kindOfUrl,
  linkLabel,
  type ContextItem,
} from "@/lib/contexts-shared";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import { formatDate, formatHours } from "@/lib/format";
import { useT } from "@/components/I18nProvider";
import type { T } from "@/lib/i18n/shared";
import { ContextForm } from "./ContextForm";
import { CONTEXT_KIND_STYLE } from "./contextKindStyle";
import { ContextSyncButton } from "./ContextSyncButton";
import { Markdown } from "./Markdown";
import type { EntityMap } from "@/lib/entities-shared";
import { DragGrip, ExpandableSource, SourceBadge, SourceDetails } from "./SourceBadge";
import { PencilIcon, TrashIcon } from "./icons";
import { TicketLink } from "./TicketLink";
import { reorderClasses, type ReorderRow } from "./useReorder";
import { formatDateTime } from "@/lib/format";

const KIND_STYLE = CONTEXT_KIND_STYLE;

const day = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10), { weekday: false, year: true }) : null);
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const entries = (t: T, n: number) => (n === 1 ? t("1 entry") : t("{n} entries", { n }));

/** A ticket key as a chip (a link to Jira, with its hover card). */
const TICKET_CHIP =
  "inline-block rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-700 ring-1 ring-sky-200 ring-inset hover:bg-sky-100 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-900";

/**
 * Where an item stands with Jira, as one control: posted ✓ (green — it opens the comment), else
 * a Sync button, amber when it changed since. `short`: the ticket is shown beside it.
 */
function JiraState({ item, ticketUrl, short = false }: { item: ContextItem; ticketUrl?: string | null; short?: boolean }) {
  const t = useT();
  const state = jiraSyncState(item);
  if (state === "no-ticket") return null;
  const at = item.jiraSyncedAt ? formatDateTime(item.jiraSyncedAt) : "";
  if (state !== "synced") {
    return (
      <ContextSyncButton
        ids={[item.id]}
        tickets={[item.ticket!]}
        label={t("Sync")}
        small
        changed={state === "changed"}
        title={
          state === "changed"
            ? t("Changed since it was posted to {ticket} ({at}) — update the comment", { ticket: item.ticket, at })
            : t("Not on {ticket} yet — post it there as a comment", { ticket: item.ticket })
        }
      />
    );
  }
  const text = short ? `✓ ${t("synced")}` : `✓ ${t("on {ticket}", { ticket: item.ticket })}`;
  const cls = "rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
  const id = item.jiraCommentId;
  if (id && ticketUrl) {
    const href = `${ticketUrl}?focusedCommentId=${encodeURIComponent(id)}&page=com.atlassian.jira.plugin.system.issuetabpanels%3Acomment-tabpanel#comment-${encodeURIComponent(id)}`;
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${cls} hover:underline`} title={t("Posted to {ticket} ({at}) — open the comment in Jira", { ticket: item.ticket, at })}>
        {text} ↗
      </a>
    );
  }
  return (
    <span className={cls} title={t("Posted to {ticket} ({at})", { ticket: item.ticket, at })}>
      {text}
    </span>
  );
}

/** On an entry: take it off (×) — it stays in the Context tab. In the Context tab: delete it everywhere. */
function RemoveButton({ item, entryId, headline }: { item: ContextItem; entryId?: number; headline?: string }) {
  const t = useT();
  if (entryId !== undefined) {
    return (
      <button
        type="button"
        className="icon-btn text-base"
        onClick={() => {
          const fd = new FormData();
          fd.set("entryId", String(entryId));
          fd.set("contextId", String(item.id));
          startTransition(() => unlinkContextAction(fd));
        }}
        title={t("Remove it from this entry (it stays in the Context tab)")}
        aria-label={t("Remove it from this entry")}
      >
        ×
      </button>
    );
  }
  return (
    <button
      type="button"
      className="icon-btn icon-btn-danger"
      onClick={() => {
        const on = item.entries.length ? entries(t, item.entries.length) : null;
        const question =
          headline === undefined
            ? on
              ? t("Delete it everywhere (it's on {entries})?", { entries: on })
              : t("Delete it everywhere?")
            : on
              ? t("Delete “{what}” everywhere (it's on {entries})?", { what: headline, entries: on })
              : t("Delete “{what}” everywhere?", { what: headline });
        if (!confirm(question)) return;
        const fd = new FormData();
        fd.set("id", String(item.id));
        startTransition(() => deleteContextAction(fd));
      }}
      title={t("Delete it everywhere")}
      aria-label={t("Delete it everywhere")}
    >
      <TrashIcon />
    </button>
  );
}

/**
 * Where source rows go: their badge, ticket, other entries, Jira state and remove button lined
 * up in columns from row to row (the entries column folds away on small screens).
 */
export function SourceList({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">{children}</div>;
}

/**
 * A context item, easy to take in. A source of its own (a synced Teams message or GitLab item)
 * is one row in a SourceList — the badge says it all. A note is a card: where it's from, who
 * and when, its headline and message (long ones fold), its links and files (images as
 * thumbnails), and the other entries it backs. Both show their Jira state; on an entry they're
 * removed from it, in the Context tab deleted; notes can be edited.
 */
export function ContextCard({
  item,
  entryId,
  tickets = {},
  entities = {},
  reorder,
}: {
  item: ContextItem;
  /** The entry it's shown on (unlink; "also on" lists the others). Without one: the Context tab. */
  entryId?: number;
  tickets?: Record<string, TicketCard>;
  /** Its links that point at synced Teams messages / GitLab items (resolveLinks), by link. */
  entities?: EntityMap;
  /** A source row in a list that can be reordered: its grip and drop target (useReorder). */
  reorder?: ReorderRow;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  // A source row: its badge unfolded into the whole message / item.
  const [expanded, setExpanded] = useState(false);
  const ticket = item.ticket ? tickets[item.ticket.toUpperCase()] : undefined;
  const headline = contextHeadline(item, t);
  const body = item.body.trim();
  const showBody = !!body && body !== item.title?.trim();
  const inline = inlineFileIds(body);
  const long = body.length > 700 || body.split("\n").length > 12 || inline.size > 0;
  const others = item.entries.filter((e) => e.id !== entryId);
  // Files the message shows inline aren't listed again below it.
  const shown = item.files.filter((f) => !inline.has(f.id));
  const images = shown.filter((f) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(f.mime));
  const docs = shown.filter((f) => !images.includes(f));
  const showImage = (target: string) =>
    /^attachment:\d+$/.test(target) ? `/api/contexts/files/${target.slice(11)}` : /^https?:/i.test(target) ? target : null;

  if (editing) {
    return (
      <div className="rounded-lg border border-indigo-300 p-3 dark:border-indigo-800">
        <ContextForm
          action={updateContextAction.bind(null, item.id)}
          defaults={item}
          files={item.files}
          submitLabel={t("Save")}
          onDone={() => setEditing(false)}
          sources={false}
        />
      </div>
    );
  }

  const sourceLink = itemSource(item, entities);
  if (sourceLink) {
    const source = entities[sourceLink.url];
    const plain = item.links.filter((l) => !entities[l.url]);
    // Its ticket, when it isn't the entry's own (in the Context tab: always).
    const onTicket = !!item.ticket && (entryId === undefined || item.entries.find((e) => e.id === entryId)?.ticket?.toUpperCase() !== item.ticket);
    return (
      <div {...reorder?.row} className={`col-span-full grid grid-cols-subgrid items-center gap-y-1.5 rounded-md ${reorderClasses(reorder)}`}>
        <div className="flex min-w-0 items-center gap-1.5">
          {reorder && <DragGrip {...reorder.grip} />}
          <SourceBadge entity={source} expanded={expanded} onToggle={() => setExpanded(!expanded)} className="min-w-0 flex-1" />
          {plain.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className={`shrink-0 rounded px-1.5 py-0.5 text-xs hover:underline ${KIND_STYLE[kindOfUrl(l.url) ?? "note"]}`} title={l.url}>
              {linkLabel(l, t)} ↗
            </a>
          ))}
        </div>
        <div>{onTicket && <TicketLink ticket={item.ticket!} card={ticket} className={TICKET_CHIP} />}</div>
        <div className="hidden text-xs whitespace-nowrap text-zinc-500 sm:block">
          {others.length > 0 && (
            <span title={others.map((e) => `${day(e.date)} · ${e.description}`).join("\n")}>
              {entryId !== undefined
                ? t("also on {entries}", { entries: entries(t, others.length) })
                : t("on {entries}", { entries: entries(t, others.length) })}
            </span>
          )}
        </div>
        <div>
          <JiraState item={item} ticketUrl={ticket?.url} short={onTicket} />
        </div>
        <RemoveButton item={item} entryId={entryId} />
        {expanded && (
          <div className="col-span-full">
            <SourceDetails entity={source} />
          </div>
        )}
      </div>
    );
  }

  return (
    <article className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        <span className={`rounded px-1.5 py-0.5 font-medium ${KIND_STYLE[item.kind]}`}>{contextKindLabels(t)[item.kind]}</span>
        {item.author && <span className="font-medium text-zinc-700 dark:text-zinc-200">{item.author}</span>}
        {item.date && <span>{day(item.date)}</span>}
        {item.ticket && (
          <span className="flex min-w-0 items-center gap-1.5">
            {/* The ticket, plainly a link to Jira (with its hover card), and its title. */}
            <TicketLink ticket={item.ticket} card={ticket} className={TICKET_CHIP} />
            {ticket?.summary && (
              <span className="max-w-72 truncate" title={ticket.summary}>
                {ticket.summary}
              </span>
            )}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <JiraState item={item} ticketUrl={ticket?.url} short />
          <button type="button" className="icon-btn" onClick={() => setEditing(true)} title={t("Edit")} aria-label={t("Edit")}>
            <PencilIcon />
          </button>
          <RemoveButton item={item} entryId={entryId} headline={headline} />
        </span>
      </header>

      <h3 className="mt-1 text-sm font-semibold">{headline}</h3>

      {showBody && (
        <div className="mt-1">
          <div className={`relative ${long && !open ? "max-h-60 overflow-hidden" : ""}`}>
            <Markdown text={body} image={showImage} className="text-zinc-700 dark:text-zinc-300" />
            {long && !open && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white dark:from-zinc-950" aria-hidden />
            )}
          </div>
          {long && (
            <button type="button" className="mt-0.5 text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setOpen(!open)}>
              {open ? t("Show less") : t("Show more")}
            </button>
          )}
        </div>
      )}

      {item.links.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {item.links.map((l) => {
            const e = entities[l.url];
            if (e) {
              return (
                <li key={l.url} className="w-full">
                  <ExpandableSource entity={e} />
                </li>
              );
            }
            const kind = kindOfUrl(l.url);
            return (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:underline ${KIND_STYLE[kind ?? "note"]}`}
                  title={l.url}
                >
                  {linkLabel(l, t)} ↗
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {(images.length > 0 || docs.length > 0) && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {images.map((f) => (
            <a key={f.id} href={`/api/contexts/files/${f.id}`} target="_blank" rel="noreferrer" title={`${f.name} · ${size(f.size)}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local uploads, served as stored */}
              <img src={`/api/contexts/files/${f.id}`} alt={f.name} className="h-20 max-w-40 rounded border border-zinc-200 object-cover dark:border-zinc-700" />
            </a>
          ))}
          {docs.map((f) => (
            <a
              key={f.id}
              href={`/api/contexts/files/${f.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-1 text-xs hover:underline dark:bg-zinc-800"
            >
              📎 {f.name} <span className="text-zinc-400">{size(f.size)}</span>
            </a>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-2 text-xs text-zinc-500">
          {entryId !== undefined ? t("Also on") : t("On")}{" "}
          {others.slice(0, 6).map((e, i) => (
            <span key={e.id}>
              {i > 0 && ", "}
              <Link href={`/entries/${e.id}#context`} className="hover:underline" title={e.description}>
                {day(e.date)} · {formatHours(e.hours)} h{e.ticket ? ` · ${e.ticket}` : ""}
              </Link>
            </span>
          ))}
          {others.length > 6 && ` ${t("and {n} more", { n: others.length - 6 })}`}
        </div>
      )}
    </article>
  );
}
