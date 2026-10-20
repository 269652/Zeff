/**
 * The Boards tab — your tickets gone through the Claude CLI: what happened, what's to do. The
 * parts pages, the MCP server and the run share (client-safe: no DB access here).
 */

import { ACTIONS, OFFERED_ACTIONS, actionOf, cleanActions } from "@/plugins/actions/catalog";
import type { MailView } from "@/lib/mail/shared";
import type { GitlabItemView } from "@/lib/gitlab/shared";
import type { TeamsMessageView } from "@/lib/teams/shared";
import { translator, type T } from "@/lib/i18n/shared";
import { catalogText } from "@/plugins/catalog-text";

/** Where a ticket stands, as a run reads it: what its stripe says and how urgent it sorts. */
export const ATTENTIONS = [
  "feedback",
  "active",
  "check",
  "spec",
  "blocked",
  "ready",
  "stale",
] as const;
export type Attention = (typeof ATTENTIONS)[number];

export const ATTENTION_LABELS: Record<Attention, string> = {
  feedback: "Open question",
  active: "In progress",
  check: "Testing / Review",
  spec: "Spec",
  blocked: "Waiting on others",
  ready: "Ready",
  stale: "Stalled",
};

/** The same in a language (`t`) — for what's shown. */
export const attentionLabels = (t: T): Record<Attention, string> => ({
  feedback: t("Open question"),
  active: t("In progress"),
  check: t("Testing / Review"),
  spec: t("Spec"),
  blocked: t("Waiting on others"),
  ready: t("Ready"),
  stale: t("Stalled"),
});

export const isAttention = (v: unknown): v is Attention =>
  (ATTENTIONS as readonly unknown[]).includes(v);

/** What a todo asks for. */
export const TODO_KINDS = [
  "reply",
  "comment",
  "update",
  "implement",
  "fix",
  "test",
  "review",
  "clarify",
  "document",
  "deploy",
  "merge",
  "other",
] as const;
export type TodoKind = (typeof TODO_KINDS)[number];

/** German: the prompts (the work brief, the auto-actions review) use them too — the pages show `todoKindLabels(t)`. */
export const TODO_KIND_LABELS: Record<TodoKind, string> = {
  reply: "Antworten",
  comment: "Kommentieren",
  update: "Ticket pflegen",
  implement: "Umsetzen",
  fix: "Fixen",
  test: "Testen",
  review: "Review",
  clarify: "Klären",
  document: "Doku",
  deploy: "Deployen",
  merge: "Ausliefern",
  other: "Sonstiges",
};

/** What a todo asks for, in a language (`t`) — for what's shown. */
export const todoKindLabels = (t: T): Record<TodoKind, string> => ({
  reply: t("Reply"),
  comment: t("Comment"),
  update: t("Update ticket"),
  implement: t("Implement"),
  fix: t("Fix"),
  test: t("Test"),
  review: t("Review"),
  clarify: t("Clarify"),
  document: t("Docs"),
  deploy: t("Deploy"),
  merge: t("Deliver"),
  other: t("Other"),
});

export const isTodoKind = (v: unknown): v is TodoKind =>
  (TODO_KINDS as readonly unknown[]).includes(v);

export type TodoStatus = "open" | "done" | "dismissed";

/**
 * An operation that does (part of) a todo with no AI: Zeff runs it itself — in Jira through its
 * Jira connection (a transition, an assignee, a comment), in GitLab through the automation
 * Chrome (a reply in a comment's thread, resolving it).
 */
// An empty interface on purpose: plugins add their operation types to it (declaration merging).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TodoOpMap {}
/** Every plugin's operation types (`declare module` in its actions file adds to {@link TodoOpMap}), each with its `type`. */
export type TodoOp = { [K in keyof TodoOpMap]: { type: K } & TodoOpMap[K] }[keyof TodoOpMap];
/** The delivery operations (Zeff's own, after an implementation): the actions flagged `delivery`. */
export const DELIVERY_OP_TYPES = ACTIONS.filter((a) => a.delivery).map((a) => a.type);
/** The operations an AI may propose: the offered actions of all plugins (which are installed is checked where they're offered). */
export const TODO_OP_TYPES = OFFERED_ACTIONS.map((a) => a.type);

/** An operation in a few words: "PROJ-415 → Testing", "PROJ-415 zuweisen: clorenz", "Thread note:461450 auflösen" — in English (one argument, so `ops.map(opLabel)` works; shown: opTitle). */
export function opLabel(op: TodoOp): string {
  return opTitle(op, translator("en"));
}

/** The same in `t`'s language — for what's shown. */
export function opTitle(op: TodoOp, t: T): string {
  return (actionOf(op.type).title as (o: TodoOp, t?: T) => string)(op, t);
}

