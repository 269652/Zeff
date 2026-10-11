"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useT } from "@/components/I18nProvider";
import { SOURCE_LABELS, type SeriesScope } from "@/lib/calendar/ir-shared";
import { describeRecurrence } from "@/lib/calendar/recurrence";
import type { T } from "@/lib/i18n/shared";
import { ScopeChoice } from "./EventEditor";
import { doneBrowserOpAction, removeTodoOpAction } from "@/plugins/todos/server-actions";
import { acceptProposedEventAction, deleteEventAction } from "./server-actions";
import { whenText, type Item } from "./view-shared";

type Result = { ok: boolean; message?: string; error?: string } | null;

/** Your answer to an invitation, in the language of `t`. */
const responses = (t: T): Record<string, string> => ({
  accepted: t("Accepted"),
  declined: t("Declined"),
  tentativelyAccepted: t("Tentative"),
  notResponded: t("Not responded"),
  organizer: t("Organizer"),
});
/** How an appointment shows your time (other than busy), in the language of `t` — unknown ones as they come. */
const showAsText = (t: T, v: string): string =>
  ({ free: t("free"), tentative: t("tentative"), oof: t("away"), workingElsewhere: t("working elsewhere") })[v] ?? v;

/**
 * An appointment opened (a click): beside it, what it is — when, how it repeats, its calendar,
 * place, notes, who's invited — and what to do: edit or delete (Zeff's own), open it in Google or
 * Outlook, go to the todo it's for.
 */
