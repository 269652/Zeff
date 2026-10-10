"use client";

import { useState, useTransition } from "react";
import { saveMailFoldersAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";

/** Which Outlook folders the mail sync reads — by name as Outlook&apos;s folder list shows them, comma-separated. */
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
        Outlook folders
      </label>
      <input id="mail-folders" name="folders" className="input max-w-md flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Posteingang, Notifications" />
      <button type="submit" className="btn btn-sm" disabled={pending}>
        Save
      </button>
      {state && <span className={`text-xs ${state.ok ? "text-emerald-600" : "text-red-600"}`}>{state.ok ? state.message : state.error}</span>}
      <span className="w-full text-xs text-zinc-400">Names as in Outlook&apos;s folder list, separated by commas — e.g. the folder a rule moves Jira and GitLab notifications into.</span>
    </form>
  );
}
