"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { formatDateTime } from "@/lib/format";
import { boardSyncStatusAction, startBoardSyncAction } from "./server-actions";

type Status = Awaited<ReturnType<typeof boardSyncStatusAction>>;

/**
 * "Sync to Google Keep" (Google Keep schreiben, beta): the board's notes made notes in Keep with
 * the board's name as label, both sides kept the same — how far it is while it runs, how the last
 * one went.
 */
export function BoardSyncButton({ boardId, boardName, initial, linked }: { boardId: number; boardName: string; initial: Status; linked: number }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [pending, start] = useTransition();
  const running = !!status.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const s = await boardSyncStatusAction(boardId);
      setStatus(s);
      if (!s.running) {
        router.refresh();
        if (s.last) toast(s.last.message, { tone: s.last.ok ? "ok" : "error" });
      }
    }, 3000);
    return () => clearInterval(t);
  }, [running, boardId, router]);
  const go = () =>
    start(async () => {
      const r = await startBoardSyncAction(boardId);
      if (!r.ok) return toast(r.error ?? "That didn't work.", { tone: "error" });
      setStatus(await boardSyncStatusAction(boardId));
    });
  return (
    <div className="space-y-1.5 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <span className="font-medium">Google Keep</span>
        <span className="rounded bg-amber-100 px-1 text-xs font-semibold text-amber-800 uppercase dark:bg-amber-950 dark:text-amber-200">Beta</span>
      </div>
      {running ? (
        <p className="text-xs text-zinc-600 dark:text-zinc-300">
          <span className="mr-1.5 inline-block size-2 animate-pulse rounded-full bg-amber-500" />
          {status.running!.total ? `${status.running!.done} of ${status.running!.total} · ` : ""}
          {status.running!.step}
        </p>
      ) : (
        <button type="button" className="btn btn-sm w-full" disabled={pending} onClick={go} title={`This board's notes as notes in Google Keep labelled "${boardName}" — kept the same both ways`}>
          {pending ? "…" : "Sync to Google Keep"}
        </button>
      )}
      <p className="text-xs text-zinc-500">
        Label “{boardName}”{linked ? ` · ${linked} linked` : ""}. Each change in Keep takes about half a minute.
      </p>
      {!running && status.last && (
        <p className={`text-xs ${status.last.ok ? "text-zinc-500" : "text-red-600 dark:text-red-400"}`}>
          Last sync {formatDateTime(status.last.at)}: {status.last.message}
        </p>
      )}
    </div>
  );
}
