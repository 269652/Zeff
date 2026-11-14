"use client";

import { useEffect, useState } from "react";
import { confirmAction } from "@/components/confirm";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import {
  functionVersionAction,
  functionVersionsAction,
  partVersionAction,
  partVersionsAction,
  restoreFunctionVersionAction,
  restorePartAction,
  restoreViewVersionAction,
  viewVersionAction,
  viewVersionsAction,
} from "../actions";
import type { HistoryItem } from "../actions/versions";
import { Modal } from "./kit";

type Res<T> = { ok: true } & T | { ok: false; error: string };
type Source = {
  list: () => Promise<Res<{ versions: HistoryItem[] }>>;
  show: (id: string) => Promise<Res<{ text: string }>>;
  restore: (id: string) => Promise<Res<object>>;
};

/**
 * The history of one part of an app, the same everywhere: its earlier versions (when, by you or the AI), one shown, brought back on a
 * click (what it is now is kept as a version in turn — a restore can be undone the same way).
 */
export function VersionHistory({ title, source, empty, onClose, onRestored }: { title: string; source: Source; empty?: string; onClose: () => void; onRestored?: () => void }) {
  const t = useT();
  const [versions, setVersions] = useState<HistoryItem[] | null>(null);
  const [shown, setShown] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void source.list().then((r) => (r.ok ? setVersions(r.versions) : (toast(r.error, { tone: "error" }), setVersions([]))));
    // (the source is made anew on every render of the caller: the list is read once, when it opens)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const by = (b: string) => (b === "ai" ? t("by the AI") : b === "you" ? t("by you") : "");
  return (
    <Modal title={title} onClose={onClose} wide>
      {versions === null ? (
        <p className="text-sm text-zinc-500">{t("Loading …")}</p>
      ) : !versions.length ? (
        <p className="text-sm text-zinc-500">{empty ?? t("No earlier versions yet — one is kept every time it changes.")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[15rem_minmax(0,1fr)]">
          <ul className="max-h-[55vh] space-y-0.5 overflow-y-auto">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${shown?.id === v.id ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                  onClick={async () => {
                    const r = await source.show(v.id);
                    if (!r.ok) return void toast(r.error, { tone: "error" });
                    setShown({ id: v.id, text: r.text });
                  }}
                >
                  {new Date(v.at).toLocaleString()}
                  <span className="block truncate text-xs text-zinc-500">{[by(v.by), t("{n} characters", { n: v.size })].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 space-y-2">
            {shown ? (
              <>
                <pre tabIndex={0} className="max-h-[48vh] overflow-auto rounded-md bg-zinc-50 p-2 font-mono text-xs whitespace-pre-wrap dark:bg-zinc-900">{shown.text || t("(empty)")}</pre>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirmAction(t("Bring this version back? What it is now is kept as a version, so you can go back to it."))) return;
                    setBusy(true);
                    const r = await source.restore(shown.id);
                    setBusy(false);
                    if (!r.ok) return void toast(r.error, { tone: "error" });
                    toast(t("Restored."), { tone: "ok" });
                    onClose();
                    onRestored?.();
                  }}
                >
                  {busy ? t("Restoring …") : t("Restore this version")}
                </button>
              </>
            ) : (
              <p className="text-sm text-zinc-500">{t("Pick a version to see it.")}</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

const partSource = (kind: string, ref: number): Source => ({ list: () => partVersionsAction(kind, ref), show: (id) => partVersionAction(id), restore: (id) => restorePartAction(id) });
const viewSource = (dbId: number, viewId: string): Source => ({ list: () => viewVersionsAction(dbId, viewId), show: (id) => viewVersionAction(id), restore: (id) => restoreViewVersionAction(id) });
const fnSource = (plugin: string, name: string): Source => ({ list: () => functionVersionsAction(plugin, name), show: (id) => functionVersionAction(plugin, name, id), restore: (id) => restoreFunctionVersionAction(plugin, name, id) });

export type HistoryOf = { kind: "flow" | "fields" | "routine" | "form"; ref: number } | { kind: "view"; dbId: number; viewId: string } | { kind: "function"; plugin: string; name: string };

const sourceOf = (of: HistoryOf): Source => (of.kind === "view" ? viewSource(of.dbId, of.viewId) : of.kind === "function" ? fnSource(of.plugin, of.name) : partSource(of.kind, of.ref));

/** The history of one part, opened (from a menu: the menu closes, this stays); the page reloads after a restore unless `onRestored` says. */
export function HistoryModal({ of, title, onClose, onRestored }: { of: HistoryOf; title?: string; onClose: () => void; onRestored?: () => void }) {
  const t = useT();
  const titles: Record<HistoryOf["kind"], string> = { flow: t("Flow history"), fields: t("History of the fields"), routine: t("Routine history"), form: t("Form history"), view: t("History of this view"), function: t("Function history") };
  const empty = of.kind === "fields" ? t("No earlier versions yet. A restore brings fields back as they were; fields added since stay, with their data.") : undefined;
  return <VersionHistory title={title ?? titles[of.kind]} source={sourceOf(of)} empty={empty} onClose={onClose} onRestored={onRestored ?? (() => window.location.reload())} />;
}

/** A "History" button for one part. */
export function HistoryButton({ of, title, label, className, onRestored }: { of: HistoryOf; title?: string; label?: string; className?: string; onRestored?: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className ?? "btn btn-sm"} onClick={() => setOpen(true)}>
        🕘 {label ?? t("History")}
      </button>
      {open && <HistoryModal of={of} title={title} onClose={() => setOpen(false)} onRestored={onRestored} />}
    </>
  );
}