/**
 * Whether running a todo's operations IS doing it — then it's ticked off with them: a reply, a
 * comment, a ticket update or a question of mine (the message is the work), and a delivery. Not
 * when they're only a side step of something else (moving the ticket while it's being
 * implemented, tested, reviewed …), nor while waiting for someone (a nudge doesn't bring the
 * answer): those stay open.
 */
export function opsSettle(t: Pick<TodoView, "kind" | "owner" | "ops" | "text">): boolean {
  // A delivery's operations are the todo itself — but a push of the branch an implementation is on isn't: the work is still to do.
  if (t.ops.length && t.ops.every((o) => actionOf(o.type).delivery || o.type === "jira-create")) return !["implement", "fix", "test"].includes(t.kind);
  // Talking in threads (replies, resolving, messages) is the work — unless the todo asks for
  // something none of them says (an approval asked for, with only threads resolved). A draft
  // opened in Outlook isn't sent yet: that's yours to tick off.
  const says = t.ops.some((o) => o.type !== "gitlab-resolve");
  if (t.ops.length && t.ops.every((o) => actionOf(o.type).comms && !actionOf(o.type).href) && (says || !asksForApproval(t.text))) return true;
  return t.owner === "me" && ["reply", "comment", "update", "clarify"].includes(t.kind);
}

/** A todo that asks someone to review or approve (a merge request) — "um Approval bitten", "erneut prüfen lassen". */
export const asksForApproval = (text: string) => /approv|freigabe|(erneut|nochmal|noch einmal)[^.]{0,40}(prüf|review)|um (ein )?review|review[^.]{0,20}bitten/i.test(text);

/** What a button running these operations says: the action ("Merge", "Comment & Assign"), else "Run" (in `t`'s language; English when none is given). */
export function opsButton(ops: TodoOp[], t: T = translator("en")): string {
  const verb = (o: TodoOp) => catalogText(t, actionOf(o.type).verb);
  // A delivery (commit → push → MR, or → merge): its final step names it.
  const last = ops[ops.length - 1];
  if (ops.length > 1 && last && ["gitlab-open-mr", "git-merge-main", "gitlab-merge"].includes(last.type) && ops.every((o) => actionOf(o.type).delivery)) return verb(last);
  const verbs = [...new Set(ops.map(verb))];
  return verbs.length === 0 ? t("Run") : verbs.length <= 2 ? verbs.join(" & ") : t("Run");
}

/**
 * An operation as a note: its heading ("MR öffnen") and the line under it — what exactly
 * (branches, ticket and status, …); for one with a text (comment, reply, message) that's `body`.
 */
export function opNote(op: TodoOp, t?: T): { heading: string; detail: string | null; body: string | null; files?: string[] } {
  return (actionOf(op.type).note as (o: TodoOp, t?: T) => ReturnType<typeof opNote>)(op, t);
}

/** Operations as an AI hands them over, cleaned: the ones that are complete, in Zeff's shapes (each action's own rules). */
export function cleanOps(raw: unknown, ticket: string): TodoOp[] {
  return cleanActions(raw, { ticket });
}

/**
 * The dictionary of operations Zeff runs by itself — what each is for, its fields, an example —
 * as the plugins offer them. The AI's answers are held to it (the JSON schema built from it),
 * prompts explain it (opsDictionary), cleanOps keeps only what fits it.
 */
export const OP_CATALOG: Record<string, { label: string; when: string; fields: Record<string, string>; example: Record<string, string> }> = Object.fromEntries(
  OFFERED_ACTIONS.map((a) => [a.type, { label: a.label, ...a.offer! }]),
);

/** The JSON schema of operations (for the AI's answers): exactly the dictionary's shapes. */
export const TODO_OPS_SCHEMA = {
  type: "array",
  description:
    "Feste Operationen, die Zeff ohne KI per Knopfdruck ausführt — wenn sich das Todo (ganz oder zum Teil) so erledigen lässt; sonst leer. Nur Typen und Felder aus dem Wörterbuch.",
  items: {
    anyOf: TODO_OP_TYPES.map((type) => ({
      type: "object",
      required: ["type", ...Object.keys(OP_CATALOG[type].fields)],
      additionalProperties: false,
      properties: {
        type: { type: "string", const: type, description: OP_CATALOG[type].label },
        ...Object.fromEntries(Object.entries(OP_CATALOG[type].fields).map(([k, d]) => [k, { type: "string", description: d }])),
      },
    })),
  },
};

/** The plugin an operation needs (Teams, GitLab, Outlook, Work …) — null: Zeff's own. */
export const opPlugin = (type: string) => actionOf(type as TodoOp["type"])?.plugin ?? null;

