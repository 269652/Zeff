/**
 * "What you should know" for agents (over the MCP): the brief before a meeting and about anyone or anything — who they are, what
 * is open between you, the latest, what it is about, sources not up to date — and the AI's points when they are kept for it as it
 * is now (no AI call from here). Read-only; it follows the caller's clearance (personal data only for you and permitted agents,
 * secret never). There while the know plugin is installed. Server only.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isInstalled } from "@/plugins/state";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
type Helpers = { run: (fn: () => Promise<Result> | Result) => Promise<Result>; ok: (text: string) => Result; fail: (text: string) => Result };

/** The kept AI points as lines (only when made from the brief as it is now). */
async function pointsOf(key: string, hash: string): Promise<string[]> {
  const { cachedSummary } = await import("./summary");
  const s = cachedSummary(key, hash);
  return s?.current && s.points.length ? ["", "## In short (AI)", ...s.points.map((p) => `- ${p.text} [${p.sources.map((x) => x.ref).join(", ")}]`)] : [];
}

export function registerKnowTools(server: McpServer, { run, ok, fail }: Helpers): void {
  const off = () => (isInstalled("know") ? null : fail("The “What you should know” plugin is not installed in Zeff (Menu → Plugins) — this tool isn't available."));

  server.registerTool(
    "meeting_brief",
    {
      title: "Brief me before a meeting",
      description:
        "What to know before a meeting: its time, place and attendees; per person you know in it their role, the facts that hold, away, a birthday near, money open either way, the last contact; what is open between you (promised by you or to you, overdue marked); the latest interactions; the tickets, cases and projects it is about; sources that haven't synced (it may miss things then). Without `event`: the next meeting with someone known in it (from 30 minutes ago to 24 hours ahead). `event`: a calendar event id (as timeline_for shows event:<id>); `occurrence`: the day of one of a series (YYYY-MM-DD). Read-only.",
      inputSchema: z.object({ event: z.number().int().optional(), occurrence: z.string().optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const gone = off();
        if (gone) return gone;
        if (!isInstalled("calendar")) return fail("The Calendar plugin is not installed in Zeff — there are no meetings to brief.");
        const { meetingBrief, upcomingMeetings, briefText } = await import("./brief");
        const { meetingKey } = await import("./summary");
        let id = args.event ?? null;
        let occurrence = args.occurrence ?? undefined;
        if (!id) {
          const next = upcomingMeetings({ withinMinutes: 24 * 60, startedMinutes: 30 })[0];
          if (!next) return ok("No meeting with someone you know in the next 24 hours.");
          id = next.id;
          occurrence = next.occurrence ?? undefined;
        }
        const b = await meetingBrief(id, { occurrence });
        if (!b) return fail(`No calendar event ${id}.`);
        return ok([briefText(b), ...(await pointsOf(meetingKey(id, occurrence), b.hash))].join("\n"));
      }),
  );

  server.registerTool(
    "context_brief",
    {
      title: "What you should know about someone or something",
      description:
        "The brief about a person, a ticket, a Workspace page or row (a case, a mail's or chat's row), a project: who they are (only facts that hold), what is open between you, the latest interactions, what it is about, sources not up to date. `ref`: a ref (person:12, ticket:PROJ-7, page:31, project:3) or a name, ticket key or title. Read-only.",
      inputSchema: z.object({ ref: z.string().describe("A ref (person:12, ticket:PROJ-7, page:31) or a name / key / title") }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) =>
      run(async () => {
        const gone = off();
        if (gone) return gone;
        const { resolveQuery } = await import("@/plugins/timeline/refs");
        const hit = resolveQuery(args.ref);
        if (!hit) return fail(`Nothing known by “${args.ref}” — give a ref (person:12, ticket:PROJ-7, page:31) or a person's name, a ticket key, a project.`);
        const { briefFor, briefText, rowRefs } = await import("./brief");
        const row = /^page:(\d+)$/.exec(hit.ref);
        const b = await briefFor(row ? rowRefs(Number(row[1])) : [hit.ref], { label: hit.label });
        return ok([briefText(b), ...(await pointsOf(row ? `row:${row[1]}` : `ref:${hit.ref}`, b.hash))].join("\n"));
      }),
  );
}
