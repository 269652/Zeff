"use client";

import { useActionState } from "react";
import { importJiraAction, syncJiraAction, type ActionState } from "@/app/actions";
import type { UiOpenState } from "@/lib/ui-state-shared";
import { PersistentDetails } from "./PersistentDetails";
import { SubmitButton } from "./SubmitButton";

export function JiraSyncControls({ configured, ui }: { configured: boolean; ui: UiOpenState }) {
  const [syncState, sync] = useActionState<ActionState, FormData>(syncJiraAction, null);
  const [importState, imp] = useActionState<ActionState, FormData>(importJiraAction, null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={sync}>
          <SubmitButton className="btn btn-primary" pendingText="Syncing…">Sync from Jira</SubmitButton>
        </form>
        {!configured && (
          <span className="text-sm text-zinc-500">
            Set <code className="code">JIRA_MCP_COMMAND</code> to enable, or use paste import below.
          </span>
        )}
        {syncState?.error && <span className="text-sm text-red-600 dark:text-red-400">{syncState.error}</span>}
        {syncState?.ok && <span className="text-sm text-emerald-600 dark:text-emerald-400">{syncState.message}</span>}
      </div>

      <PersistentDetails name="jira-paste" ui={ui} className="text-sm">
        <summary className="cursor-pointer text-zinc-500">Paste issues JSON (no server needed)</summary>
        <form action={imp} className="mt-2 space-y-2">
          <textarea
            name="json"
            rows={4}
            className="input font-mono text-xs"
            placeholder='[{"key":"PROJ-80","fields":{"summary":"…","status":{"name":"In Progress","statusCategory":{"key":"indeterminate"}}}}]  — or  {"issues":[…]}'
          />
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton className="btn" pendingText="Importing…">Import pasted</SubmitButton>
            {importState?.error && <span className="text-sm text-red-600 dark:text-red-400">{importState.error}</span>}
            {importState?.ok && <span className="text-sm text-emerald-600 dark:text-emerald-400">{importState.message}</span>}
          </div>
        </form>
      </PersistentDetails>
    </div>
  );
}
