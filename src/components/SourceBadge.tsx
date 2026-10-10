"use client";

import { useState, type ReactNode } from "react";
import type { Entity, Sourced } from "@/lib/entities-shared";
import { GitlabItemBadge, GitlabItemDetails } from "./GitlabItemBadge";
import { GripIcon } from "./icons";
import { KeepNoteBadge, KeepNoteDetails } from "@/plugins/keep/KeepNoteBadge";
import { FactBadge, FactDetails } from "./FactBadge";
import { MailBadge, MailDetails } from "./MailBadge";
import { JiraCommentBadge, JiraCommentDetails, JiraTicketBadge, JiraTicketDetails } from "./JiraBadges";
import { TeamsMessageBadge, TeamsMessageDetails } from "./TeamsMessageBadge";
import { TodoBadge, TodoDetails } from "./TodoBadge";
import { WorkRunBadge, WorkRunDetails } from "./WorkRunBadge";
import type { ReorderRow } from "./useReorder";

/**
 * A source's badge — a Teams message, a GitLab item, a Jira comment or ticket, a mail, or a board
 * todo; a context item's (Entity) or what a todo came from (TodoSource) alike. With `onToggle` it
 * unfolds; `resolved`: done elsewhere (its copy in Jira), shown as done.
 */
export function SourceBadge({ entity, resolved, ...rest }: { entity: Sourced; className?: string; expanded?: boolean; onToggle?: () => void; resolved?: boolean }) {
  if (entity.source === "teams") return <TeamsMessageBadge m={entity.teams} resolved={resolved} {...rest} />;
  if (entity.source === "todo") return <TodoBadge t={entity.todo} {...rest} />;
  if (entity.source === "jira-comment") return <JiraCommentBadge c={entity.comment} {...rest} />;
  if (entity.source === "jira") return <JiraTicketBadge t={entity.ticket} {...rest} />;
  if (entity.source === "mail") return <MailBadge m={entity.mail} {...rest} />;
  if (entity.source === "work") return <WorkRunBadge r={entity.run} {...rest} />;
  if (entity.source === "keep") return <KeepNoteBadge n={entity.note} {...rest} />;
  if (entity.source === "fact") return <FactBadge f={entity.fact} {...rest} />;
  return <GitlabItemBadge item={entity.gitlab} resolved={resolved} {...rest} />;
}

/** A source in full, as a card. */
export function SourceDetails({ entity }: { entity: Sourced }) {
  if (entity.source === "teams") return <TeamsMessageDetails m={entity.teams} />;
  if (entity.source === "todo") return <TodoDetails t={entity.todo} from={entity.from} />;
  if (entity.source === "jira-comment") return <JiraCommentDetails c={entity.comment} />;
  if (entity.source === "jira") return <JiraTicketDetails t={entity.ticket} />;
  if (entity.source === "mail") return <MailDetails m={entity.mail} />;
  if (entity.source === "work") return <WorkRunDetails r={entity.run} />;
  if (entity.source === "keep") return <KeepNoteDetails n={entity.note} />;
  if (entity.source === "fact") return <FactDetails f={entity.fact} />;
  return <GitlabItemDetails item={entity.gitlab} />;
}

/**
 * A source's badge that unfolds into its card below it. `before` / `after` go beside the badge
 * (a grip to drag it by, a button to remove it).
 */
export function ExpandableSource({ entity, before, after, className = "" }: { entity: Entity; before?: ReactNode; after?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center gap-1.5">
        {before}
        <SourceBadge entity={entity} expanded={open} onToggle={() => setOpen(!open)} className="min-w-0 flex-1" />
        {after}
      </div>
      {open && <SourceDetails entity={entity} />}
    </div>
  );
}

/** The handle a row is dragged by — ↑/↓ move it too, while it has focus. */
export function DragGrip(props: ReorderRow["grip"]) {
  return (
    <button
      type="button"
      {...props}
      className="shrink-0 cursor-grab rounded p-0.5 text-zinc-300 transition hover:bg-zinc-100 hover:text-zinc-600 focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-none active:cursor-grabbing dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
      title="Drag to reorder (or ↑ / ↓)"
      aria-label="Reorder: drag, or press ↑ or ↓"
    >
      <GripIcon />
    </button>
  );
}
