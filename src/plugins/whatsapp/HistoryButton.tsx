"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { pullWhatsappHistoryAction } from "./history-actions";

/**
 * "Ganzen Verlauf laden": the chat's messages from its very beginning — WhatsApp opens the chat in
 * the automation Chrome for that (its unread messages then count as read) and fetches older ones
 * from your phone. Can take minutes for a long chat.
 */
export function HistoryButton({ chat }: { chat: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const run = () => {
    if (!confirm(`Den ganzen Verlauf von „${chat}“ laden?\n\nDafür wird der Chat im Automations-Chrome geöffnet (ungelesene Nachrichten gelten dann als gelesen) und ältere Nachrichten werden von deinem Telefon geholt — das Telefon muss online sein. Ein langer Chat dauert einige Minuten.`)) return;
    start(async () => {
      const r = await pullWhatsappHistoryAction(chat);
      setResult(r.ok ? (r.message ?? "") : (r.error ?? "Ging nicht."));
      toast(r.ok ? (r.message ?? "Geladen.") : (r.error ?? "Ging nicht."), { tone: r.ok ? "ok" : "error" });
      router.refresh();
    });
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-sm" disabled={pending} onClick={run} title="Alle Nachrichten dieses Chats seit Beginn — für das Wissen">
        {pending ? "Lädt den Verlauf … (kann Minuten dauern)" : "Ganzen Verlauf laden"}
      </button>
      {result && !pending && <span className="text-xs text-zinc-500">{result}</span>}
    </span>
  );
}
