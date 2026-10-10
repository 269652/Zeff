/**
 * The Boards tab — your tickets gone through the Claude CLI: what happened, what's to do. The
 * parts pages, the MCP server and the run share (client-safe: no DB access here).
 */

import { OFFERED_ACTIONS, actionOf, cleanActions } from "@/plugins/actions/catalog";
import type { MailView } from "@/lib/mail/shared";
import type { GitlabItemView } from "@/lib/gitlab/shared";
import type { TeamsMessageView } from "@/lib/teams/shared";

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
  feedback: "Rückfrage offen",
  active: "In Arbeit",
  check: "Testing / Review",
  spec: "Spezifikation",
  blocked: "Wartet auf andere",
  ready: "Bereit",
  stale: "Liegt",
};

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

export const isTodoKind = (v: unknown): v is TodoKind =>
  (TODO_KINDS as readonly unknown[]).includes(v);

export type TodoStatus = "open" | "done" | "dismissed";

/**
 * An operation that does (part of) a todo with no AI: Zeff runs it itself — in Jira through its
 * Jira connection (a transition, an assignee, a comment), in GitLab through the automation
 * Chrome (a reply in a comment's thread, resolving it).
 */
export type TodoOp =
  | { type: "jira-transition"; ticket: string; to: string }
  | { type: "jira-assign"; ticket: string; assignee: string }
  | { type: "jira-comment"; ticket: string; body: string }
  /** A new ticket (in the project of `ticket`, linked to it): its title, type and description (Markdown — Jira's markup when it's created). */
  | { type: "jira-create"; ticket: string; summary: string; issueType: string; body: string }
  | { type: "gitlab-reply"; note: string; body: string }
  | { type: "gitlab-resolve"; note: string }
  /** A 1:1 Teams message to a colleague (by display name) — sent through the Teams tab of the automation Chrome. */
  | { type: "teams-message"; to: string; body: string }
  /** A mail draft opened in Outlook Web (you send it) — addresses separated by ";". */
  | { type: "mail-compose"; to: string; subject: string; body: string }
  /** An appointment opened in Outlook Web (you send it): local start "YYYY-MM-DDTHH:MM", its minutes, addresses. */
  | { type: "calendar-event"; subject: string; start: string; minutes: number; attendees: string; body: string }
  /** The todo handed to a worker (Work tab) with this instruction. */
  | { type: "work-instruct"; instruction: string }
  // Delivery (Zeff makes these after an implementation; not in the AI's dictionary):
  | {
      type: "git-push";
      repo: string;
      branch: string;
      remote: string;
      target: string;
      title?: string;
      description?: string;
    }
  | {
      type: "gitlab-open-mr";
      repo: string;
      project: string;
      source: string;
      target: string;
      title: string;
      description: string;
    }
  | { type: "gitlab-merge"; project: string; iid: number; source: string }
  | { type: "git-merge-main"; repo: string; branch: string; target: string }
  /** Uncommitted changes (these files) committed on a feature branch (made from where the checkout is, when it's another). */
  | { type: "git-commit-branch"; repo: string; branch: string; files: string[]; message: string; target: string };
/** The delivery operations (Zeff's own, after an implementation). */
export const DELIVERY_OP_TYPES = [
  "git-push",
  "gitlab-open-mr",
  "gitlab-merge",
  "git-merge-main",
  "git-commit-branch",
] as const;
/** The operations an AI may propose: the offered actions of all plugins (which are installed is checked where they're offered). */
export const TODO_OP_TYPES = OFFERED_ACTIONS.map((a) => a.type);

/** An operation in a few words: "PROJ-415 → Testing", "PROJ-415 zuweisen: clorenz", "Thread note:461450 auflösen". */
export function opLabel(op: TodoOp): string {
  return (actionOf(op.type).title as (o: TodoOp) => string)(op);
}

