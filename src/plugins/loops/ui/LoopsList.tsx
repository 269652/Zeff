"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { decideLoopAction, loopsAction, type ShownLoop } from "../server-actions";
import { kindLabel, LOOP_VIEWS, viewLabel, type LoopView } from "../shared";
import type { LoopOp } from "../store";

/**
 * Open loops that read themselves: every open one, a view of them (what I owe, what I'm owed, overdue, closed lately), a person's
 * (`personId`) or a Workspace row's person (`row`). Each with who owes, what, since when, its quote and where it was said — and your
 * word on it: done, not a loop, confirm (what the AI read), later; a proposal to close it (a reply about it, or the AI's reading)
 * to confirm or reject; a closed one to reopen.
 */
export function LoopsList({ personId, row, initialView, tabs = true, title, hideWhenOff = false, hideWhenEmpty = false, compact = false }: { personId?: number; row?: number; initialView?: LoopView | "all"; tabs?: boolean; title?: string; hideWhenOff?: boolean; hideWhenEmpty?: boolean; compact?: boolean }) {
  const t = useT();
  const [view, setView] = useState<LoopView | "all">(initialView ?? "all");
  const [loops, setLoops] = useState<ShownLoop[] | null>(null);
  const [counts, setCounts] = useState<{ mine: number; theirs: number; overdue: number } | null>(null);
  const [error, setError] = useState("");
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const r = await loopsAction({ view: view === "all" ? undefined : view, personId, row });
    if (!r.ok) return r.off ? (setOff(true), setError(r.error)) : setError(r.error);
    setError("");
    setLoops(r.loops);
    setCounts(r.counts);
  }, [view, personId, row]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (ref: string, op: LoopOp) => {
    setBusy(`${ref}:${op}`);
    const r = await decideLoopAction(ref, op);
    setBusy("");
    if (!r.ok) setError(r.error);
    await load();
  };

  if (off && hideWhenOff) return null;
  if (hideWhenEmpty && loops && !loops.length && view === (initialView ?? "all")) return null;

  const tab = (on: boolean) => `rounded-full border px-2 py-0.5 text-xs ${on ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"}`;
  const n = (v: LoopView | "all") => (!counts ? null : v === "all" ? counts.mine + counts.theirs : v === "closed" ? null : counts[v]);
  const btn = (ref: string, op: LoopOp, label: string, tip: string, tone = "") => (
    <button type="button" className={`btn btn-sm ${tone}`} title={tip} disabled={!!busy} onClick={() => void decide(ref, op)}>
      {busy === `${ref}:${op}` ? "…" : label}
    </button>
  );

  return (
    <div className="space-y-2">
      {title && <h2 className="text-sm font-semibold">{title}</h2>}
      {tabs && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("Open loops")}>
          {(["all", ...LOOP_VIEWS] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={tab(view === v)} onClick={() => setView(v)}>
              {v === "all" ? t("All open") : viewLabel(t, v)}
              {n(v) ? <span className="ml-1 tabular-nums opacity-70">{n(v)}</span> : null}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loops === null ? (
        <p className="text-sm text-zinc-400">…</p>
      ) : !loops.length ? (
        <p className="text-sm text-zinc-500">{view === "closed" ? t("Nothing closed in the last two weeks.") : t("Nothing open — no promises, questions or requests waiting.")}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {loops.map((l) => (
            <li key={l.ref} className="space-y-1 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <span className={`shrink-0 text-xs font-medium ${l.direction === "mine" ? "text-amber-700 dark:text-amber-400" : "text-sky-700 dark:text-sky-400"}`}>{l.direction === "mine" ? t("I owe") : t("They owe")}</span>
                <span className="shrink-0 rounded bg-zinc-100 px-1 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{kindLabel(t, l.kind)}</span>
                {!personId && !row && (l.personHref ? <a href={l.personHref} className="shrink-0 font-medium hover:underline">{l.who}</a> : <span className="shrink-0 font-medium">{l.who}</span>)}
                <span className="min-w-0 flex-1" title={l.quote ? `“${l.quote}”` : undefined}>
                  {l.text}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                <span>{t("since {day}", { day: l.at.slice(0, 10) })}</span>
                {l.due && <span className={l.overdue ? "font-medium text-red-600 dark:text-red-400" : ""}>{t("due {day}", { day: l.due })}</span>}
                {l.overdue && !l.due && <span className="font-medium text-red-600 dark:text-red-400">{t("overdue")}</span>}
                {!l.confirmed && <span className="text-zinc-400" title={t("Read by the AI — confirm it or say it isn't one.")}>{t("unconfirmed")}</span>}
                {l.href && (
                  <a href={l.href} className="hover:underline" target={l.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                    {t("where it was said")}
                  </a>
                )}
                {!compact && l.quote && l.quote !== l.text && <span className="min-w-0 truncate italic text-zinc-400">“{l.quote}”</span>}
              </div>
              {l.proposal && l.state === "open" && (
                <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs dark:border-emerald-900 dark:bg-emerald-950">
                  <span className="min-w-0 flex-1">
                    {l.proposal.by === "ai" ? t("Kept? The AI read:") : t("Kept? A reply about it:")} <span className="italic">“{l.proposal.quote}”</span>
                    {l.proposal.href && (
                      <a href={l.proposal.href} className="ml-1 underline" target={l.proposal.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                        {t("show message")}
                      </a>
                    )}
                  </span>
                  {btn(l.ref, "accept-close", t("Yes, kept"), t("Close it — what you say is noted, so Zeff learns what keeps a promise"))}
                  {btn(l.ref, "reject-close", t("No, still open"), t("This doesn't close it — it won't be proposed again"))}
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {l.state === "open" ? (
                  <>
                    {btn(l.ref, "close", t("Done"), t("Kept or answered — closed"))}
                    {!l.confirmed && btn(l.ref, "confirm", t("Confirm"), t("Yes, this is open between you"))}
                    {btn(l.ref, "dismiss", t("Not a loop"), t("Nothing is owed here — it goes, and Zeff learns from it"))}
                    {l.overdue && btn(l.ref, "later", t("Later"), t("Not on the Today page for a few days"))}
                  </>
                ) : (
                  <>
                    <span className="text-xs text-zinc-500">
                      {l.closedBy === "rule" ? t("Closed by its source") : l.closedBy === "ai" ? t("Closed (the AI's reading, confirmed)") : t("Closed by you")}
                      {l.closeQuote && <span className="italic"> — “{l.closeQuote.slice(0, 160)}”</span>}
                    </span>
                    {btn(l.ref, "reopen", t("Reopen"), t("Not kept after all — open again (and not closed this way again)"))}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
