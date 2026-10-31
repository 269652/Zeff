/** What a Ticket-Lage run hands over — the tickets, their actions and questions, the result schema — and a run as shown (client-safe). */

import type { T } from "@/lib/i18n/shared";
import { type TodoKind, TODO_KINDS, TODO_OPS_SCHEMA } from "../todos/shared";

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
  /** The sources it read that weren't well as it ran (failing, stale, silent, drift): what it may not know — shown under the lede. */
  gaps?: { key: string; label: string; state: string; href: string }[];
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
                    "Worauf es sich stützt, kurz: z. B. „Kommentar Laura Schulz 24.09.“",
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
                    "Kurz wie ein Knopf: „→ Testing“, „Zuweisen: Thomas Becker“, „Kommentar: Stand melden“.",
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