/** More lines for the dictionary, from what plugins offer at run time (the API methods the AI may propose: "zeff-do"). Set on the server. */
let dictionaryExtras: () => string[] = () => [];
export const setOpsDictionaryExtras = (fn: () => string[]) => {
  dictionaryExtras = fn;
};

/** The operations Zeff can do without AI, for a prompt — `available`: those whose plugin is installed. */
export function opsDictionary(available: (type: string) => boolean = () => true): string {
  const types = TODO_OP_TYPES.filter((t) => available(t));
  return [
    "Wörterbuch der Operationen, die Zeff ohne KI ausführt (Feld „ops“ eines Todos oder Follow-ups; jede Operation genau in dieser Form):",
    ...types.flatMap((t) => {
      const c = OP_CATALOG[t];
      return [
        `- ${t} — ${c.label}: ${c.when} Felder: ${Object.entries(c.fields)
          .map(([k, d]) => `${k} (${d})`)
          .join(", ")}. Beispiel: ${JSON.stringify(c.example)}`,
        ...(t === "zeff-do" ? dictionaryExtras() : []),
      ];
    }),
    "Was sich so ausdrücken lässt (Status, Zuweisung, Kommentar, neues Ticket, Antwort, Nachricht, Mail, Termin, Übergabe an einen Worker), gib IMMER als ops an — ein Todo „Ticket … anlegen“ bekommt eine jira-create mit fertigem Titel und vollständiger Beschreibung — zusätzlich zum Text. Mehrere Operationen in der Reihenfolge, in der sie laufen sollen.",
    ...(types.includes("teams-message")
      ? ["Wartest du auf eine Antwort, die seit über einem Arbeitstag aussteht (ein Flag wie „Rückfrage … offen“), bekommt das wartende Todo eine teams-message an die Person — als Nachhaken, das ich mit einem Klick sende."]
      : []),
  ].join("\n");
}

/** A todo as shown and handed to agents — referenced as T-<id>. */
export type TodoView = {
  id: number;
  ref: string;
  /** When it's due (YYYY-MM-DD), if it has a deadline. */
  due: string | null;
  /** The knowledge the Wissens-Zuordnung picked for it (null: not gone through yet). */
  knowledge: import("@/plugins/knowledge/shared").TodoKnowledge | null;
  ticket: string;
  text: string;
  kind: TodoKind;
  /** me: yours to do; other: someone else's move you're waiting for. */
  owner: "me" | "other";
  status: TodoStatus;
  source: string | null;
  /** The comments and messages it came from ("jira-comment:<id>", "teams:<key>", "gitlab:note:<id>"). */
  refs: string[];
  note: string | null;
  /** A message ready to send, or a change to make (a follow-up's). */
  draft: string | null;
  /** Where it goes (jira | teams | gitlab), and to what (a ticket key, "teams:<key>", "gitlab:note:<id>"). */
  channel: "jira" | "teams" | "gitlab" | null;
  target: string | null;
  /** The todo it follows up on, and the work run that left it. */
  parentId: number | null;
  workRunId: number | null;
  /** What doing it takes as operations Zeff runs itself (none: a person's or a worker's job). */
  ops: TodoOp[];
  /** Other ways to do it, one click each (filled in for the pages: see todoAlternatives). */
  alternatives?: TodoAlternative[];
  /** Why its operations can't run yet (a merge request not approved, merged already) — the button waits. */
  blockedBy?: string;
  /** The notes and run reports on related todos (the steps before it, ones about the same comments) — context too (filled in for the pages). */
  relatedNotes?: TodoUserNote[];
  /** The time reported on it (an agent's records, yours) — in the order it happened (filled in for the pages). */
  time?: import("@/lib/work/shared").TimeRecord[];
  /** The mails about its ticket since it came up (newest few) — context beside what it cites (filled in for the pages). */
  /** Its merge requests and the GitLab comments its operations are about, as links (filled in for the pages). */
  links?: TodoLinks;
  /** Its last run failed: why (shown on the todo, so a click that went wrong doesn't go unseen). */
  lastError?: string;
  /** The run that failed (to try again, or put the error away). */
  lastErrorRun?: number;
  /** What comes after it, planned: each path's steps (several paths: alternatives). */
  planned: TodoPath[];
  /** The alternative path it's on, if any. */
  path: string | null;
  /** An agent working on it asks you something and waits: its question. */
  needsInput: string | null;
  /** Your notes on it (context for the Ticket-Lage, workers and agents), oldest first. */
  userNotes: TodoUserNote[];
  /** When you put it to the bottom (null: never, or taken back). */
  deferredAt: string | null;
  /** When you flagged it important (null: not flagged). */
  flaggedAt: string | null;
  /** A worker or agent reports it done (null: none did). It stays open — closing it is yours. */
  /** `suggested`: the AI review only thinks it's done — a grey tick to confirm, nothing a worker did. */
  workerDone: { at: string; by: string; note: string | null; suggested?: boolean } | null;
  /** A worker made it: it's on the "Worker" tab, not in your list — workers may close such todos themselves. */
  byWorker: boolean;
  /** It comes back: its rule (a rate on the 15th of every month) — done, the next one is made. */
  recurrence: import("@/lib/calendar/recurrence").TodoRecurrence | null;
  /** Other tickets it's about too (linked: the same thing on two tickets); `ticket` is the main one. */
  alsoTickets: string[];
  /** Set: this todo was a duplicate and went into that one (it is closed; /t/<id> leads there). */
  mergedInto?: number | null;
  /** When it last absorbed a duplicate - new to you again from then. */
  mergedAt?: string | null;
  /** The mails the mail relation run related to it ("mail:<key>") — in `refs` too, as context like the rest. */
  mailRefs: string[];
  /** Its operations were proposed by the auto-actions review — why they fit. */
  autoOpsWhy?: string | null;
  /** Still at the bottom (filled in for the pages: false once it's due again — see `bubbledUp`). */
  deferred?: boolean;
  /** Put down, but back up again: why (new message, three days on, an agent asks). */
  bubbledUp?: string;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
};

