/**
 * The timeline's tools for agents (over the MCP): what happened with a person, a ticket, a page, a project — and what changed since a
 * time, by entity. Read-only, any agent; there while the Timeline plugin is installed. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isInstalled } from "@/plugins/state";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
type Helpers = { run: (fn: () => Promise<Result> | Result) => Promise<Result>; ok: (text: string) => Result; fail: (text: string) => Result };

const csv = z.union([z.array(z.string()), z.string()]).optional();
const listOf = (v: string[] | string | undefined) => (Array.isArray(v) ? v : v ? v.split(",") : undefined)?.map((s) => s.trim()).filter(Boolean);

export function registerTimelineTools(server: McpServer, { run, ok, fail }: Helpers): void {
  const off = () => (isInstalled("timeline") ? null : fail("The Timeline plugin is not installed in Zeff (Menu → Plugins) — this tool isn't available."));

  server.registerTool(
    "timeline_for",
    {
      title: "What happened with someone or something",
      description:
        "The timeline of one entity, newest first: mails, chat and Teams messages, ticket changes and comments, merge requests, appointments, time entries, todos made/done, Workspace row changes, payments, documents — each with when, what, the other entities it concerns (as refs) and a link. Give `ref` as a ref (person:12, ticket:PROJ-7, page:31, project:3, todo:88) or as free text (a person's name or alias, a ticket key, a project's or page's title). Narrow with since/until (2026-10-01, 7d, 24h), kinds (mail, message, ticket, comment, meeting, time, todo, row, payment, document, mr — a prefix matches: todo = todo.created, todo.done …) and sources. Read-only.",
      inputSchema: z.object({
        ref: z.string().describe("A ref (person:12, ticket:PROJ-7, page:31) or a name / key / title"),
        since: z.string().optional(),
        until: z.string().optional(),
        kinds: csv,
        sources: csv,
        limit: z.number().int().min(1).max(300).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const gone = off();
        if (gone) return gone;
        const { timelineFor, eventLines } = await import("./query");
        const r = timelineFor({ ref: args.ref, since: args.since, until: args.until, kinds: listOf(args.kinds), sources: listOf(args.sources), limit: args.limit ?? 40 });
        if (!r.ok) return fail(r.error);
        const head = `${r.label} [${r.refs.join(", ")}] — ${r.events.length} event(s)${r.lastSeen ? `; you last looked ${r.lastSeen.slice(0, 16).replace("T", " ")}` : ""}`;
        return ok([head, ...eventLines(r.events)].join("\n"));
      }),
  );

  server.registerTool(
    "timeline_since",
    {
      title: "What changed since a time",
      description:
        "Everything that happened since a time, grouped by the entity it concerns (people, tickets, Workspace pages and rows, projects, jobs, todos …), the busiest first: per entity its label, ref, how many events, of which kinds, and the latest few as lines. `since`: a day (2026-10-01), an ISO time or a span back (24h, 7d, 2w). Optional kinds, sources, refKinds (person, ticket, page …) to narrow. Read-only.",
      inputSchema: z.object({
        since: z.string(),
        until: z.string().optional(),
        kinds: csv,
        sources: csv,
        refKinds: csv,
        limit: z.number().int().min(1).max(100).optional(),
        perGroup: z.number().int().min(1).max(20).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const gone = off();
        if (gone) return gone;
        const { timelineSince, eventLines } = await import("./query");
        const r = timelineSince({ since: args.since, until: args.until, kinds: listOf(args.kinds), sources: listOf(args.sources), refKinds: listOf(args.refKinds), limit: args.limit ?? 25, perGroup: args.perGroup ?? 3 });
        if (!r.ok) return fail(r.error);
        if (!r.groups.length) return ok(`Nothing happened since ${r.since.slice(0, 16).replace("T", " ")}.`);
        const blocks = r.groups.map((g) => [`## ${g.label} [${g.ref}] — ${g.count} (${Object.entries(g.kinds).map(([k, n]) => `${k} ${n}`).join(", ")})`, ...eventLines(g.events).map((l) => `- ${l}`)].join("\n"));
        return ok([`Since ${r.since.slice(0, 16).replace("T", " ")}:`, ...blocks].join("\n\n"));
      }),
  );
}
