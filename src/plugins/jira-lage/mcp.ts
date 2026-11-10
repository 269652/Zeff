/**
 * The assistant's tools for "which tickets should I do next" on the mirrored Jira boards: workspace_tickets_for_me reads
 * them (your unfinished tickets, then what is ready to pick up — pick.ts), workspace_board_filter shows a board filtered
 * by criteria the assistant chooses — in its answer (the Workspace assistant draws the tickets: chat-embed.ts) and as an
 * address that opens the board with that filter. Both only read: nothing changes in Jira or on the board. Registered where
 * Zeff's other tools are (the MCP server, the Workspace assistant). Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { isInstalled } from "@/plugins/state";
import { mayRead } from "@/lib/boundaries";
import { findPage, type Helpers } from "@/plugins/workspace/mcp";
import { pageLabel } from "@/plugins/workspace/sensitivity";
import { getPage, rowsOf } from "@/plugins/workspace/store";
import { previewLines } from "@/plugins/workspace/doc";
import { LAGE_FIELDS } from "@/plugins/workspace/lage-fields";
import { withEmbeds, type TicketsEmbed } from "@/plugins/workspace/chat-embed";
import { boardTickets, cleanCriteria, encodePick, isMe, pickTickets, STAGES, type PickResult, type PickCriteria, type PickGroupId, type Ticket } from "./pick";
import { isJiraBoard, jiraBoardDatabases, jiraMeNames } from "./me";

const GROUP_TITLE: Record<PickGroupId, string> = { mine: "Still open for you", ready: "Ready to pick up", match: "Matching tickets" };

/** The boards to look at: the one named (it must be a mirrored Jira board), else all of them you may read. */
function boardsFor(board: number | string | undefined): { id: number; title: string }[] {
  if (board !== undefined && String(board).trim()) {
    const p = findPage(board);
    if (!p || p.kind !== "database" || !isJiraBoard(p.id)) throw new ValidationError(`No mirrored Jira board "${board}" — leave board out to look at all of them.`);
    return [{ id: p.id, title: p.title || "Jira" }];
  }
  return jiraBoardDatabases().filter((b) => mayRead(pageLabel(b.id)));
}

export const pickHref = (dbId: number, c: PickCriteria): string => `/workspace/${dbId}?pick=${encodePick(c)}`;

/** What the AI needs to judge a ticket: its description (the card's page) and the Lage's view of it, shortened. */
function details(x: Ticket, cells: Record<string, unknown> | undefined): string {
  const cut = (v: unknown, n: number) => {
    const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    return s.length > n ? `${s.slice(0, n)} …` : s;
  };
  const desc = cut(previewLines(getPage(x.id)?.content, 12).map((l) => l.text).join(" "), 500);
  const lage = [cut(cells?.[LAGE_FIELDS.summary], 300), cut(cells?.[LAGE_FIELDS.lead], 200)].filter(Boolean).join(" — ");
  return [x.updated ? `    updated: ${x.updated}` : "", desc ? `    description: ${desc}` : "", lage ? `    Lage: ${lage}` : ""].filter(Boolean).join("\n");
}

function line(x: Ticket, me: string[], cells?: Record<string, unknown>, full = false): string {
  const more = full ? details(x, cells) : "";
  return `- [row ${x.id}] ${x.key || "—"} “${x.title}” — ${[x.status || "no status", x.priority || null, x.assignee ? `${x.assignee}${isMe(x.assignee, me) ? " (you)" : ""}` : "unassigned", x.type || null].filter(Boolean).join(" · ")}${more ? `\n${more}` : ""}`;
}

/** A board's pick as text for the AI, and as the assistant's embed. */
function described(b: { id: number; title: string }, c: PickCriteria, me: string[], full = false): { text: string; embed: TicketsEmbed; count: number } | null {
  const d = rowsOf(b.id);
  if (!d) return null;
  const { columns, tickets } = boardTickets(d.schema, d.rows);
  const cellsOf = new Map(d.rows.map((r) => [r.id, r.cells as Record<string, unknown>]));
  const pick: PickResult = pickTickets(columns, tickets, me, c);
  const href = pickHref(b.id, c);
  const head = [
    `## Board “${b.title}” (database ${b.id}) — ${c.forMe ? "tickets for you" : (c.title ?? "filtered")}`,
    `Columns: ${columns.map((x) => x.name).join(" → ") || "none"}. Ready to pick up from: ${pick.ready.join(", ") || "no column"}; done: ${pick.done.join(", ") || "no column"}.`,
    `Open the board filtered like this: ${href}`,
  ];
  const body = pick.groups.flatMap((g) => [``, `${GROUP_TITLE[g.id]} (${g.total}${g.total > g.tickets.length ? `, first ${g.tickets.length}` : ""}):`, ...(g.tickets.length ? g.tickets.map((x) => line(x, me, cellsOf.get(x.id), full)) : ["(none)"])]);
  const embed: TicketsEmbed = {
    kind: "tickets",
    dbId: b.id,
    board: b.title,
    href,
    criteria: c,
    groups: pick.groups.map((g) => ({ id: g.id, total: g.total, tickets: g.tickets.map((x) => ({ rowId: x.id, key: x.key, title: x.title, status: x.status, assignee: x.assignee, priority: x.priority, mine: isMe(x.assignee, me), ...(c.why ? { why: Object.entries(c.why).find(([k]) => k.toLowerCase() === x.key.toLowerCase())?.[1] } : {}) })) })),
  };
  return { text: [...head, ...body].join("\n"), embed, count: pick.groups.reduce((n, g) => n + g.total, 0) };
}