/**
 * Another action on a todo, one click: what it says, what it does, its operations. `also`: done
 * on its own beside the todo's (a todo of its own, run at once) — else instead of them (the
 * todo's operations replaced, and its words: `text`).
 */
export type TodoAlternative = { label: string; title: string; ops: TodoOp[]; text?: string; also?: boolean };

/** A planned step after a todo: what, what kind, whose — and its operations. */
export type TodoStep = { text: string; kind: TodoKind; owner: "me" | "other"; ops: TodoOp[] };
/** A way on after a todo: its name (when there are several to choose from) and its steps, in order. */
/** A note on a todo: yours (context), or a run's report on it (`by`: "W-48 · GitHub Copilot", with a link to what it pushed). */
export type TodoUserNote = {
  at: string;
  text: string;
  by?: string;
  url?: string;
  urlLabel?: string;
  /** Shown on another todo: the one it's on (a step before it, one about the same comments). */
  from?: number;
  /** Your instruction to a worker (✨) — not a plain note — and the run that carries it out. */
  kind?: "instruction";
  run?: number;
  /** Synced to its ticket in Jira as this comment — and what it said then (to spot a later edit). */
  jiraCommentId?: string;
  jiraHash?: string;
  /** The note's text as it was last synced — to tell whether it has changed since. */
  jiraText?: string;
  /** The pictures (documents) of the note already uploaded to its ticket as attachments — not uploaded twice. */
  jiraFiles?: number[];
  /** Filled in when the todo is read: what would go to Jira now differs from the comment there (the note changed, or who the people it tags are). */
  jiraStale?: boolean;
};

/** Whether a note matches its comment on Jira: none (not synced / not a note to sync), synced, or changed since the last sync (also: synced before Zeff kept what was synced). */
export const noteSyncState = (n: Pick<TodoUserNote, "text" | "jiraCommentId" | "jiraText" | "by" | "kind"> & { jiraStale?: boolean }): "none" | "synced" | "changed" =>
  n.by || n.kind === "instruction" || !n.jiraCommentId ? "none" : n.jiraStale || n.jiraText !== n.text ? "changed" : "synced";

/** A todo's GitLab links: merge requests by ref, comments by key ("note:123"). */
export type TodoLinks = {
  mrs: { ref: string; url: string; title: string; state: string | null }[];
  notes: Record<string, { url: string; author: string | null; excerpt: string; state: string | null }>;
};

export type TodoPath = { path: string | null; steps: TodoStep[] };

/** A plan as the AI (or a store) hands it over, cleaned: paths with steps that have text, at most 3 paths of 6 steps. */
export function cleanPlan(raw: unknown, ticket: string): TodoPath[] {
  if (!Array.isArray(raw)) return [];
  const paths = raw.flatMap((p): TodoPath[] => {
    const o = (p ?? {}) as Record<string, unknown>;
    const steps = (Array.isArray(o.steps) ? o.steps : []).flatMap((x): TodoStep[] => {
      const s = (x ?? {}) as Record<string, unknown>;
      const text = typeof s.text === "string" ? s.text.trim().slice(0, 500) : "";
      if (!text) return [];
      return [{ text, kind: isTodoKind(s.kind) ? s.kind : "other", owner: s.owner === "other" ? "other" : "me", ops: cleanOps(s.ops, ticket) }];
    });
    const name = typeof o.path === "string" && o.path.trim() ? o.path.trim().slice(0, 60) : null;
    return steps.length ? [{ path: name, steps: steps.slice(0, 6) }] : [];
  });
  // One path needs no name; several do (they're told apart by it).
  return paths.length === 1 ? [{ ...paths[0], path: null }] : paths.slice(0, 3).map((p, i) => ({ ...p, path: p.path ?? `Path ${i + 1}` }));
}

