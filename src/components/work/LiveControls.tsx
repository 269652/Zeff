"use client";

import { useState, useTransition } from "react";
import type { WorkRunView } from "@/lib/work/shared";
import { Markdown } from "../Markdown";
import { toast } from "../Toaster";

const MODE_HINT: Record<string, string> = {
  agent: "Asks you before it does anything that isn't allowed",
  plan: "Plans first, carries it out after your OK",
  autopilot: "Allows itself everything and runs through to the end",
};
const short = (id: string) => id.replace(/^.*#/, "");

/**
 * A live Copilot session's controls: its mode (Agent, Plan, Autopilot — switch any time), what
 * it asks permission for (allow once, always, or not), and — between its turns — your answer to
 * it, or "wrap up" for its result.
 */
export function LiveControls({ run }: { run: WorkRunView }) {
  const live = run.live!;
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  // Through a plain request: the page refreshing meanwhile (the session keeps changing it) can't cancel it.
  const post = (body: Record<string, string>) =>
    fetch(`/api/work/${run.id}/live`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json() as Promise<{ ok: boolean; error?: string }>)
      .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  const act = (body: Record<string, string>, then?: () => void) =>
    start(async () => {
      const r = await post(body);
      if (!r.ok) toast(r.error ?? "Didn't work.", { tone: "error" });
      else then?.();
    });
  const send = () => text.trim() && act({ do: "send", text }, () => setText(""));

  return (
    <div className="space-y-2 rounded-md border border-indigo-200 bg-indigo-50/50 p-2.5 text-sm dark:border-indigo-900 dark:bg-indigo-950/30">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-500 uppercase">Mode</span>
        <span className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700" role="radiogroup" aria-label="Mode">
          {live.modes.map((m) => {
            const on = m.id === live.mode;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={pending || on}
                onClick={() => act({ do: "mode", mode: m.id })}
                title={MODE_HINT[short(m.id)] ?? m.name}
                className={`px-2.5 py-1 text-xs font-medium ${on ? (short(m.id) === "autopilot" ? "bg-amber-500 text-white" : "bg-indigo-600 text-white") : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300"}`}
              >
                {m.name}
              </button>
            );
          })}
        </span>
        <span className="text-xs text-zinc-500">{live.busy ? (live.permission ? "waiting for your permission" : "working…") : "waiting for you"}</span>
      </div>

      {live.permission && (
        <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="font-medium text-amber-950 dark:text-amber-100">Copilot wants to: {live.permission.title}</p>
          {live.permission.detail && <pre className="max-h-40 overflow-auto rounded bg-white/70 p-1.5 font-mono text-xs whitespace-pre-wrap dark:bg-zinc-900/70">{live.permission.detail}</pre>}
          <div className="flex flex-wrap gap-1.5">
            {live.permission.options.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={pending}
                onClick={() => act({ do: "answer", option: o.id })}
                className={`btn btn-sm ${o.kind === "allow_once" ? "btn-primary" : ""}`}
              >
                {o.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {!live.busy && (
        <div className="space-y-1.5">
          {live.waiting && (
            <div className="max-h-48 overflow-auto rounded bg-white/70 p-2 text-xs dark:bg-zinc-900/70">
              <Markdown text={live.waiting} />
            </div>
          )}
          <textarea
            rows={2}
            className="input w-full resize-y text-sm"
            placeholder="Your answer to Copilot… (Ctrl+Enter)"
            value={text}
            disabled={pending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn btn-sm btn-primary" disabled={pending || !text.trim()} onClick={send}>
              Send
            </button>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => act({ do: "wrap-up" })} title="Copilot sums up and gives its result — that ends the run">
              Wrap up
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