const meNote = (me: string[]) => (me.length ? `You are in Jira: ${me.join(" / ")}.` : "Zeff doesn't know your Jira name yet (no ticket synced as yours, no JIRA_USERNAME, no “Assign to me” yet) — only unassigned tickets count as candidates.");

const BOARD = z.union([z.number().int(), z.string()]).optional().describe("The board's database (id or title). Leave it out: every mirrored Jira board.");

export function registerJiraPickTools(server: McpServer, h: Helpers): void {
  const off = () => (isInstalled("jira-lage") && isInstalled("workspace") ? null : h.fail("The Jira boards plugin (Jira briefing) is not installed in Zeff — this tool isn't available."));

  server.registerTool(
    "workspace_tickets_for_me",
    {
      title: "Tickets for me (mirrored Jira boards)",
      description:
        "Which tickets come into question next for the user on the mirrored Jira boards: first their own unfinished tickets (assigned to them, in a column between Ready and Done — nearest to done first), then the candidates from the Ready column (unassigned or already theirs; by Jira priority, then the board's rank). " +
        "Each ticket comes with its description and the Lage's view of it. Use it whenever the user asks which tickets they could do next / tickets for themselves: then DON'T hand them the whole list — judge the candidates yourself (finish what's theirs and nearly done first; then what matters most: priority, blocks others, fits what they work on — look at their recent work with search_context / list_todos if it helps; small enough to start now) and pick the 2–3 that make the most sense, then show exactly those with workspace_board_filter (keys + why). Read-only: it changes nothing in Jira or on the board.",
      inputSchema: z.object({ board: BOARD, limit: z.number().int().min(1).max(60).optional().describe("At most this many per group (default 40).") }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ board, limit }) =>
      h.run(async () => {
        const gone = off();
        if (gone) return gone;
        const boards = boardsFor(board);
        if (!boards.length) return h.ok("There are no mirrored Jira boards in the Workspace (the Jira sync makes them).");
        const me = await jiraMeNames();
        const parts = boards.map((b) => described(b, { forMe: true, limit: limit ?? 40 }, me, true)).filter((x) => !!x);
        return h.ok([meNote(me), ...parts.map((p) => p.text)].join("\n\n"));
      }),
  );

  server.registerTool(
    "workspace_board_filter",
    {
      title: "Show a filtered Jira board",
      description:
        "Show the user a mirrored Jira board filtered by criteria you choose — they see the tickets in your answer, with a link that opens the board with the same filter. Nothing is saved: the board, its views and Jira stay as they are. " +
        "forMe: true is the “Find tickets for me” filter (their unfinished tickets first, then Ready's candidates; the other criteria then narrow it). Otherwise: statuses (column names) or stages (backlog, ready, active = started, done; default: everything not done), assignee (me, unassigned, me_or_unassigned, others, anyone), priorities, types, text (words in key or summary), sort (priority — default, board, updated, progress), limit. " +
        "keys: exactly these tickets (Jira keys) in this order — your own pick, e.g. the 2–3 you recommend — with why: { KEY: one line why } (shown under each ticket); the other criteria are then ignored. " +
        "Give a short title and reason (why these tickets). When the user asks for tickets for themselves, read workspace_tickets_for_me first, pick the best 2–3 yourself and show them here with keys + why.",
      inputSchema: z.object({
        board: BOARD,
        forMe: z.boolean().optional(),
        statuses: z.array(z.string().max(80)).max(20).optional(),
        stages: z.array(z.enum(STAGES as unknown as [string, ...string[]])).max(4).optional(),
        assignee: z.enum(["me", "unassigned", "me_or_unassigned", "others", "anyone"]).optional(),
        priorities: z.array(z.string().max(40)).max(10).optional(),
        types: z.array(z.string().max(40)).max(10).optional(),
        text: z.string().max(100).optional(),
        keys: z.array(z.string().max(40)).max(20).optional().describe("Exactly these tickets, in this order (your pick)."),
        why: z.record(z.string(), z.string().max(240)).optional().describe("Per key: one line why you picked it."),
        sort: z.enum(["priority", "board", "updated", "progress"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        title: z.string().max(80).optional().describe("What you call this view, e.g. “Next for you”."),
        reason: z.string().max(300).optional().describe("One sentence: why these tickets."),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ board, ...rest }) =>
      h.run(async () => {
        const gone = off();
        if (gone) return gone;
        const boards = boardsFor(board);
        if (!boards.length) return h.ok("There are no mirrored Jira boards in the Workspace (the Jira sync makes them).");
        const c = cleanCriteria(rest) ?? {};
        const me = await jiraMeNames();
        // Several boards: those with tickets for these criteria (the user sees each).
        const parts = boards.map((b) => described(b, c, me)).filter((x) => !!x);
        const shown = parts.length > 1 ? parts.filter((p) => p.count > 0) : parts;
        if (!shown.length) return h.ok(`${meNote(me)}\n\nNo tickets match on ${parts.length} board(s).`);
        return withEmbeds(h.ok([meNote(me), "In the Workspace assistant the user sees these tickets (with your why) under your answer — don't list them again, say in a sentence or two why these; anywhere else, give the link.", ...shown.map((p) => p.text)].join("\n\n")), shown.map((p) => p.embed));
      }),
  );
}
