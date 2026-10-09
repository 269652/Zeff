/**
 * The Boards tab — your tickets gone through the Claude CLI: what happened, what's to do. The
 * parts pages, the MCP server and the run share (client-safe: no DB access here).
 */

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
export const TODO_OP_TYPES = [
  "jira-transition",
  "jira-assign",
  "jira-comment",
  "jira-create",
  "gitlab-reply",
  "gitlab-resolve",
  "teams-message",
] as const;

/** An operation in a few words: "PROJ-415 → Testing", "PROJ-415 zuweisen: cressl", "Thread note:461450 auflösen". */
export function opLabel(op: TodoOp): string {
  switch (op.type) {
    case "jira-transition":
      return `${op.ticket} → ${op.to}`;
    case "jira-assign":
      return `${op.ticket} zuweisen: ${op.assignee}`;
    case "jira-comment":
      return `Kommentar auf ${op.ticket}`;
    case "jira-create":
      return `Ticket anlegen: ${op.summary}`;
    case "gitlab-reply":
      return `Antwort in GitLab (${op.note})`;
    case "gitlab-resolve":
      return `GitLab-Thread auflösen (${op.note})`;
    case "teams-message":
      return `Teams-Nachricht an ${op.to}`;
    case "git-push":
      return `${op.branch} pushen als ${op.remote}`;
    case "gitlab-open-mr":
      return `MR öffnen: ${op.source} → ${op.target}`;
    case "gitlab-merge":
      return `!${op.iid} mergen`;
    case "git-merge-main":
      return `${op.branch} in ${op.target} mergen und pushen`;
    case "git-commit-branch":
      return `${op.files.length} Datei${op.files.length === 1 ? "" : "en"} auf ${op.branch} committen`;
  }
}

/**
 * Whether running a todo's operations IS doing it — then it's ticked off with them: a reply, a
 * comment, a ticket update or a question of mine (the message is the work), and a delivery. Not
 * when they're only a side step of something else (moving the ticket while it's being
 * implemented, tested, reviewed …), nor while waiting for someone (a nudge doesn't bring the
 * answer): those stay open.
 */
export function opsSettle(t: Pick<TodoView, "kind" | "owner" | "ops" | "text">): boolean {
  if (t.ops.length && t.ops.every((o) => (DELIVERY_OP_TYPES as readonly string[]).includes(o.type) || o.type === "jira-create")) return true;
  // Talking in threads (replies, resolving, messages) is the work — unless the todo asks for
  // something none of them says (an approval asked for, with only threads resolved).
  const COMMS = ["gitlab-reply", "gitlab-resolve", "teams-message", "jira-comment"];
  const says = t.ops.some((o) => o.type !== "gitlab-resolve");
  if (t.ops.length && t.ops.every((o) => COMMS.includes(o.type)) && (says || !asksForApproval(t.text))) return true;
  return t.owner === "me" && ["reply", "comment", "update", "clarify"].includes(t.kind);
}

/** A todo that asks someone to review or approve (a merge request) — "um Approval bitten", "erneut prüfen lassen". */
export const asksForApproval = (text: string) => /approv|freigabe|(erneut|nochmal|noch einmal)[^.]{0,40}(prüf|review)|um (ein )?review|review[^.]{0,20}bitten/i.test(text);

/** What a button running these operations says: the action ("Merge", "Comment & Assign"), else "Run". */
export function opsButton(ops: TodoOp[]): string {
  const VERB: Record<TodoOp["type"], string> = {
    "jira-transition": "Move",
    "jira-assign": "Assign",
    "jira-comment": "Comment",
    "jira-create": "Create",
    "gitlab-reply": "Reply",
    "gitlab-resolve": "Resolve",
    "teams-message": "Send",
    "git-push": "Push",
    "gitlab-open-mr": "Open MR",
    "gitlab-merge": "Merge",
    "git-merge-main": "Merge",
    "git-commit-branch": "Commit",
  };
  // A delivery (commit → push → MR, or → merge): its final step names it.
  const last = ops[ops.length - 1];
  if (ops.length > 1 && last && ["gitlab-open-mr", "git-merge-main", "gitlab-merge"].includes(last.type) && ops.every((o) => (DELIVERY_OP_TYPES as readonly string[]).includes(o.type))) return VERB[last.type];
  const verbs = [...new Set(ops.map((o) => VERB[o.type]))];
  return verbs.length === 0 ? "Run" : verbs.length <= 2 ? verbs.join(" & ") : "Run";
}

