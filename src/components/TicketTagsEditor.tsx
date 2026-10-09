"use client";

import { useState, useTransition } from "react";
import { setTicketTagsAction } from "@/app/actions";
import { TagsField } from "./TagsField";

/** A ticket's default tags on the Jira tab — added to every entry booked on it; saved as you edit. */
export function TicketTagsEditor({ ticketKey, tags, allTags }: { ticketKey: string; tags: string[]; allTags: string[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`min-w-40 ${pending ? "opacity-60" : ""}`} title="Added to every entry booked on this ticket">
      <TagsField
        name=""
        compact
        allTags={allTags}
        defaultValue={tags}
        placeholder="+ tag"
        onChange={(next) =>
          startTransition(async () => {
            const r = await setTicketTagsAction(ticketKey, next);
            setError(r?.ok ? null : (r?.error ?? "Could not save the tags."));
          })
        }
      />
      {error && <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}