/** A plan in a line: "Review → Merge → Deploy" — per path when there are several ("Merge Request: …  |  Direkt: …"). */
export const planLine = (plan: TodoPath[]) =>
  plan.map((p) => `${p.path ? `${p.path}: ` : ""}${p.steps.map((s) => s.text).join(" → ")}`).join("  |  ");

/** The default instructions an agent gets for a todo (Work → Settings changes them). */
export const AGENT_INSTRUCTION_DEFAULTS = { code: "Implement $todo.id", other: "Do $todo.id" };

/**
 * What to tell an agent (Copilot, Claude Code) to do a todo — the template for code todos
 * (implement, fix, test) or the other one, with $todo.id ("T-35"), $todo.ticket and $todo.text filled in.
 */
export const agentInstruction = (t: Pick<TodoView, "id" | "kind" | "ticket" | "text">, templates: { code: string; other: string } = AGENT_INSTRUCTION_DEFAULTS) =>
  (["implement", "fix", "test"].includes(t.kind) ? templates.code : templates.other)
    .replace(/\$todo\.id\b/g, () => todoRef(t.id))
    .replace(/\$todo\.ticket\b/g, () => t.ticket)
    .replace(/\$todo\.text\b/g, () => t.text);

/** A todo's reference: "T-12". */
export const todoRef = (id: number) => `T-${id}`;

/** A reference back to the todo's id ("T-12", "t12", "12"), else null. */
export function parseTodoRef(raw: string | number): number | null {
  const m = /^\s*t?-?\s*(\d+)\s*$/i.exec(String(raw));
  return m ? Number(m[1]) : null;
}

/** A ticket as a run read it from Jira (shown beside what the run made of it). */
export type BoardTicket = {
  key: string;
  /** Followed besides the boards' filter (handed on, but you're still on it), and why. */
  followed?: string;
  summary: string;
  url: string | null;
  status: string;
  /** todo | inprogress | done | unknown */
  statusCategory: string;
  issueType: string | null;
  priority: string | null;
  assignee: string | null;
  parent: string | null;
  updatedAt: string | null;
  comments: number;
  /** The comments the run read (newest last) — to mark done, and the todos' sources. */
  recent?: { id: string; author: string; at: string; text: string }[];
  /** Everyone on it as "Name (username)" — whom an action can address, assign it to. */
  people?: string[];
  /** Its possible transitions ("Name (→ Status)"), as Jira listed them for the run. */
  transitions?: string[];
  /** Gone through Claude — or only listed: done but never resolved, or untouched for months. */
  analyzed: boolean;
  /** On the last run's list, not on this one's (its state now). */
  left?: boolean;
};

/** A Jira comment a todo came from, as the run read it. */
export type JiraCommentView = {
  id: string;
  ticket: string;
  /** Empty when the run that's shown didn't read it (an older comment): only its link is known. */
  author: string;
  at: string;
  text: string;
  url: string | null;
  resolved: boolean;
  /** Zeff wrote it: the todo whose action posted it (and what that todo said). */
  postedBy?: { todoId: number; text: string };
};

/** A Teams message (or GitLab item) Zeff posted to Jira as a comment ("Sync to Jira" of its context item). */
export type SyncedComment = {
  commentId: string;
  ticket: string | null;
  url: string | null;
  resolved: boolean;
};

/**
 * What a todo's ref points at: a Jira comment, a Teams message, a GitLab comment — a message
 * Zeff synced to Jira with its comment (the copy stands for the original).
 */
export type TodoSource =
  /** `thread`: its ticket's conversation (the comments kept, oldest first, itself among them) — shown together. */
  | {
      source: "jira-comment";
      comment: JiraCommentView;
      thread?: JiraCommentView[];
    }
  /** `thread`: its chat's conversation around it (or its channel thread), oldest first, itself among it — shown together. */
  | { source: "teams"; teams: TeamsMessageView; synced?: SyncedComment; thread?: TeamsMessageView[] }
  /** A mail from your inbox that it follows from (as Outlook's list shows it). */
  | { source: "mail"; mail: MailView; synced?: SyncedComment }
  /** `thread`: its merge request's conversation (the comments people wrote, oldest first, itself among them) — shown together. */
  | {
      source: "gitlab";
      gitlab: GitlabItemView;
      synced?: SyncedComment;
      thread?: GitlabItemView[];
    }
  /** A note (Google Keep's or one of your Keep boards') it follows from or is about. */
  | { source: "keep"; note: import("@/plugins/keep/shared").KeepNoteBrief }
  /** A fact of yours it needs ("Nadines Geburtstag: 16.10.") — found in your messages. */
  | { source: "fact"; fact: import("@/lib/facts-shared").FactView }
  /** A document of the store attached to it (by hand) — its abstract is its context. */
  | { source: "document"; doc: import("@/plugins/documents/shared").DocView }
  /** An appointment of its calendar series (a recurring todo's) — shown in its context. */
  | { source: "calendar"; event: import("@/lib/calendar/brief").CalendarBrief };

