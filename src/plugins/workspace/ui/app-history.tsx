"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { appAsNewAction, appHistoryAction, keepAppStateAction, restoreAppAction } from "../actions";

type App = { id: string; name: string; version: string; versions: string[]; savePoints: { n: number; at: string; label: string; auto: boolean; by: string; version: string }[] };
type What = { savePoint?: number; version?: string };

/**
 * The whole app's history on its top page: save points (the app with every page below it at one moment — kept on a click, and by
 * themselves before an update, a roll-back or a going back) and the versions an install or update kept. Each: back to it (what the app
 * is now is kept as a save point first), as a new app, as a template. Entries are never touched.
 */
export function AppHistory({ app: first, pageId, onDone }: { app: App; pageId: number; onDone: () => void }) {
  const t = useT();
  const router = useRouter();
  const [app, setApp] = useState(first);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const reload = useCallback(async () => {
    const r = await appHistoryAction(pageId);
    if (r.ok && r.app) setApp(r.app);
  }, [pageId]);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string, after: "reload" | "page") => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) return void toast(r.error ?? t("Didn't work."), { tone: "error" });
    toast(done, { tone: "ok", ms: 8000 });
    if (after === "page") {
      onDone();
      router.refresh();
      setTimeout(() => window.location.reload(), 300);
    } else await reload();
  };
  const back = (w: What, name: string) => {
    if (!confirmAction(t("Bring the whole app back to {name}? Its pages, fields, views, flows and forms become as they were then; your entries stay. What it is now is kept as a save point first.", { name }))) return;
    void act(() => restoreAppAction(pageId, w), t("The app is as it was."), "page");
  };
  const asNew = (w: What, template: boolean) => void act(() => appAsNewAction(pageId, w, template), template ? t("Saved as a template.") : t("Made as a new app — at the top of the page tree."), "reload");
  const when = (at: string) => new Date(at).toLocaleString();
  const Actions = ({ w, name, current }: { w: What; name: string; current?: boolean }) => (
    <span className="flex flex-wrap gap-1">
      {!current && (
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => back(w, name)}>
          ↶ {t("Back to this")}
        </button>
      )}
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => asNew(w, false)}>
        ＋ {t("As a new app")}
      </button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => asNew(w, true)}>
        📋 {t("As a template")}
      </button>
    </span>
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">{t("The whole app “{name}” with every page below it: its pages, fields, views, flows and forms — not your entries, they always stay.", { name: app.name })}</p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => keepAppStateAction(pageId, label).then((r) => (r.ok && !r.kept ? { ok: false, error: t("Nothing changed since the last save point.") } : r)), t("Kept."), "reload").then(() => setLabel(""));
        }}
      >
        <input className="input min-w-0 flex-1 py-1 text-sm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("What it is now, in a few words (optional)")} aria-label={t("Name of the save point")} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          💾 {t("Keep the current state")}
        </button>
      </form>
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">{t("Save points")}</h3>
        {app.savePoints.length === 0 && <p className="text-sm text-zinc-500">{t("None yet. One is kept by itself before every update and every going back.")}</p>}
        <ul className="max-h-[38vh] space-y-1 overflow-y-auto">
          {app.savePoints.map((s) => (
            <li key={s.n} className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800">
              <span className="min-w-0 flex-1">
                <b>{when(s.at)}</b> <span className="text-zinc-500">· {s.auto ? t("by itself") : s.by === "ai" ? t("by the AI") : t("by you")} · {s.version}</span>
                {s.label && <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">{s.label}</span>}
              </span>
              <Actions w={{ savePoint: s.n }} name={when(s.at)} />
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">{t("Versions (installs and updates)")}</h3>
        <ul className="space-y-1">
          {app.versions.map((v) => (
            <li key={v} className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800">
              <span className="min-w-0 flex-1">
                <b>{v}</b> {v === app.version && <span className="text-zinc-500">· {t("installed now")}</span>}
              </span>
              <Actions w={{ version: v }} name={v} current={v === app.version} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
