"use client";

import { FormError } from "@/components/FormError";
import { useActionState } from "react";
import { pasteEventsAction } from "@/plugins/outlook/calendar-actions";
import type { ActionState } from "@/app/action-helpers";
import { useT } from "@/components/I18nProvider";
import { SubmitButton } from "./SubmitButton";

export function PasteEventsForm() {
  const t = useT();
  const [state, action] = useActionState<ActionState, FormData>(pasteEventsAction, null);
  return (
    <form action={action} className="space-y-2">
      <textarea
        name="json"
        aria-label={t("Pasted meetings (JSON)")}
        rows={4}
        className="input font-mono text-xs"
        placeholder={t('Paste the JSON from the "copy" bookmarklet here, e.g. {"events":[…]}')}
      />
      <div className="flex items-center gap-3">
        <SubmitButton className="btn" pendingText={t("Loading…")}>{t("Load pasted meetings")}</SubmitButton>
        {state?.error && <FormError>{state.error}</FormError>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>
    </form>
  );
}
