"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { formatDateTime } from "@/lib/format";
import type { RichBoard } from "./shared";
import { startBoardLageAction } from "./actions";

const when = (iso: string | null) => (iso ? formatDateTime(iso) : "");

/** Where the board's actions sit: the database view's toolbar row (TicketPick.tsx draws it), once it is there. */
export const BOARD_ACTIONS_SLOT = "ws-board-actions";

/** The slot in the database view, once the view has loaded its data and drawn the row (null: not there — yet). */
function useSlot(): { slot: HTMLElement | null; waited: boolean } {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const sync = () => setSlot((prev) => {
      const el = document.getElementById(BOARD_ACTIONS_SLOT);
      return el === prev ? prev : el;
    });
    sync();
    // (The view draws and redraws the row as it loads: follow it.)
    const obs = new MutationObserver(sync);
    obs.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => setWaited(true), 4000);
    return () => {
      obs.disconnect();
      clearTimeout(timer);
    };
  }, []);
  return { slot, waited };
}

/**
 * A Jira board's "Auswerten": the Lage of the relevant tickets on your boards that you're in — or, switched on, of all
 * of them — apart from the Ticket-Lage. While it runs, the cards fill in as parts are done. Small, at the right of the
 * board's toolbar row (beside "Find tickets for me"); when last run in its tooltip.
 */
export function BoardLageButton({ state }: { state: NonNullable<RichBoard["boardLage"]> }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const running = state.running || pending;
  const { slot, waited } = useSlot();
  // All tickets, also those without you (only what Jira says about them): on request, remembered here.
  const [all, setAll] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- as you left it, after hydration
      setAll(localStorage.getItem("zeff-boardlage-all") === "1");
    } catch {
      // as it is
    }
  }, []);
  const last = state.lastAt && !state.running ? t("Last {when}: {message}", { when: when(state.lastAt), message: state.lastMessage }) : "";
  const failed = state.lastOk === false;
  const ui = (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {last && (
        <span className={`max-w-[22rem] truncate text-xs ${failed ? "text-red-700 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`} title={last}>
          {failed ? "⚠ " : ""}
          {t("Last {when}", { when: when(state.lastAt) })}
        </span>
      )}
      <label className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300" title={t("Tickets without me too — only with what Jira knows about them")}>
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => {
            setAll(e.target.checked);
            try {
              localStorage.setItem("zeff-boardlage-all", e.target.checked ? "1" : "0");
            } catch {
              // not kept
            }
          }}
          className="accent-indigo-600"
        />
        {t("All tickets")}
      </label>
      <button
        type="button"
        className="btn btn-primary btn-sm whitespace-nowrap"
        disabled={running}
        onClick={() =>
          start(async () => {
            const r = await startBoardLageAction({ all });
            toast(r.ok ? (r.message ?? t("Running.")) : (r.error ?? t("That didn't work.")), { tone: r.ok ? "ok" : "error" });
            router.refresh();
          })
        }
        title={
          all
            ? t("All currently relevant tickets of the Jira boards through the AI — only what changed")
            : t("The currently relevant tickets you're involved in (assigned, followed, commented, your todos or entries) — only what changed")
        }
      >
        {running ? (
          <>
            <span className="size-2 animate-pulse rounded-full bg-white" aria-hidden /> {t("Analysing …")}
          </>
        ) : all ? (
          t("Analyse — all tickets")
        ) : (
          t("Analyse — with me")
        )}
      </button>
    </div>
  );
  // In the toolbar row once the view drew it; a view without the row (after a moment): over the view, at the right.
  if (slot) return createPortal(ui, slot);
  return waited ? <div className="px-4 pt-3">{ui}</div> : null;
}
