"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { aiMergeAction, cancelMergeAction, finishMergeAction, pendingMergeAction, settleConflictAction, type MergeFileView, type MergeView } from "@/lib/ext/source-actions";

/**
 * An update that waits for its conflicts: per file, what was installed (base), what you changed (mine) and what the new version brings
 * (theirs) — and the result to write, which starts as git's merge with both sides between markers. Keep mine, take theirs, ✨ let the AI
 * merge (its text lands in the result for you to check), or write it yourself; when every file is settled, Finish writes the update.
 * Cancel leaves the plugin as it is.
 */
export function MergeResolver({ pluginId, onClose }: { pluginId: string; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [merge, setMerge] = useState<MergeView | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [tab, setTab] = useState<"result" | "mine" | "theirs" | "base">("result");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await pendingMergeAction(pluginId);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setMerge(r.merge);
    setPick((p) => p ?? r.merge?.files.find((f) => f.outcome === "conflict" && !f.resolved)?.rel ?? r.merge?.files.find((f) => f.outcome === "conflict")?.rel ?? null);
  }, [pluginId]);
  useEffect(() => {
    let live = true;
    void pendingMergeAction(pluginId).then((r) => {
      if (!live) return;
      if (!r.ok) return void toast(r.error, { tone: "error" });
      setMerge(r.merge);
      setPick(r.merge?.files.find((f) => f.outcome === "conflict" && !f.resolved)?.rel ?? r.merge?.files.find((f) => f.outcome === "conflict")?.rel ?? null);
    });
    return () => {
      live = false;
    };
  }, [pluginId]);

  const conflicts = useMemo(() => (merge?.files ?? []).filter((f) => f.outcome === "conflict"), [merge]);
  const others = (merge?.files ?? []).filter((f) => f.outcome !== "conflict" && f.outcome !== "keep");
  const open = conflicts.filter((f) => !f.resolved).length;
  const f: MergeFileView | undefined = conflicts.find((x) => x.rel === pick);
  const resultText = f ? (draft[f.rel] ?? (f.resolved ? (f.result ?? "") : (f.markers ?? f.mine ?? ""))) : "";
  const hasMarkers = /^(<{7}|>{7})/m.test(resultText);

  const settle = async (how: "mine" | "theirs" | "ai" | "edited", content?: string | null) => {
    if (!f) return;
    setBusy(how);
    const r = await settleConflictAction(pluginId, f.rel, how, content);
    setBusy(null);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setDraft((d) => {
      const n = { ...d };
      delete n[f.rel];
      return n;
    });
    await load();
    // (on to the next one still open)
    const next = conflicts.find((x) => !x.resolved && x.rel !== f.rel);
    if (next) setPick(next.rel);
    setTab("result");
  };
  const askAi = async () => {
    if (!f) return;
    setBusy("ai");
    const r = await aiMergeAction(pluginId, f.rel);
    setBusy(null);
    if (!r.ok) return void toast(r.error, { tone: "error", ms: 12000 });
    setDraft((d) => ({ ...d, [f.rel]: r.text }));
    setNote((n) => ({ ...n, [f.rel]: r.note }));
    setTab("result");
  };
  const finish = async () => {
    setBusy("finish");
    const r = await finishMergeAction(pluginId);
    setBusy(null);
    if (!r.ok) return void toast(r.error, { tone: "error", ms: 12000 });
    toast(r.message, { tone: "ok", ms: 12000 });
    router.refresh();
    onClose();
  };
  const cancel = async () => {
    setBusy("cancel");
    const r = await cancelMergeAction(pluginId);
    setBusy(null);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    toast(t("The update was dropped — the plugin stays as it is."));
    onClose();
  };

  const side = (s: string | null | undefined) => (s === null ? t("(not there)") : (s ?? ""));
  return (
    <Modal title={merge ? t("Merge {id} {from} → {to}", { id: pluginId, from: merge.from ?? "—", to: merge.to }) : t("Merge")} onClose={onClose} wide>
      {!merge ? (
        <p className="text-sm text-zinc-500">{merge === null ? t("No update is waiting for this plugin.") : "…"}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {open === 1
              ? t("A file was changed both here and in the new version, in the same place. Settle it — nothing is written until then.")
              : open
                ? t("{n} files were changed both here and in the new version, in the same places. Settle each — nothing is written until all are.", { n: open })
                : t("Every conflict is settled. Finish writes the update.")}
            {others.length > 0 && <span className="text-zinc-400"> {others.length === 1 ? t("(One more file is updated or merged by itself.)") : t("({n} more files are updated or merged by themselves.)", { n: others.length })}</span>}
          </p>
          <div className="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
            <ul className="space-y-0.5 text-sm" aria-label={t("Conflicts")}>
              {conflicts.map((c) => (
                <li key={c.rel}>
                  <button type="button" className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${c.rel === pick ? "bg-indigo-50 font-medium text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`} onClick={() => (setPick(c.rel), setTab("result"))}>
                    <span aria-hidden className={c.resolved ? "text-emerald-600" : "text-amber-600"}>
                      {c.resolved ? "✓" : "●"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{c.rel}</span>
                    {c.resolved && <span className="text-[10px] text-zinc-400">{c.resolved === "mine" ? t("mine") : c.resolved === "theirs" ? t("theirs") : c.resolved === "ai" ? "✨" : t("edited")}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {f && (
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-1 text-xs" role="tablist">
                  {(
                    [
                      ["result", t("Result")],
                      ["mine", t("Mine (changed here)")],
                      ["theirs", t("Theirs (new version)")],
                      ["base", t("Base (installed)")],
                    ] as const
                  ).map(([k, l]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} className={`rounded-md px-2 py-1 ${tab === k ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`} onClick={() => setTab(k)}>
                      {l}
                    </button>
                  ))}
                </div>
                {f.binary ? (
                  <p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{t("This file is not text — keep yours or take theirs.")}</p>
                ) : tab === "result" ? (
                  <>
                    <textarea
                      className="h-80 w-full resize-y rounded-lg border border-zinc-300 bg-white p-2 font-mono text-xs leading-relaxed dark:border-zinc-700 dark:bg-zinc-950"
                      spellCheck={false}
                      value={resultText}
                      aria-label={t("Result")}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.rel]: e.target.value }))}
                    />
                    {note[f.rel] && <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">✨ {note[f.rel]}</p>}
                    {hasMarkers && <p className="text-xs text-amber-700 dark:text-amber-400">{t("The text still holds both sides between <<<<<<< and >>>>>>> — settle them, or let the AI merge.")}</p>}
                  </>
                ) : (
                  <pre className="h-80 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-900">{side(tab === "mine" ? f.mine : tab === "theirs" ? f.theirs : f.base)}</pre>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void settle("mine")}>
                    {t("Keep mine")}
                  </button>
                  <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void settle("theirs")}>
                    {t("Take theirs")}
                  </button>
                  {!f.binary && (
                    <>
                      <button type="button" className="btn btn-sm text-violet-700 dark:text-violet-300" disabled={!!busy} onClick={() => void askAi()}>
                        {busy === "ai" ? t("The AI is merging …") : `✨ ${t("Merge with AI")}`}
                      </button>
                      <button type="button" className="btn btn-primary btn-sm ml-auto" disabled={!!busy || hasMarkers} title={hasMarkers ? t("The text still holds both sides between <<<<<<< and >>>>>>> — settle them, or let the AI merge.") : undefined} onClick={() => void settle(note[f.rel] && draft[f.rel] !== undefined ? "ai" : "edited", resultText)}>
                        {t("Use this text")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void cancel()}>
              {t("Drop the update")}
            </button>
            <button type="button" className="btn btn-primary" disabled={!!busy || open > 0} onClick={() => void finish()}>
              {busy === "finish" ? t("Working …") : open === 1 ? t("One still open") : open ? t("{n} still open", { n: open }) : t("Finish the update")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