/** A source's identity: its message, whichever ref named it. */
export const sourceKey = (s: TodoSource) =>
  s.source === "jira-comment"
    ? `jira-comment:${s.comment.id}`
    : s.source === "teams"
      ? `teams:${s.teams.key}`
      : s.source === "mail"
        ? `mail:${s.mail.key}`
        : s.source === "keep"
          ? s.note.ref
          : s.source === "fact"
            ? s.fact.ref
            : s.source === "document"
              ? s.doc.ref
              : s.source === "calendar"
                ? s.event.ref
                : `gitlab:${s.gitlab.key}`;

/**
 * A todo's sources from its refs, each once (a message and its synced copy are one); a GitLab
 * or Jira comment comes with its whole conversation (its MR's, its ticket's), oldest first.
 */
export const sourcesOf = (
  refs: string[],
  sources: Record<string, TodoSource>,
): TodoSource[] => [
  ...new Map(
    refs.flatMap((r) => {
      const s = sources[r];
      if (!s) return [];
      const all: TodoSource[] =
        // Teams messages: just those the run picked (by content) — no chat around them by time.
        s.source === "gitlab" && s.thread?.length
          ? s.thread.map((g) =>
              g.key === s.gitlab.key
                ? s
                : { source: "gitlab" as const, gitlab: g },
            )
          : [s];
      return all.map((x) => [sourceKey(x), x] as const);
    }),
  ).values(),
];

/** A Jira comment's address: its ticket's, focused on it. */
export const jiraCommentUrl = (ticketUrl: string, id: string) =>
  `${ticketUrl}?focusedCommentId=${encodeURIComponent(id)}&page=com.atlassian.jira.plugin.system.issuetabpanels%3Acomment-tabpanel#comment-${encodeURIComponent(id)}`;

/**
 * A change to a ticket the run suggests, to make with a click (Zeff's Jira connection):
 * a transition ("→ Testing"), an assignee, a comment.
 */
export type TicketAction = {
  type: "transition" | "assign" | "comment";
  label: string;
  to?: string;
  assignee?: string;
  comment?: string;
  why: string;
};
export const TICKET_ACTION_TYPES = ["transition", "assign", "comment"] as const;

/** A question someone might ask about a ticket, and its answer — `search`: what to look up in the knowledge base when the context doesn't answer it; `sources`: the pages the answer comes from. */
export type TicketQuestion = { q: string; a?: string; search?: string; sources?: string[] };

/** What Claude answers for a run (see BOARD_RESULT_SCHEMA). */
export type BoardResult = {
  lede: string;
  tickets: {
    key: string;
    attention: Attention;
    lead: string;
    summary: string;
    happened: { when: string; who?: string; what: string }[];
    todos: {
      id?: number;
      text: string;
      kind: TodoKind;
      owner: "me" | "other";
      source?: string;
      refs?: string[];
      /** A deadline (YYYY-MM-DD). */
      due?: string;
      ops?: unknown[];
      /** What comes after it, planned (paths of steps). */
      then?: unknown[];
    }[];
    /** done: it was done (its planned steps come next); else it's superseded (dropped). */
    resolved: { id: number; why: string; done?: boolean }[];
    flags: string[];
    /** Changes to the ticket to make now (older runs: none). */
    actions?: TicketAction[];
    /** What the messages say about the code change (kind "change") or how branches are named (kind "rule") — kept as knowledge for naming branches (older runs: none). */
    branchKnowledge?: { kind: "change" | "rule"; text: string; ref?: string }[];
    /** Possible questions about the ticket, answered from the context — or, with `search`, from the knowledge base afterwards (older runs: none). */
    questions?: TicketQuestion[];
  }[];
  left: { key: string; note: string }[];
};

