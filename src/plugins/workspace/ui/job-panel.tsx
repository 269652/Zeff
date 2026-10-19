"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { answerJobAction, runJobDeliveryAction } from "../actions";
import type { JobPanel as JobPanelData } from "../jobs";
import { WS_CHANGED } from "./ChatPanel";

/**
 * What a job's card shows beneath its cells: the question a worker waits on (with the box to answer it), and the delivery Zeff
 * proposes once the work is in a branch — push it, open the merge request — folded in, to open and run from the card.
 */
export function JobPanel({ rowId, panel }: { rowId: number; panel: JobPanelData }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const changed = () => window.dispatchEvent(new Event(WS_CHANGED));
  const stop = { onClick: (e: React.MouseEvent) => e.stopPropagation(), onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation() };

  const send = async () => {
    if (!answer.trim() || busy) return;
    setBusy(true);
    const r = await answerJobAction(rowId, answer);
    setBusy(false);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setAnswer("");
    toast(t("Answered — the agent goes on."), { tone: "ok" });
    changed();
  };

  const deliver = async () => {
    setBusy(true);
    const r = await runJobDeliveryAction(rowId);
    setBusy(false);
    if (!r.ok) {
      toast(r.error, { tone: "error" });
      return changed();
    }
    toast(r.done.join(" · ") || t("Done."), { tone: "ok" });
    changed();
  };

  const d = panel.delivery;
  return (
    <div className="mt-1.5 space-y-1.5" {...stop}>
      {panel.question && (
        <div className="rounded-md bg-amber-50 p-2 text-sm ring-1 ring-amber-300 dark:bg-amber-950/40 dark:ring-amber-800">
          <div className="font-medium text-amber-800 dark:text-amber-300">❓ {panel.question}</div>
          <textarea
            className="input mt-1.5 w-full text-sm"
            rows={2}
            value={answer}
            readOnly={busy}
            placeholder={t("Your answer …")}
            aria-label={t("Your answer")}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
          />
          <button type="button" className="btn btn-primary btn-sm mt-1" disabled={busy || !answer.trim()} onClick={() => void send()}>
            {t("Answer")}
          </button>
        </div>
      )}
      {d && (
        <div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex max-w-full items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            title={d.text}
          >
            {open ? "▾" : "▸"} <span className="truncate">{d.status === "done" ? `✓ ${t("Delivered")}` : `⚡ ${t("Delivery")}`}</span>
          </button>
          {open && (
            <div className="mt-1 space-y-1 rounded-md border border-indigo-200 p-2 text-xs dark:border-indigo-900">
              <div className="text-zinc-700 dark:text-zinc-200">{d.text}</div>
              <ul className="list-disc pl-4 text-zinc-500">
                {d.ops.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
              {d.status === "done" ? (
                <div className="text-emerald-700 dark:text-emerald-400">{d.note || t("Done.")}</div>
              ) : d.status === "dismissed" ? (
                <div className="text-zinc-400">{t("Dismissed.")}</div>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void deliver()}>
                  ⚡ {t("Push and open the merge request")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
