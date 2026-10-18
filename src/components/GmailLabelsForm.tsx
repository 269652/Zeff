"use client";

import { useEffect, useState, useTransition } from "react";
import { gmailLabelNamesAction, saveGmailLabelsAction } from "@/app/gmail-labels-actions";
import type { ActionState } from "@/app/action-helpers";
import { useT } from "@/components/I18nProvider";

/** Which Gmail labels are kept as folders of their own (the inbox always is; Gmail's API only) — added by hand, so 50 labels don't all show up. */
export function GmailLabelsForm({ labels }: { labels: string[] }) {
  const t = useT();
  const [text, setText] = useState(labels.join(", "));
  const [choices, setChoices] = useState<string[]>([]);
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  useEffect(() => void gmailLabelNamesAction().then(setChoices), []);
  const chosen = new Set(text.split(/[,;\n]/).map((x) => x.trim().toLowerCase()));
  const add = (name: string) => setText((cur) => [...cur.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean), name].join(", "));
  return (
    <form
      className="mt-3 space-y-2 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setState(await saveGmailLabelsAction(text)));
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="gmail-labels" className="text-zinc-500">
          {t("Gmail labels as folders")}
        </label>
        <input id="gmail-labels" className="input max-w-md flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="notifications/GitHub, Rechnungen" />
        <button type="submit" className="btn btn-sm" disabled={pending}>
          {t("Save")}
        </button>
        {state && <span className={`text-xs ${state.ok ? "text-emerald-600" : "text-red-600"}`}>{state.ok ? state.message : state.error}</span>}
      </div>
      {choices.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {choices.filter((c) => !chosen.has(c.toLowerCase())).slice(0, 60).map((c) => (
            <button key={c} type="button" className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" onClick={() => add(c)}>
              + {c}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-zinc-400">{t("The inbox is mirrored always: what is archived or labelled away in Gmail leaves it here too (it stays kept, in “Gmail · Archive”). Every label you add here becomes a folder “Gmail/<label>” the same way.")}</p>
    </form>
  );
}
