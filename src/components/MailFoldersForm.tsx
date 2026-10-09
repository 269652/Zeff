"use client";

import { useState, useTransition } from "react";
import { saveMailFoldersAction, type ActionState } from "@/app/actions";

/** Which Outlook folders the mail sync reads — by name as Outlook's folder list shows them, comma-separated. */
export function MailFoldersForm({ folders }: { folders: string[] }) {
  const [text, setText] = useState(folders.join(", "));
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => setState(await saveMailFoldersAction(null, fd)));
      }}
    >
      <label htmlFor="mail-folders" className="text-zinc-500">
        Ordner
      </label>
      <input id="mail-folders" name="folders" className="input max-w-md flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Posteingang, Notifications" />
      <button type="submit" className="btn btn-sm" disabled={pending}>
        Speichern
      </button>
      {state && <span className={`text-xs ${state.ok ? "text-emerald-600" : "text-red-600"}`}>{state.ok ? state.message : state.error}</span>}
      <span className="w-full text-xs text-zinc-400">Namen wie in Outlooks Ordnerliste, mit Komma getrennt — z. B. der Ordner, in den eine Regel Jira- und GitLab-Benachrichtigungen legt.</span>
    </form>
  );
}
