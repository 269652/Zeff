"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { pullWhatsappHistoryAction } from "./history-actions";

/**
 * "Load the whole history": the chat's messages from its very beginning — WhatsApp opens the chat in
 * the automation Chrome for that (its unread messages then count as read) and fetches older ones
 * from your phone. Can take minutes for a long chat.
 */
export function HistoryButton({ chat }: { chat: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const run = () => {
    if (!confirm(`Load the whole history of “${chat}”?\n\nFor that the chat is opened in the automation Chrome (unread messages then count as read) and older messages are fetched from your phone — the phone has to be online. A long chat takes a few minutes.`)) return;
    start(async () => {
      const r = await pullWhatsappHistoryAction(chat);
      setResult(r.ok ? (r.message ?? "") : (r.error ?? "That didn't work."));
      toast(r.ok ? (r.message ?? "Loaded.") : (r.error ?? "That didn't work."), { tone: r.ok ? "ok" : "error" });
      router.refresh();
    });
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-sm" disabled={pending} onClick={run} title="All messages of this chat since the beginning — for the knowledge">
        {pending ? "Loading the history … (can take minutes)" : "Load the whole history"}
      </button>
      {result && !pending && <span className="text-xs text-zinc-500">{result}</span>}
    </span>
  );
}