/**
 * An operation as a note: its heading ("MR öffnen") and the line under it — what exactly
 * (branches, ticket and status, …); for one with a text (comment, reply, message) that's `body`.
 */
export function opNote(op: TodoOp): { heading: string; detail: string | null; body: string | null; files?: string[] } {
  switch (op.type) {
    case "jira-transition":
      return { heading: "Jira-Status ändern", detail: `${op.ticket} → ${op.to}`, body: null };
    case "jira-assign":
      return { heading: "Jira-Ticket zuweisen", detail: `${op.ticket} → ${op.assignee}`, body: null };
    case "jira-comment":
      return { heading: `Kommentar auf ${op.ticket}`, detail: null, body: op.body };
    case "jira-create":
      return { heading: `Jira-Ticket anlegen (${op.ticket.split("-")[0]}, ${op.issueType})`, detail: `„${op.summary}“ — verknüpft mit ${op.ticket}`, body: op.body };
    case "gitlab-reply":
      return { heading: `Antwort in GitLab (${op.note})`, detail: null, body: op.body };
    case "gitlab-resolve":
      return { heading: "GitLab-Thread auflösen", detail: op.note, body: null };
    case "teams-message":
      return { heading: `Teams-Nachricht an ${op.to}`, detail: null, body: op.body };
    case "git-push":
      return { heading: "Branch pushen", detail: `${op.branch} → origin/${op.remote}`, body: null };
    case "gitlab-open-mr":
      return { heading: "MR öffnen", detail: `${op.source} → ${op.target}${op.title ? ` · „${op.title}“` : ""}`, body: null };
    case "gitlab-merge":
      return { heading: `!${op.iid} mergen`, detail: `${op.source} — sobald der MR approved ist`, body: null };
    case "git-merge-main":
      return { heading: `In ${op.target} mergen`, detail: `${op.branch.replace(/^origin\//, "")} → ${op.target}, dann pushen`, body: null };
    case "git-commit-branch":
      return {
        heading: `${op.files.length} Datei${op.files.length === 1 ? "" : "en"} committen`,
        detail: `auf ${op.branch}: „${op.message}“`,
        body: null,
        files: op.files,
      };
  }
}

/** Operations as an AI hands them over, cleaned: the ones that are complete, in Zeff's shapes. */
export function cleanOps(raw: unknown, ticket: string): TodoOp[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const key = (v: unknown) =>
    /^[A-Z][A-Z0-9]+-\d+$/i.test(str(v)) ? str(v).toUpperCase() : ticket;
  const note = (v: unknown) => {
    const m = /(?:gitlab:)?(note:\d+)/.exec(str(v));
    return m ? m[1] : "";
  };
  return raw
    .flatMap((x): TodoOp[] => {
      const o = (x ?? {}) as Record<string, unknown>;
      if (o.type === "jira-transition" && str(o.to))
        return [{ type: o.type, ticket: key(o.ticket), to: str(o.to) }];
      if (o.type === "jira-assign" && str(o.assignee))
        return [
          { type: o.type, ticket: key(o.ticket), assignee: str(o.assignee) },
        ];
      if (o.type === "jira-create" && str(o.summary) && str(o.body))
        return [
          {
            type: o.type,
            ticket: key(o.ticket),
            summary: str(o.summary).slice(0, 250),
            issueType: str(o.issueType) || str(o.issue_type) || "Task",
            body: str(o.body).slice(0, 20000),
          },
        ];
      if (o.type === "jira-comment" && str(o.body))
        return [
          {
            type: o.type,
            ticket: key(o.ticket),
            body: str(o.body).slice(0, 8000),
          },
        ];
      if (o.type === "gitlab-reply" && note(o.note) && str(o.body))
        return [
          {
            type: o.type,
            note: note(o.note),
            body: str(o.body).slice(0, 8000),
          },
        ];
      if (o.type === "gitlab-resolve" && note(o.note))
        return [{ type: o.type, note: note(o.note) }];
      if (o.type === "teams-message" && str(o.to) && str(o.body))
        return [{ type: o.type, to: str(o.to).slice(0, 120), body: str(o.body).slice(0, 4000) }];
      if (
        o.type === "git-push" &&
        str(o.repo) &&
        str(o.branch) &&
        str(o.remote)
      )
        return [
          {
            type: o.type,
            repo: str(o.repo),
            branch: str(o.branch),
            remote: str(o.remote),
            target: str(o.target) || "main",
            title: str(o.title) || undefined,
            description: str(o.description) || undefined,
          },
        ];
      if (
        o.type === "gitlab-open-mr" &&
        str(o.project) &&
        str(o.source) &&
        str(o.target)
      )
        return [
          {
            type: o.type,
            repo: str(o.repo),
            project: str(o.project),
            source: str(o.source),
            target: str(o.target),
            title: str(o.title) || str(o.source),
            description: str(o.description),
          },
        ];
      if (o.type === "gitlab-merge" && str(o.project) && Number(o.iid) > 0)
        return [
          {
            type: o.type,
            project: str(o.project),
            iid: Number(o.iid),
            source: str(o.source),
          },
        ];
      if (o.type === "git-merge-main" && str(o.repo) && str(o.branch))
        return [
          {
            type: o.type,
            repo: str(o.repo),
            branch: str(o.branch),
            target: str(o.target) || "main",
          },
        ];
      if (o.type === "git-commit-branch" && str(o.repo) && str(o.branch) && Array.isArray(o.files) && o.files.length)
        return [
          {
            type: o.type,
            repo: str(o.repo),
            branch: str(o.branch),
            files: o.files.map(str).filter(Boolean).slice(0, 500),
            message: str(o.message) || str(o.branch),
            target: str(o.target) || "main",
          },
        ];
      return [];
    })
    .slice(0, 6);
}

