"use client";

import { FormError } from "@/components/FormError";
import { useActionState } from "react";
import { importJiraAction, syncJiraAction } from "@/plugins/jira/server-actions";
import type { ActionState } from "@/app/action-helpers";
import type { UiOpenState } from "@/lib/ui-state-shared";
import { useT } from "@/components/I18nProvider";
import { rich } from "@/lib/i18n/rich";
import { PersistentDetails } from "./PersistentDetails";
import { SubmitButton } from "./SubmitButton";

export function JiraSyncControls({ configured, ui }: { configured: boolean; ui: UiOpenState }) {
  const t = useT();
  const [syncState, sync] = useActionState<ActionState, FormData>(syncJiraAction, null);
  const [importState, imp] = useActionState<ActionState, FormData>(importJiraAction, null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={sync}>
          <SubmitButton className="btn btn-primary" pendingText={t("Syncing…")}>{t("Sync from Jira")}</SubmitButton>
        </form>
        {!configured && (
          <span className="text-sm text-zinc-500">
            {rich(t("Set <code>JIRA_MCP_COMMAND</code> to enable, or use paste import below."), {
              code: (s) => <code className="code">{s}</code>,
            })}
          </span>
        )}
        {syncState?.error && <FormError>{syncState.error}</FormError>}
        {syncState?.ok && <span className="text-sm text-emerald-600 dark:text-emerald-400">{syncState.message}</span>}
      </div>

      <PersistentDetails name="jira-paste" ui={ui} className="text-sm">
        <summary className="cursor-pointer text-zinc-500">{t("Paste issues JSON (no server needed)")}</summary>
        <form action={imp} className="mt-2 space-y-2">
          <textarea
            name="json"
            rows={4}
            className="input font-mono text-xs"
            placeholder='[{"key":"PROJ-80","fields":{"summary":"…","status":{"name":"In Progress","statusCategory":{"key":"indeterminate"}}}}]  — or  {"issues":[…]}'
          />
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton className="btn" pendingText={t("Importing…")}>{t("Import pasted")}</SubmitButton>
            {importState?.error && <FormError>{importState.error}</FormError>}
            {importState?.ok && <span className="text-sm text-emerald-600 dark:text-emerald-400">{importState.message}</span>}
          </div>
        </form>
      </PersistentDetails>
    </div>
  );
}
