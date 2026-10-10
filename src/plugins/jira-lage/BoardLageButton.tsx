"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import type { RichBoard } from "@/plugins/kanban/shared";
import { startBoardLageAction } from "./actions";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/**
 * A Jira board's "Auswerten": the Lage of the relevant tickets on your boards that you're in — or,
 * ticked, of all of them — apart from the Ticket-Lage. While it runs, the cards fill in as parts are done.
 */
export function BoardLageButton({ state }: { state: NonNullable<RichBoard["boardLage"]> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const running = state.running || pending;
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
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={running}
        onClick={() =>
          start(async () => {
            const r = await startBoardLageAction({ all });
            toast(r.ok ? (r.message ?? "Läuft.") : (r.error ?? "Ging nicht."), { tone: r.ok ? "ok" : "error" });
            router.refresh();
          })
        }
        title={all ? "Alle aktuell relevanten Tickets der Jira-Boards durch die KI — nur, was sich geändert hat" : "Die aktuell relevanten Tickets, an denen du beteiligt bist (zugewiesen, verfolgt, kommentiert, deine Todos oder Buchungen) — nur, was sich geändert hat"}
      >
        {running ? (
          <>
            <span className="size-2 animate-pulse rounded-full bg-white" aria-hidden /> Wertet aus …
          </>
        ) : (
          `Auswerten — ${all ? "alle Tickets" : "mit mir"}`
        )}
      </button>
      <label className="flex items-start gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
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
          className="mt-0.5 accent-indigo-600"
        />
        <span>Auch Tickets ohne mich — nur mit dem, was Jira über sie weiß</span>
      </label>
      {state.lastAt && !state.running && (
        <p className={`text-xs ${state.lastOk === false ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
          Zuletzt {when(state.lastAt)}: {state.lastMessage}
        </p>
      )}
    </div>
  );
}