/**
 * The dictionary of operations Zeff runs by itself — one source for everything about them: what
 * each is for, its fields, an example. The AI's answers are held to it (the JSON schema built
 * from it), prompts explain it (opsDictionary), cleanOps keeps only what fits it.
 */
export const OP_CATALOG: Record<
  (typeof TODO_OP_TYPES)[number],
  {
    label: string;
    when: string;
    fields: Record<string, string>;
    example: Record<string, string>;
  }
> = {
  "jira-transition": {
    label: "Jira-Status ändern",
    when: "Das Ticket soll in einen anderen Status (z. B. nach der Umsetzung auf Testing).",
    fields: {
      ticket: "der Ticket-Key",
      to: "der Name eines der möglichen Übergänge des Tickets, genau so geschrieben",
    },
    example: { type: "jira-transition", ticket: "PROJ-415", to: "Testing" },
  },
  "jira-assign": {
    label: "Jira-Ticket zuweisen",
    when: "Das Ticket soll jemand anderem gehören (z. B. dem Tester).",
    fields: {
      ticket: "der Ticket-Key",
      assignee:
        "der Jira-Benutzername (bei den Beteiligten in Klammern hinter dem Namen)",
    },
    example: { type: "jira-assign", ticket: "PROJ-415", assignee: "cressl" },
  },
  "jira-comment": {
    label: "Jira-Kommentar posten",
    when: "Ein Kommentar im Ticket — Stand, Antwort auf eine Rückfrage, Bitte um Test.",
    fields: {
      ticket: "der Ticket-Key",
      body: "der fertige Kommentar (Jira-Wiki-Markup)",
    },
    example: {
      type: "jira-comment",
      ticket: "PROJ-415",
      body: "Der Fix ist auf feature/PROJ-415-… — bitte erneut testen.",
    },
  },
  "jira-create": {
    label: "Jira-Ticket anlegen",
    when: "Ein neues Ticket ist nötig (ein Thema wird ausgelagert, eine Folgearbeit, ein gefundenes Problem) — mit fertigem Titel und vollständiger Beschreibung, im Projekt des Tickets und mit ihm verknüpft.",
    fields: {
      ticket: "das Ticket, aus dem es kommt (damit wird es verknüpft; sein Projekt ist das des neuen)",
      summary: "der Titel des neuen Tickets",
      issueType: "Task, Bug oder Story",
      body: "die Beschreibung in Markdown: Hintergrund (mit Verweis aufs Ticket), was genau zu tun ist, Akzeptanzkriterien als Liste",
    },
    example: {
      type: "jira-create",
      ticket: "PROJ-415",
      summary: "Nicht unterstützte Video-URLs in der VideoHub-Migration behandeln",
      issueType: "Task",
      body: "Aus PROJ-415: Die VideoHub-Migration überspringt Video-URLs, die VideoHub nicht importieren kann.\n\n## Zu tun\n- Anzahl und Art der betroffenen URLs ermitteln\n- klären, ob die Seiten noch aktiv sind\n\n## Akzeptanzkriterien\n- Liste der URLs mit Seite und Status liegt vor",
    },
  },
  "gitlab-reply": {
    label: "Auf GitLab-Kommentar antworten",
    when: "Eine Antwort im Thread eines Merge-Request-Kommentars.",
    fields: {
      note: "note:<id> des Kommentars (aus seiner Kennung gitlab:note:<id>)",
      body: "die fertige Antwort (Markdown)",
    },
    example: {
      type: "gitlab-reply",
      note: "note:461450",
      body: "Umgesetzt — die Klassen kommen jetzt per use-Statement.",
    },
  },
  "gitlab-resolve": {
    label: "GitLab-Thread auflösen",
    when: "Der Thread eines Merge-Request-Kommentars ist erledigt.",
    fields: {
      note: "note:<id> des Kommentars (aus seiner Kennung gitlab:note:<id>)",
    },
    example: { type: "gitlab-resolve", note: "note:461450" },
  },
  "teams-message": {
    label: "Teams-Nachricht senden",
    when: "Eine Rückfrage oder Bitte an jemanden ist seit mehr als einem Arbeitstag unbeantwortet (oder es eilt, etwa vor einem Deployment): kurz und freundlich per Teams-Chat nachhaken — mit Bezug aufs Ticket und dem, was du brauchst. Nicht, wenn die Person laut Daten abwesend ist oder schon geantwortet hat.",
    fields: {
      to: "der volle Anzeigename der Person, wie bei den Beteiligten (ohne Benutzernamen), z. B. Christopher Ressl",
      body: "die fertige Nachricht (Klartext, Du-Form, 1–3 Sätze, mit Ticket-Key)",
    },
    example: {
      type: "teams-message",
      to: "Christopher Ressl",
      body: "Hi Christopher, kurze Nachfrage zu PROJ-321: soll die Navigation-Story ohne das Refinement gebaut werden oder in ein eigenes Ticket? Dann kann ich weitermachen.",
    },
  },
};

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
        type: {
          type: "string",
          const: type,
          description: OP_CATALOG[type].label,
        },
        ...Object.fromEntries(
          Object.entries(OP_CATALOG[type].fields).map(([k, d]) => [
            k,
            { type: "string", description: d },
          ]),
        ),
      },
    })),
  },
};

