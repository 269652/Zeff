"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { answerAskAction, dismissAskAction, pendingAsksAction } from "../actions";
import type { AskField } from "../flows/types";

/**
 * The questions to you (asks.ts) — a flow's (a check-in, an approval), an agent's in its run — on every page: a card in the corner with
 * the question and its answers: a scale as a row of buttons (one click answers when it is all that is asked), a choice as buttons,
 * yes/no, a number, a text. "Later" folds it into a small pill, "Skip" tells whoever asked there is no answer. A new question while
 * the tab is in the background is a notification too, when you allowed them.
 */

/** Fired when something was started here that may ask: the card looks at once. */
export const ASKS_EVENT = "zeff:asks";

export type Ask = { id: number; from: string; source: string; title: string; text: string; fields: AskField[]; expiresAt: string | null; at: string };

const oneClick = (fields: AskField[]) => fields.length > 0 && ["scale", "choice", "yesno"].includes(fields[0].kind) && fields.slice(1).every((f) => !f.required);

export function AskForm({ ask, onDone }: { ask: Ask; onDone: () => void }) {
  const t = useT();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const send = async (patch: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await answerAskAction(ask.id, { ...answers, ...patch });
    setBusy(false);
    if (!r.ok) return toast(r.error, { tone: "error" });
    toast(t("Thanks — noted."), { tone: "ok", ms: 2500 });
    setAnswers({});
    onDone();
  };
  // (Only the first thing asked, and nothing else needed: a click on it is the answer.)
  const direct = oneClick(ask.fields) && ask.fields.length === 1;
  const btn = (label: string, on: boolean, click: () => void, key: string) => (
    <button key={key} type="button" disabled={busy} onClick={click} className={`min-w-8 rounded-md border px-2 py-1 text-sm font-medium transition ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 hover:border-indigo-400 hover:bg-indigo-50 dark:border-zinc-700 dark:hover:bg-indigo-950"}`}>
      {label}
    </button>
  );
  return (
    <form className="space-y-2" onSubmit={(e) => (e.preventDefault(), void send())}>
      {ask.fields.map((f, i) => {
        const v = answers[f.name];
        const set = (x: unknown, submit = false) => (direct && submit ? void send({ [f.name]: x }) : setAnswers((a) => ({ ...a, [f.name]: x })));
        return (
          <div key={f.name} className="space-y-1">
            {/* (The first answer is what the question asks: no label of its own unless it has one.) */}
            {(f.label || i > 0) && <div className="text-xs text-zinc-500">{f.label ?? f.name}</div>}
            {f.kind === "scale" && <div className="flex flex-wrap gap-1">{Array.from({ length: Math.max(0, Math.min(20, (f.max ?? 10) - (f.min ?? 1) + 1)) }, (_, k) => (f.min ?? 1) + k).map((n) => btn(String(n), v === n, () => set(n, true), String(n)))}</div>}
            {f.kind === "choice" && <div className="flex flex-wrap gap-1">{(f.options ?? []).map((o) => btn(o, v === o, () => set(o, true), o))}</div>}
            {f.kind === "yesno" && (
              <div className="flex gap-1">
                {btn(t("Yes"), v === true, () => set(true, true), "y")}
                {btn(t("No"), v === false, () => set(false, true), "n")}
              </div>
            )}
            {f.kind === "number" && <input className="input py-1" type="number" min={f.min} max={f.max} value={v === undefined ? "" : String(v)} onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))} />}
            {f.kind === "text" && <input className="input py-1" placeholder={f.required ? "" : t("optional")} value={String(v ?? "")} onChange={(e) => set(e.target.value)} />}
          </div>
        );
      })}
      {!direct && (
        <button type="submit" className="btn btn-primary btn-sm w-full" disabled={busy}>
          {t("Answer")}
        </button>
      )}
    </form>
  );
}

export function FlowAsks() {
  const t = useT();
  const [asks, setAsks] = useState<Ask[]>([]);
  const [folded, setFolded] = useState(false);
  const seen = useRef<Set<number> | null>(null);
  const load = useCallback(async () => {
    const r = await pendingAsksAction().catch(() => null);
    if (!r?.ok) return;
    const list = r.asks as Ask[];
    // (A new one while the tab is in the background: a notification too, when allowed.)
    if (seen.current && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible")
      for (const a of list) if (!seen.current.has(a.id)) new Notification(a.from, { body: a.title, tag: `zeff-ask-${a.id}` });
    if (list.some((a) => !seen.current?.has(a.id))) setFolded(false);
    seen.current = new Set(list.map((a) => a.id));
    setAsks(list);
  }, []);
  useEffect(() => {
    void (async () => {
      await load();
    })();
    // (An agent waits for its answer: looked for every half minute.)
    const id = setInterval(() => void load(), 30000);
    const now = () => void load();
    window.addEventListener("focus", now);
    window.addEventListener(ASKS_EVENT, now);
    return () => (clearInterval(id), window.removeEventListener("focus", now), window.removeEventListener(ASKS_EVENT, now));
  }, [load]);

  if (!asks.length) return null;
  const a = asks[0];
  if (folded)
    return (
      <button type="button" className="fixed right-4 bottom-4 z-40 rounded-full bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg hover:bg-indigo-500 print:hidden" onClick={() => setFolded(false)}>
        💬 {asks.length === 1 ? t("1 question") : t("{n} questions", { n: asks.length })}
      </button>
    );
  const skip = async () => {
    const r = await dismissAskAction(a.id);
    if (!r.ok) return toast(r.error, { tone: "error" });
    void load();
  };
  return (
    <div role="dialog" aria-label={a.title} className="card fixed right-4 bottom-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] space-y-2 p-3 shadow-xl print:hidden">
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-lg">
          {a.source === "agent" ? "🤖" : "💬"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-zinc-500">
            {a.from}
            {asks.length > 1 ? ` · ${t("{n} more", { n: asks.length - 1 })}` : ""}
          </div>
          <div className="font-medium">{a.title}</div>
          {a.text && <p className="text-sm whitespace-pre-line text-zinc-600 dark:text-zinc-400">{a.text}</p>}
        </div>
        <button type="button" className="icon-btn size-6" title={t("Later")} aria-label={t("Later")} onClick={() => setFolded(true)}>
          –
        </button>
      </div>
      <AskForm key={a.id} ask={a} onDone={() => void load()} />
      <div className="flex items-center justify-between">
        {typeof Notification !== "undefined" && Notification.permission === "default" ? (
          <button type="button" className="text-[11px] text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => void Notification.requestPermission()}>
            {t("Notify me of questions when Zeff is in the background")}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="text-[11px] text-zinc-500 hover:underline" onClick={() => void skip()}>
          {t("Skip")}
        </button>
      </div>
    </div>
  );
}