export function EventDetails({ item, anchor, onClose, onEdit, onDone }: { item: Item; anchor: DOMRect | null; onClose: () => void; onEdit: () => void; onDone: (r: Result) => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const e = item.event;
  const series = !!(e && e.occurrence);

  // Beside the appointment where there's room (right, else left), inside the window — a phone: at the bottom.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!anchor || vw < 640) {
      Object.assign(el.style, { left: "", top: "", right: "", bottom: "" });
      return;
    }
    let left = anchor.right + 8;
    if (left + w > vw - 8) left = anchor.left - w - 8;
    if (left < 8) left = Math.min(Math.max(8, anchor.left), vw - w - 8);
    const top = Math.min(Math.max(8, anchor.top), vh - h - 8);
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
  }, [anchor, item, asking]);

  useEffect(() => {
    const key = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    const away = (ev: PointerEvent) => box.current && !box.current.contains(ev.target as Node) && onClose();
    window.addEventListener("keydown", key);
    const timer = setTimeout(() => window.addEventListener("pointerdown", away), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", away);
    };
  }, [onClose]);

  // A todo's proposed appointment: accepted (entered in Zeff's calendar — or Google's / Outlook's form
  // opened, filled in, and noted on the todo) or dismissed; only that action of the todo.
  const p = item.proposed;
  const accept = () => {
    if (!p) return;
    if (p.href) window.open(p.href, "_blank", "noopener,noreferrer");
    start(async () => onDone(p.href ? await doneBrowserOpAction(p.todoId, p.index) : await acceptProposedEventAction(p.todoId, p.index, p.title)));
  };
  const dismiss = () => p && start(async () => onDone(await removeTodoOpAction(p.todoId, p.index)));

  const remove = (scope?: SeriesScope) => start(async () => onDone(await deleteEventAction(e!.id, series && scope ? { occurrence: e!.occurrence!, scope } : undefined)));

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={item.title}
      className="card fixed right-2 bottom-2 left-2 z-40 w-auto space-y-2 p-4 text-sm shadow-xl sm:left-auto sm:w-[22rem]"
    >
      {asking ? (
        <ScopeChoice title={t("Delete recurring event")} pending={pending} onCancel={() => setAsking(false)} onPick={remove} />
      ) : (
        <>
          <div className="flex items-start gap-2">
            <span className={`mt-1.5 size-3 shrink-0 rounded ${item.proposed ? "border-2 border-dashed" : ""}`} style={item.proposed ? { borderColor: item.color } : { background: item.color }} />
            <div className="min-w-0 flex-1">
              <p className="text-base leading-snug font-semibold break-words">{item.proposed ? t("Proposed: {title}", { title: item.title }) : item.title}</p>
              <p className="text-zinc-600 dark:text-zinc-300">{whenText(item, t)}</p>
              {e?.recurrence && <p className="text-xs text-zinc-500">↻ {describeRecurrence(e.recurrence, e.start, t)}</p>}
            </div>
            <div className="flex shrink-0 gap-0.5">
              {item.editable && (
                <button type="button" className="icon-btn" onClick={onEdit} aria-label={t("Edit")} title={t("Edit (E)")}>
                  ✎
                </button>
              )}
              {item.editable && (
                <button type="button" className="icon-btn" disabled={pending} onClick={() => (series ? setAsking(true) : remove())} aria-label={t("Delete")} title={t("Delete")}>
                  🗑
                </button>
              )}
              <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Close")}>
                ×
              </button>
            </div>
          </div>
          {item.calendar && (
            <p className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="size-2 rounded-full" style={{ background: item.calendar.color }} />
              {item.calendar.name} · {SOURCE_LABELS[item.calendar.source]}
              {e?.showAs && e.showAs !== "busy" ? ` · ${showAsText(t, e.showAs)}` : ""}
              {e?.response && responses(t)[e.response] ? ` · ${responses(t)[e.response]}` : ""}
            </p>
          )}
          {e?.location && <p>📍 {e.location}</p>}
          {e?.online && <p className="text-xs text-zinc-500">{t("Online meeting")}</p>}
          {e?.organizer && <p className="text-xs text-zinc-500">{t("Organiser: {name}", { name: e.organizer })}</p>}
          {e && e.attendees.length > 0 && <p className="text-xs text-zinc-500">{t("Guests: {names}", { names: `${e.attendees.slice(0, 8).join(", ")}${e.attendees.length > 8 ? ` +${e.attendees.length - 8}` : ""}` })}</p>}
          {e?.description && <p className="max-h-40 overflow-y-auto whitespace-pre-line text-zinc-600 dark:text-zinc-300">{e.description}</p>}
          {item.proposed && (
            <p className="text-xs text-zinc-500">
              {t("Proposed for")}{" "}
              <Link href={`/t/${item.proposed.todoId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                {item.proposed.todoRef}
              </Link>{" "}
              {t("“{text}” — in {target}.", { text: item.proposed.todoText, target: item.proposed.target })}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {p && (
              <>
                <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={accept} title={p.href ? t("Opens {target}'s form, filled in — save it there; it's noted on {ref}", { target: p.target, ref: p.todoRef }) : t("Enters it in {target} now", { target: p.target })}>
                  {pending ? "…" : p.href ? t("Accept — open in {target} ↗", { target: p.target }) : t("Accept")}
                </button>
                <button type="button" className="btn btn-sm" disabled={pending} onClick={dismiss} title={t("Takes the proposal off {ref}", { ref: p.todoRef })}>
                  {t("Dismiss")}
                </button>
              </>
            )}
            {e?.todoId && (
              <Link href={`/t/${e.todoId}`} className="btn btn-sm">
                {t("Open todo")}
              </Link>
            )}
            {e?.url && (
              <a href={e.url} target="_blank" rel="noreferrer" className="btn btn-sm">
                {item.calendar ? t("Open in {source} ↗", { source: SOURCE_LABELS[item.calendar.source] }) : t("Open in source ↗")}
              </a>
            )}
            {!item.editable && !item.proposed && item.calendar && <p className="text-xs text-zinc-400">{t("Read-only here — change it in {source}.", { source: SOURCE_LABELS[item.calendar.source] })}</p>}
          </div>
        </>
      )}
    </div>
  );
}
