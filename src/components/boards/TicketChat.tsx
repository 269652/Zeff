"use client";

import { useState, useTransition } from "react";
import { askTicketAction, dismissChatItemAction } from "@/plugins/todos/server-actions";
import type { ChatItem } from "@/lib/boards/ticket-chat";
import { toast } from "../Toaster";
import { useT } from "../I18nProvider";

/**
 * Ask a ticket something: the answer comes from everything Zeff has on it (and the knowledge base, looked up for the
 * question). An exchange stays as the ticket's context — for the briefing, the todos' briefs, workers and agents —
 * until you dismiss it (×).
 */
export function TicketChat({ ticket, initial }: { ticket: string; initial: ChatItem[] }) {
  const t = useT();
  const [items, setItems] = useState(initial);
  const [question, setQuestion] = useState("");
  const [pending, start] = useTransition();
  const ask = () =>
    start(async () => {
      const q = question.trim();
      if (!q) return;
      const r = await askTicketAction(ticket, q);
      if (r.ok && r.item) {
        setItems((all) => [...all, r.item!]);
        setQuestion("");
      } else toast(r.error ?? t("That didn't work."), { tone: "error" });
    });
  const dismiss = (id: number) =>
    start(async () => {
      const r = await dismissChatItemAction(id);
      if (r?.ok) setItems((all) => all.filter((x) => x.id !== id));
      else toast(r?.error ?? t("That didn't work."), { tone: "error" });
    });
  return (
    <section>
      <h3 className="label">{t("Ask the ticket")}</h3>
      {items.length > 0 && (
        <ul className="mb-2 space-y-2">
          {items.map((x) => (
            <li key={x.id} className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/50">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 font-medium">{x.q}</p>
                <button type="button" className="icon-btn shrink-0" disabled={pending} onClick={() => dismiss(x.id)} title={t("Dismiss — takes it out of the ticket's context")} aria-label={t("Dismiss the answer")}>
                  ×
                </button>
              </div>
              <p className="mt-0.5 whitespace-pre-line text-zinc-700 dark:text-zinc-300">{x.a}</p>
              {x.sources.length > 0 && <p className="mt-0.5 text-zinc-500">{t("Sources: {sources}", { sources: x.sources.join(" · ") })}</p>}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <textarea
          className="input min-h-10 flex-1 text-xs"
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              ask();
            }
          }}
          placeholder={t("Ask something about {ticket} …", { ticket })}
          aria-label={t("Question about {ticket}", { ticket })}
          disabled={pending}
        />
        <button type="submit" className="btn btn-sm btn-primary" disabled={pending || !question.trim()}>
          {pending ? "…" : t("Ask")}
        </button>
      </form>
      <p className="mt-1 text-xs text-zinc-500">{t("Answers stay as context of the ticket (briefing, todos, workers) until you dismiss them.")}</p>
    </section>
  );
}
