"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { TodoBlock } from "@/components/todos/TodoBlock";
import { answerJobAction, proposeJobDeliveryAction, runJobDeliveryAction } from "../actions";
import type { JobPanel as JobPanelData } from "../jobs";
import { WS_CHANGED } from "./ChatPanel";

/**
 * What a job's card shows beneath its cells: the question a worker waits on (with the box to answer it), the branch and merge request
 * as links, the ticket's todos (the agent writes and ticks them; you add more), and — in review — the delivery Zeff proposes (push,
 * merge request) folded in.
 */
/** `todosShown`: the card has its own todos chip (it has a ticket key) — this panel doesn't show them twice. */
export function JobPanel({ rowId, panel, todosShown = false }: { rowId: number; panel: JobPanelData; todosShown?: boolean }) {
  const t = useT();
  // The delivery is open from the start while the job waits for your check.
  const [open, setOpen] = useState(panel.state === "Zur Prüfung");
  const [todosOpen, setTodosOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const changed = () => window.dispatchEvent(new Event(WS_CHANGED));
  const stop = { onClick: (e: React.MouseEvent) => e.stopPropagation(), onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation() };

  const act = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okText: string) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      toast(r.error, { tone: "error" });
      return changed();
    }
    toast(okText, { tone: "ok" });
    changed();
  };

  const send = async () => {
    if (!answer.trim() || busy) return;
    await act(() => answerJobAction(rowId, answer), t("Answered — the agent goes on."));
    setAnswer("");
  };

  const deliver = async (at: number) => {
    setBusy(true);
    const r = await runJobDeliveryAction(rowId, [at]);
    setBusy(false);
    if (!r.ok) {
      toast(r.error, { tone: "error" });
      return changed();
    }
    toast(r.done.join(" · ") || t("Done."), { tone: "ok" });
    changed();
  };

  const d = panel.delivery;
  const hasPush = !!d?.delivers;
  const todos = panel.todos ?? [];
  const doneCount = todos.filter((x) => x.status === "done").length;
  const link = "inline-flex max-w-full items-center gap-1 truncate rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700";
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

      {panel.links && (panel.links.branch || panel.links.mr) && (
        <div className="flex flex-wrap items-center gap-1">
          {panel.links.branch &&
            (panel.links.branch.url ? (
              <a className={link} href={panel.links.branch.url} target="_blank" rel="noreferrer" title={panel.links.branch.name}>
                ⎇ <span className="truncate">{panel.links.branch.name}</span> ↗
              </a>
            ) : (
              <span className={link} title={t("Only on this computer so far — not pushed")}>
                ⎇ <span className="truncate">{panel.links.branch.name}</span>
              </span>
            ))}
          {panel.links.mr && (
            <a className={`${link} ${/merged/i.test(panel.links.mr.state ?? "") ? "!bg-violet-100 dark:!bg-violet-950" : /opened/i.test(panel.links.mr.state ?? "") ? "!bg-emerald-100 dark:!bg-emerald-950" : ""}`} href={panel.links.mr.url} target="_blank" rel="noreferrer" title={panel.links.mr.state ?? ""}>
              MR {panel.links.mr.label} ↗
            </a>
          )}
        </div>
      )}

      {panel.ticket && !todosShown && (
        <div>
          <button
            type="button"
            aria-expanded={todosOpen}
            onClick={() => setTodosOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            title={t("The todos on {ticket} — the agent writes and ticks them, you add more", { ticket: panel.ticket })}
          >
            {todosOpen ? "▾" : "▸"} {todos.length ? `☑ ${doneCount}/${todos.length}` : t("+ Todo")}
          </button>
          {todosOpen && (
            <div className="mt-1.5">
              <TodoBlock k={panel.ticket} todos={todos} onChanged={changed} compact />
            </div>
          )}
        </div>
      )}

      {panel.state === "Zur Prüfung" && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!hasPush && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void act(() => proposeJobDeliveryAction(rowId), t("Delivery proposed."))} title={t("Look at the worker's branch and propose push and merge request")}>
              ⚡ {t("Propose delivery")}
            </button>
          )}
        </div>
      )}

      {d && hasPush && (
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
              {d.status === "done" ? (
                <div className="text-emerald-700 dark:text-emerald-400">{d.note || t("Done.")}</div>
              ) : d.status === "dismissed" ? (
                <div className="text-zinc-400">{t("Dismissed.")}</div>
              ) : (
                // One button per action, in order: push, then the merge request (each runs on its own; what ran leaves the list).
                <div className="flex flex-wrap items-center gap-1.5">
                  {d.ops.map((o, i) => (
                    <button key={o.at} type="button" className={`btn btn-sm ${i === 0 ? "btn-primary" : ""}`} disabled={busy} title={o.label} onClick={() => void deliver(o.at)}>
                      {o.type === "git-push" ? `⬆ ${t("Push")}` : o.type === "gitlab-open-mr" ? `⎇ ${t("Open MR")}` : o.type === "git-merge-main" ? `⎇ ${t("Merge into main")}` : o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
