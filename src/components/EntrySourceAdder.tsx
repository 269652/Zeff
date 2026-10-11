"use client";

import { useState, useTransition } from "react";
import { addContextSourceAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { gitlabTicket } from "@/lib/gitlab/shared";
import { useContextFormOptions } from "./ContextFormOptions";
import { SourcePicker } from "./SourcePicker";
import { useT } from "./I18nProvider";

/**
 * The entry's context search: pick a Teams message or GitLab item and it's on the entry at
 * once — its own item, on the entry's ticket (else the one a GitLab item names).
 */
export function EntrySourceAdder({ entryId, ticket, linked }: { entryId: number; ticket: string | null; linked: string[] }) {
  const t = useT();
  const { tickets } = useContextFormOptions();
  const prefixes = new Set(tickets.map((tk) => tk.ticket.split("-")[0].toUpperCase()));
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-1">
      <SourcePicker
        linked={new Set(linked)}
        onPick={(p) =>
          start(async () => setState(await addContextSourceAction(entryId, p.url, ticket ?? (p.source === "gitlab" ? gitlabTicket(p.gitlab, prefixes) : p.source === "todo" ? p.todo.ticket : null))))
        }
      />
      {pending && <p className="text-xs text-zinc-500">{t("Adding…")}</p>}
      {!pending && state?.error && <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>}
    </div>
  );
}
