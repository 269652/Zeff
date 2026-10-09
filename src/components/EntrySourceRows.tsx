"use client";

import { useState, useTransition } from "react";
import { reorderEntryContextsAction } from "@/app/actions";
import type { ContextItem } from "@/lib/contexts-shared";
import { itemSource } from "@/lib/contexts-shared";
import { entityWhoWhen, type EntityMap } from "@/lib/entities-shared";
import type { TicketCard } from "@/lib/jira/ticket-card-shared";
import { ContextCard, SourceList } from "./ContextCard";
import { latestPerKind, ShowMoreToggle } from "./ShowMore";
import { useReorder } from "./useReorder";

/**
 * An entry's Teams messages and GitLab items as rows, in its order — dragged by their grips into
 * another (shown at once, kept for the entry: its hover card and Jira syncs go by it too).
 */
export function EntrySourceRows({
  entryId,
  items,
  tickets,
  entities,
}: {
  entryId: number;
  items: ContextItem[];
  tickets: Record<string, TicketCard>;
  entities: EntityMap;
}) {
  const ids = items.map((c) => c.id);
  // The order shown: the server's, until dragged — and the server's again once that changes.
  const [order, setOrder] = useState(ids);
  const [from, setFrom] = useState(ids.join());
  if (from !== ids.join()) {
    setFrom(ids.join());
    setOrder(ids);
  }
  const [, start] = useTransition();
  const { rowFor } = useReorder(order, (next) => {
    setOrder(next);
    start(async () => {
      await reorderEntryContextsAction(entryId, next);
    });
  });
  const [all, setAll] = useState(false);
  const byId = new Map(items.map((c) => [c.id, c]));
  // Of each kind (Teams, Jira comments, GitLab comments, MRs) the latest three — the rest behind "Show more". Todos always.
  const { shown, hidden } = latestPerKind(
    order.flatMap((id) => byId.get(id) ?? []),
    (c) => {
      const link = itemSource(c, entities);
      const e = link ? entities[link.url] : undefined;
      if (!e || e.source === "todo") return null;
      return { kind: e.source === "gitlab" ? `gitlab-${e.gitlab.kind}` : e.source, at: entityWhoWhen(e).at ?? "" };
    },
    all,
  );
  return (
    <>
      <SourceList>
        {shown.map((c) => (
          <ContextCard key={c.id} item={c} entryId={entryId} tickets={tickets} entities={entities} reorder={shown.length > 1 ? rowFor(c.id) : undefined} />
        ))}
      </SourceList>
      <ShowMoreToggle hidden={hidden} open={all} onToggle={() => setAll(!all)} />
    </>
  );
}