/** The shape Claude's answer must have (the CLI's --json-schema). */
export const BOARD_RESULT_SCHEMA = {
  type: "object",
  required: ["lede", "tickets", "left"],
  properties: {
    lede: {
      type: "string",
      description:
        "3–6 Sätze: die Lage insgesamt — was sich seit dem letzten Lauf getan hat, was jetzt am dringendsten ist.",
    },
    tickets: {
      type: "array",
      description:
        "Jedes analysierte Ticket genau einmal, das dringendste zuerst.",
      items: {
        type: "object",
        required: [
          "key",
          "attention",
          "lead",
          "summary",
          "happened",
          "todos",
          "resolved",
          "flags",
          "actions",
          "questions",
        ],
        properties: {
          key: { type: "string" },
          attention: { type: "string", enum: [...ATTENTIONS] },
          lead: {
            type: "string",
            description: "Ein Satz: der Kern der Lage (wird fett gezeigt).",
          },
          summary: {
            type: "string",
            description:
              "Ein Absatz: Stand, was zuletzt passiert ist, was als Nächstes ansteht — mit Daten und Namen.",
          },
          happened: {
            type: "array",
            description:
              "Die wichtigsten Ereignisse, neueste zuerst, höchstens 6.",
            items: {
              type: "object",
              required: ["when", "what"],
              properties: {
                when: { type: "string", description: "YYYY-MM-DD" },
                who: { type: "string" },
                what: { type: "string" },
              },
            },
          },
          todos: {
            type: "array",
            description:
              "Alle jetzt gültigen konkreten Todos zu diesem Ticket.",
            items: {
              type: "object",
              required: ["text", "kind", "owner", "refs"],
              properties: {
                id: {
                  type: "integer",
                  description:
                    "Nummer eines bestehenden offenen Todos, wenn es dasselbe ist.",
                },
                text: {
                  type: "string",
                  description: "Ein Satz, Verb zuerst, prüfbar.",
                },
                kind: { type: "string", enum: [...TODO_KINDS] },
                owner: { type: "string", enum: ["me", "other"] },
                source: {
                  type: "string",
                  description:
                    "Worauf es sich stützt, kurz: z. B. „Kommentar Julia Freidank 24.09.“",
                },
                due: {
                  type: "string",
                  description: "Die Frist als Datum JJJJ-MM-TT, wenn eine genannt ist (Kommentar, Mail, Nachricht, Ticket) — sonst weglassen.",
                },
                ops: TODO_OPS_SCHEMA,
                then: {
                  type: "array",
                  description:
                    "Was nach diesem Todo kommt, geplant: Wege mit Schritten in Reihenfolge (z. B. nach dem Umsetzen: Code Review → Deploy auf Test → Testen). Gibt es echte Alternativen (Merge Request mit Review oder direkt auf main mergen), je Weg einer mit Namen; sonst genau einer ohne Namen. Jeder Schritt wird erst zum Todo, wenn der davor erledigt ist. Leer, wenn danach nichts Absehbares kommt.",
                  items: {
                    type: "object",
                    required: ["path", "steps"],
                    properties: {
                      path: { type: "string", description: "Name des Wegs bei Alternativen, z. B. „Merge Request“ oder „Direkt auf main“ — sonst leer." },
                      steps: {
                        type: "array",
                        items: {
                          type: "object",
                          required: ["text", "kind", "owner"],
                          properties: {
                            text: { type: "string", description: "Ein Satz, Verb zuerst, prüfbar." },
                            kind: { type: "string", enum: [...TODO_KINDS] },
                            owner: { type: "string", enum: ["me", "other"] },
                            ops: TODO_OPS_SCHEMA,
                          },
                        },
                      },
                    },
                  },
                },
                refs: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Die Kennungen der Kommentare und Teams-Nachrichten, aus denen es folgt — ohne Klammern, z. B. „jira-comment:12345“, „gitlab:note:678“, „teams:19:…|1791…“.",
                },
              },
            },
          },
          resolved: {
            type: "array",
            description:
              "Bestehende offene Todos, die laut den Daten erledigt oder überholt sind.",
            items: {
              type: "object",
              required: ["id", "why", "done"],
              properties: {
                id: { type: "integer" },
                why: { type: "string" },
                done: { type: "boolean", description: "true: es ist laut Daten erledigt (dann kommen seine geplanten Schritte); false: es ist überholt, doppelt oder gilt nicht mehr (dann fällt es weg, ohne Folgeschritte)." },
              },
            },
          },
          flags: {
            type: "array",
            items: { type: "string" },
            description:
              "Kurze Warnhinweise, z. B. „Rückfrage seit 24.09. offen“.",
          },
          branchKnowledge: {
            type: "array",
            description:
              "Nur wenn eine Nachricht, ein Kommentar oder das Ticket ausdrücklich sagt, WAS im Code geändert werden soll (kind change: der eigentliche Change in 2–6 Wörtern, z. B. „Footer-Link einrücken“) oder WIE Branches benannt werden sollen (kind rule: die Regel in einem Satz, z. B. „Der Branch-Name beschreibt den Code Change, nicht den Ticket-Titel“) — mit ref der Nachricht (z. B. teams:…). Kein Smalltalk, nicht der Ticket-Titel allein. Höchstens 4, sonst leer.",
            items: {
              type: "object",
              required: ["kind", "text"],
              properties: { kind: { type: "string", enum: ["change", "rule"] }, text: { type: "string" }, ref: { type: "string" } },
            },
          },
          questions: {
            type: "array",
            description:
              "Mögliche Fragen, die jemand zu diesem Ticket stellen würde und die die Lage nicht schon klärt — vor allem zu JEDEM der flags und zu jeder Aussage in lead/summary, die etwas andeutet, ohne es zu sagen (z. B. flag „Rückfrage seit 07.10. offen“ → „Was für eine Rückfrage?“; „Kritik an 4 MRs“ → „Was für Kritik?“) — höchstens 5, sonst leer.",
            items: {
              type: "object",
              required: ["q"],
              properties: {
                q: { type: "string", description: "Die Frage, kurz." },
                a: { type: "string", description: "Die Antwort — nur, wenn die Daten (Kommentare, Mails, Chats, Git, Notizen) sie hergeben, mit Namen und Daten; sonst weglassen. Nichts raten." },
                search: { type: "string", description: "Wenn die Antwort irgendwo in Zeffs Daten stehen dürfte (Wissensbasis/Dokumentation, Mails, Teams, GitLab, Jira-Kommentare, Notizen) und der Prompt sie nicht hergibt: 2–5 Suchwörter dafür. Zeff sucht überall nach und beantwortet die Frage damit. Sonst weglassen." },
              },
            },
          },
          actions: {
            type: "array",
            description:
              "Änderungen am Ticket, die jetzt anstehen und sich mit einem Klick erledigen lassen — nur wenn die Daten sie klar nahelegen (z. B. nach erledigter Umsetzung auf Testing setzen und dem Tester zuweisen). Höchstens 3; sonst leer.",
            items: {
              type: "object",
              required: ["type", "label", "why"],
              properties: {
                type: { type: "string", enum: [...TICKET_ACTION_TYPES] },
                label: {
                  type: "string",
                  description:
                    "Kurz wie ein Knopf: „→ Testing“, „Zuweisen: Christopher Lorenz“, „Kommentar: Stand melden“.",
                },
                to: {
                  type: "string",
                  description:
                    "transition: der Name eines der möglichen Übergänge des Tickets, genau so geschrieben.",
                },
                assignee: {
                  type: "string",
                  description:
                    "assign: der Benutzername (in Klammern hinter dem Namen bei den Beteiligten).",
                },
                comment: {
                  type: "string",
                  description:
                    "comment: der fertige Kommentar in Jira-Wiki-Markup.",
                },
                why: { type: "string", description: "Ein Satz, warum jetzt." },
              },
            },
          },
        },
      },
    },
    left: {
      type: "array",
      description:
        "Tickets, die seit dem letzten Lauf nicht mehr auf der Liste sind: was aus ihnen wurde.",
      items: {
        type: "object",
        required: ["key", "note"],
        properties: { key: { type: "string" }, note: { type: "string" } },
      },
    },
  },
} as const;

