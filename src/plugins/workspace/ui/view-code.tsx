"use client";

import { confirmAction } from "@/components/confirm";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import type { View } from "../model";
import type { ViewAppMeta } from "../view-apps";
import { viewTemplateAiAction, type ViewChatTurn } from "../view-template-actions";
import { viewReference, type TplError } from "../view-template";
import { TemplateEditor } from "./template-editor";
import { ViewBuilder } from "./view-builder";
import { templateToTree, treeToTemplate } from "../view-tree";

/**
 * A view's template as code (the view drawn from it shows below, live): written by hand — with its errors by line and the language's
 * reference — or by the AI in a chat ("put the fixed costs on top"); saved for the view, or as a new view; back to the app's default.
 */
export function ViewCode({ view, dbId, meta, draft, setDraft, errors, onSave, onNewView, onClose, rowId, fields, head }: { view: View; dbId: number; meta: ViewAppMeta; draft: string; setDraft: (s: string) => void; errors: TplError[]; onSave: (template: string | null) => void; /** None: no new view from here (a row's own page). */ onNewView?: (template: string, name: string) => void; onClose: () => void; /** A row's own page: the row it is about. */ rowId?: number; /** The database's fields (the editor completes them). */ fields?: string[]; /** What its header starts with instead of its title (the Studio's: the app, its buttons). */ head?: React.ReactNode }) {
  const t = useT();
  const [help, setHelp] = useState(false);
  const [chat, setChat] = useState<ViewChatTurn[]>([]);
  const [ask, setAsk] = useState("");
  const [asNew, setAsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"code" | "visual">("visual");
  const changed = draft !== (view.template ?? meta.defaultTemplate(t));
  const lines = draft.split("\n").length;


  const send = async () => {
    const request = ask.trim();
    if (!request || busy) return;
    setBusy(true);
    const history = [...chat, { role: "user" as const, text: request }];
    setChat(history);
    setAsk("");
    const r = await viewTemplateAiAction({ dbId, app: view.app ?? "template", current: asNew ? "" : draft, request, history: chat, ...(rowId ? { row: rowId } : {}) });
    setBusy(false);
    if (!r.ok) {
      setChat([...history, { role: "assistant", text: `⚠ ${r.error}` }]);
      return void toast(r.error, { tone: "error" });
    }
    setChat([...history, { role: "assistant", text: r.note + (r.errors.length ? ` (${t("{n} errors left", { n: r.errors.length })})` : "") }]);
    if (asNew && onNewView) {
      onNewView(r.template, request.slice(0, 40));
      setAsNew(false);
    } else setDraft(r.template);
  };

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        {head ?? (
          <>
            <span className="font-mono text-sm font-semibold text-indigo-700 dark:text-indigo-300">&lt;/&gt;</span>
            <span className="text-sm font-medium">{t("The view “{name}” as code", { name: view.name })}</span>
          </>
        )}
        <span className="text-xs text-zinc-500">{view.template ? t("changed by you") : t("the default")}</span>
        <span className="flex-1" />
        <button type="button" className={`btn btn-sm ${help ? "bg-zinc-100 dark:bg-zinc-800" : ""}`} aria-pressed={help} onClick={() => setHelp(!help)}>
          ? {t("Language")}
        </button>
        {view.template && (
          <button type="button" className="btn btn-sm" onClick={() => confirmAction(t("Back to the default view? Your changes are gone.")) && onSave(null)}>
            ↺ {t("Reset to default")}
          </button>
        )}
        {!head && (
          <button type="button" className="btn btn-sm" onClick={onClose}>
            {t("Close")}
          </button>
        )}
        <button type="button" className="btn btn-primary btn-sm" disabled={!changed || errors.length > 0} title={errors.length ? t("Fix the errors first") : undefined} onClick={() => onSave(draft.trim() === meta.defaultTemplate(t).trim() ? null : draft)}>
          {t("Save")}
        </button>
      </div>

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
        {(
          [
            ["visual", `✥ ${t("Drag & drop")}`],
            ["code", `</> ${t("Code & AI")}`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === id ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "visual" && <ViewBuilder value={draft} onChange={setDraft} />}
      {tab === "code" && (
        <div className="-mt-1 flex justify-end">
          <button type="button" className="btn btn-sm" disabled={errors.length > 0 || templateToTree(draft).errors.length > 0} title={t("Each element on a line of its own, indented")} onClick={() => setDraft(treeToTemplate(templateToTree(draft).nodes))}>
            ⇥ {t("Format")}
          </button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" hidden={tab !== "code"}>
        <div className="space-y-2">
          <TemplateEditor value={draft} onChange={setDraft} errors={errors} fields={fields ?? []} parts={meta.parts} actions={meta.actions} onSave={() => changed && !errors.length && onSave(draft)} />
          {errors.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-red-600 dark:text-red-400">
              {errors.slice(0, 8).map((e, i) => (
                <li key={i}>
                  {t("Line {n}", { n: e.line })}: {e.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-zinc-500">{t("No errors — the view below shows it as it is now. Ctrl+S saves.")}</p>
          )}
          {help && <pre tabIndex={0} className="max-h-80 overflow-auto rounded-lg bg-zinc-50 p-3 text-[11px] leading-4 whitespace-pre-wrap text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{viewReference(meta.parts, meta.actions)}</pre>}
        </div>

        <div className="flex min-h-48 flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-800">✨ {t("Change the view with the AI")}</div>
          <ul className="max-h-72 flex-1 space-y-2 overflow-y-auto p-3 text-sm">
            {!chat.length && <li className="text-xs text-zinc-500">{t("For example: “Show the fixed costs on top”, “Only the open rows, as cards”, “A list on the left, the row picked on the right”.")}</li>}
            {chat.map((c, i) => (
              <li key={i} className={c.role === "user" ? "ml-6 rounded-lg bg-indigo-50 px-2.5 py-1.5 dark:bg-indigo-950/50" : "mr-6 rounded-lg bg-zinc-100 px-2.5 py-1.5 dark:bg-zinc-800"}>
                {c.text}
              </li>
            ))}
            {busy && <li className="mr-6 animate-pulse rounded-lg bg-zinc-100 px-2.5 py-1.5 text-zinc-500 dark:bg-zinc-800">{t("Writing the view …")}</li>}
          </ul>
          <form
            className="space-y-1.5 border-t border-zinc-100 p-2 dark:border-zinc-800"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              rows={2}
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void send())}
              placeholder={t("What should the view show or do?")}
              aria-label={t("What should the view show or do?")}
              className="input w-full resize-none text-sm"
            />
            <div className="flex items-center gap-2">
              {onNewView && (
                <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                  <input type="checkbox" className="accent-indigo-600" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} />
                  {t("as a new view")}
                </label>
              )}
              <span className="flex-1" />
              <button className="btn btn-primary btn-sm" disabled={busy || !ask.trim()}>
                {busy ? "…" : t("Send")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