/** The dictionary as prompts give it: each operation, when, its fields — and an example to copy. */
export function opsDictionary(): string {
  return [
    "Wörterbuch der Operationen, die Zeff ohne KI ausführt (Feld „ops“ eines Todos oder Follow-ups; jede Operation genau in dieser Form):",
    ...TODO_OP_TYPES.map((t) => {
      const c = OP_CATALOG[t];
      return `- ${t} — ${c.label}: ${c.when} Felder: ${Object.entries(c.fields)
        .map(([k, d]) => `${k} (${d})`)
        .join(", ")}. Beispiel: ${JSON.stringify(c.example)}`;
    }),
    "Was sich so ausdrücken lässt (Status, Zuweisung, Kommentar, neues Ticket, GitLab-Antwort, Thread auflösen, Teams-Nachricht), gib IMMER als ops an — ein Todo „Ticket … anlegen“ bekommt eine jira-create mit fertigem Titel und vollständiger Beschreibung — zusätzlich zum Text. Mehrere Operationen in der Reihenfolge, in der sie laufen sollen.",
    "Wartest du auf eine Antwort, die seit über einem Arbeitstag aussteht (ein Flag wie „Rückfrage … offen“), bekommt das wartende Todo eine teams-message an die Person — als Nachhaken, das ich mit einem Klick sende.",
  ].join("\n");
}

/** A todo as shown and handed to agents — referenced as T-<id>. */
export type TodoView = {
  id: number;
  ref: string;
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
                    "Kurz wie ein Knopf: „→ Testing“, „Zuweisen: Christopher Ressl“, „Kommentar: Stand melden“.",
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