/** A run as the page shows it. */
export type BoardRunView = {
  id: number;
  status: "running" | "ok" | "error";
  jql: string;
  model: string | null;
  tickets: BoardTicket[];
  result: BoardResult | null;
  error: string | null;
  costUsd: number | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
};

/** A due day (YYYY-MM-DD) — or null for anything else. */
export const dueDay = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) && !Number.isNaN(Date.parse(v.trim())) ? v.trim() : null);

/**
 * A note you synced to Jira comes back as a Jira comment among the todo's sources: the two are one entry. Each note
 * with its Jira comment (when that has been synced back yet), and the sources without those comments.
 */
export function mergeJiraNotes(sources: TodoSource[], notes: TodoUserNote[]): { sources: TodoSource[]; notes: { n: TodoUserNote; jira?: TodoSource }[] } {
  const comment = (s: TodoSource) => (s.source === "jira-comment" ? String(s.comment.id) : null);
  const byId = new Map(sources.flatMap((s) => (comment(s) ? [[comment(s)!, s] as const] : [])));
  const merged = new Set<string>();
  const out = notes.map((n) => {
    const jira = n.jiraCommentId ? byId.get(String(n.jiraCommentId)) : undefined;
    if (jira) merged.add(String(n.jiraCommentId));
    return { n, ...(jira ? { jira } : {}) };
  });
  return { sources: sources.filter((s) => !merged.has(comment(s) ?? "")), notes: out };
}
