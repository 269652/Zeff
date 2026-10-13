"use client";

import { confirmAction } from "@/components/confirm";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { pullWhatsappHistoryAction } from "./history-actions";

/**
 * "Load the whole history": the chat's messages from its very beginning — WhatsApp opens the chat in
 * the automation Chrome for that (its unread messages then count as read) and fetches older ones
 * from your phone. Can take minutes for a long chat.
 */
export function HistoryButton({ chat }: { chat: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const run = () => {
    const ask = t("Load the whole history of “{chat}”?", { chat });
    const how = t("For that the chat is opened in the automation Chrome (unread messages then count as read) and older messages are fetched from your phone — the phone has to be online. A long chat takes a few minutes.");
    if (!confirmAction(`${ask}\n\n${how}`)) return;
    start(async () => {
      const r = await pullWhatsappHistoryAction(chat);
      setResult(r.ok ? (r.message ?? "") : (r.error ?? t("That didn't work.")));
      toast(r.ok ? (r.message ?? t("Loaded.")) : (r.error ?? t("That didn't work.")), { tone: r.ok ? "ok" : "error" });
      router.refresh();
    });
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-sm" disabled={pending} onClick={run} title={t("All messages of this chat since the beginning — for the knowledge")}>
        {pending ? t("Loading the history … (can take minutes)") : t("Load the whole history")}
      </button>
      {result && !pending && <span className="text-xs text-zinc-500">{result}</span>}
    </span>
  );
}