/**
 * Whether running a todo's operations IS doing it — then it's ticked off with them: a reply, a
 * comment, a ticket update or a question of mine (the message is the work), and a delivery. Not
 * when they're only a side step of something else (moving the ticket while it's being
 * implemented, tested, reviewed …), nor while waiting for someone (a nudge doesn't bring the
 * answer): those stay open.
 */
export function opsSettle(t: Pick<TodoView, "kind" | "owner" | "ops" | "text">): boolean {
  if (t.ops.length && t.ops.every((o) => actionOf(o.type).delivery || o.type === "jira-create")) return true;
  // Talking in threads (replies, resolving, messages) is the work — unless the todo asks for
  // something none of them says (an approval asked for, with only threads resolved). A draft
  // opened in Outlook isn't sent yet: that's yours to tick off.
  const says = t.ops.some((o) => o.type !== "gitlab-resolve");
  if (t.ops.length && t.ops.every((o) => actionOf(o.type).comms && !actionOf(o.type).href) && (says || !asksForApproval(t.text))) return true;
  return t.owner === "me" && ["reply", "comment", "update", "clarify"].includes(t.kind);
}

/** A todo that asks someone to review or approve (a merge request) — "um Approval bitten", "erneut prüfen lassen". */
export const asksForApproval = (text: string) => /approv|freigabe|(erneut|nochmal|noch einmal)[^.]{0,40}(prüf|review)|um (ein )?review|review[^.]{0,20}bitten/i.test(text);

/** What a button running these operations says: the action ("Merge", "Comment & Assign"), else "Run". */
export function opsButton(ops: TodoOp[]): string {
  const verb = (o: TodoOp) => actionOf(o.type).verb;
  // A delivery (commit → push → MR, or → merge): its final step names it.
  const last = ops[ops.length - 1];
  if (ops.length > 1 && last && ["gitlab-open-mr", "git-merge-main", "gitlab-merge"].includes(last.type) && ops.every((o) => actionOf(o.type).delivery)) return verb(last);
  const verbs = [...new Set(ops.map(verb))];
  return verbs.length === 0 ? "Run" : verbs.length <= 2 ? verbs.join(" & ") : "Run";
}

/**
 * An operation as a note: its heading ("MR öffnen") and the line under it — what exactly
 * (branches, ticket and status, …); for one with a text (comment, reply, message) that's `body`.
 */
export function opNote(op: TodoOp): { heading: string; detail: string | null; body: string | null; files?: string[] } {
  return (actionOf(op.type).note as (o: TodoOp) => ReturnType<typeof opNote>)(op);
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

/** The operations Zeff can do without AI, for a prompt — `available`: those whose plugin is installed. */
export function opsDictionary(available: (type: string) => boolean = () => true): string {
  const types = TODO_OP_TYPES.filter((t) => available(t));
  return [
    "Wörterbuch der Operationen, die Zeff ohne KI ausführt (Feld „ops“ eines Todos oder Follow-ups; jede Operation genau in dieser Form):",
    ...types.map((t) => {
      const c = OP_CATALOG[t];
      return `- ${t} — ${c.label}: ${c.when} Felder: ${Object.entries(c.fields)
        .map(([k, d]) => `${k} (${d})`)
        .join(", ")}. Beispiel: ${JSON.stringify(c.example)}`;
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
  /** Other tickets it's about too (linked: the same thing on two tickets); `ticket` is the main one. */
  alsoTickets: string[];
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
};

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
  return paths.length === 1 ? [{ ...paths[0], path: null }] : paths.slice(0, 3).map((p, i) => ({ ...p, path: p.path ?? `Weg ${i + 1}` }));
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
    };

/** A source's identity: its message, whichever ref named it. */
export const sourceKey = (s: TodoSource) =>
  s.source === "jira-comment"
    ? `jira-comment:${s.comment.id}`
    : s.source === "teams"
      ? `teams:${s.teams.key}`
      : s.source === "mail"
        ? `mail:${s.mail.key}`
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
