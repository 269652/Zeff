/**
 * The Jira plugin's actions, run: in one session of Zeff's Jira connection (the Jira MCP server)
 * for the ones in a row — afterwards the tickets read anew. Server only.
 */
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { norm, transitionsOf } from "@/lib/boards/actions";
import type { TodoOp } from "@/lib/boards/shared";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";
import { extractIssues, normalizeIssue, type NormalizedTicket } from "@/lib/jira/normalize";
import { getJiraTicket, upsertTickets } from "@/lib/jira/store";
import { getJiraSyncConfig } from "@/lib/jira/sync";

type Call = (tool: string, args: Record<string, unknown>) => Promise<unknown>;
export type JiraOp = Extract<TodoOp, { type: `jira-${string}` }>;

/** The issue types to try for a new ticket, in order: as asked, its German name, the source ticket's, the project's (most used first). */
function issueTypesFor(asked: string, ticket: string): string[] {
  const ALIASES: Record<string, string[]> = { task: ["Task", "Aufgabe"], aufgabe: ["Aufgabe", "Task"], bug: ["Bug", "Fehler"], fehler: ["Fehler", "Bug"], story: ["Story"] };
  const project = ticket.split("-")[0];
  const used = getDb()
    .select({ t: schema.jiraTickets.issueType, n: sql<number>`count(*)` })
    .from(schema.jiraTickets)
    .where(sql`${schema.jiraTickets.key} like ${`${project}-%`} and ${schema.jiraTickets.issueType} is not null`)
    .groupBy(schema.jiraTickets.issueType)
    .orderBy(sql`count(*) desc`)
    .all()
    .map((r) => r.t!)
    .filter((t) => !/sub-?task|epic|unteraufgabe/i.test(t));
  return [...new Set([asked, ...(ALIASES[asked.trim().toLowerCase()] ?? []), getJiraTicket(ticket)?.issueType ?? "", ...used].filter(Boolean))].slice(0, 6);
}

/** The key of a ticket jira_create_issue made ({ issue: { key } }, { key }, or in its words). */
function createdKey(payload: unknown): string | null {
  const o = (payload ?? {}) as Record<string, unknown>;
  const issue = (o.issue ?? o) as Record<string, unknown>;
  if (typeof issue.key === "string") return issue.key;
  return /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(typeof payload === "string" ? payload : JSON.stringify(payload ?? ""))?.[1] ?? null;
}

/** One Jira operation, in an open session of Zeff's Jira connection. What happened. */
async function jiraOp(call: Call, op: JiraOp): Promise<string> {
  if (op.type === "jira-transition") {
    const list = transitionsOf(
      resultToPayload(
        await call("jira_get_transitions", { issue_key: op.ticket }),
      ),
    );
    const want = norm(op.to);
    const hit =
      list.find((t) => norm(t.name) === want || norm(t.to) === want) ??
      list.find(
        (t) =>
          !!want && (norm(t.name).includes(want) || norm(t.to).includes(want)),
      );
    if (!hit)
      throw new Error(
        t("{ticket}: no transition “{to}” from here — possible: {list}.", { ticket: op.ticket, to: op.to, list: list.map((x) => x.name).join(", ") || t("none") }),
      );
    await call("jira_transition_issue", {
      issue_key: op.ticket,
      transition_id: hit.id,
    });
    return `${op.ticket} → ${hit.to ?? hit.name}`;
  }
  if (op.type === "jira-assign") {
    await call("jira_update_issue", {
      issue_key: op.ticket,
      fields: JSON.stringify({ assignee: op.assignee }),
    });
    return t("{ticket} assigned: {assignee}", { ticket: op.ticket, assignee: op.assignee });
  }
  if (op.type === "jira-create") {
    // The description goes as Markdown — the Jira connection writes it as Jira's markup.
    // The type as asked, else as this Jira names it (a German one: Aufgabe, Fehler), the source
    // ticket's, the ones the project has — till one is taken.
    const project = op.ticket.split("-")[0];
    // Its source ticket's labels and components: they put a ticket on its board (PROJ: "Relaunch" or "Support").
    const source = resultToPayload(await call("jira_get_issue", { issue_key: op.ticket, fields: "labels,components" })) as { labels?: unknown; components?: unknown };
    const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String((x as { name?: string })?.name ?? ""))).filter(Boolean) : []);
    const labels = names(source.labels);
    const components = names(source.components);
    let created: unknown = null;
    let lastError: unknown = null;
    for (const issueType of issueTypesFor(op.issueType, op.ticket)) {
      try {
        created = resultToPayload(
          await call("jira_create_issue", {
            project_key: project,
            summary: op.summary,
            issue_type: issueType,
            description: op.body,
            ...(components.length ? { components: components.join(",") } : {}),
            ...(labels.length ? { additional_fields: JSON.stringify({ labels }) } : {}),
          }),
        );
        break;
      } catch (e) {
        lastError = e;
        if (!/vorgangstyp|issue ?type|issuetype/i.test(errorMessage(e))) throw e;
      }
    }
    if (!created) throw lastError ?? new Error(t("No issue type worked."));
    const key = createdKey(created);
    if (!key) throw new Error(t("Jira created the ticket but didn't return a key: {answer}", { answer: JSON.stringify(created).slice(0, 200) }));
    let linked = "";
    try {
      await call("jira_create_issue_link", { link_type: "Relates", inward_issue_key: key, outward_issue_key: op.ticket });
      linked = ` ${t("(linked to {ticket})", { ticket: op.ticket })}`;
    } catch {
      linked = ` ${t("(linking to {ticket} didn't work — please set it in Jira)", { ticket: op.ticket })}`;
    }
    const url = getJiraTicket(op.ticket)?.url?.replace(/\/browse\/.*$/, `/browse/${key}`);
    return `${t("Ticket {key} created", { key })}${labels.length ? ` ${t("(labels: {labels})", { labels: labels.join(", ") })}` : ""}${linked}${url ? `: ${url}` : ""}`;
  }
  await call("jira_add_comment", { issue_key: op.ticket, body: op.body });
  return t("Comment posted on {ticket}", { ticket: op.ticket });
}

/**
 * Jira operations in a row, in one session — each noted as it's done; then the tickets as Jira
 * has them now (assignee, status). What was done; on a failure, what was done before it
 * (`done`) and the error.
 */
export async function runJiraOps(run: JiraOp[], note: (line: string) => void): Promise<string[]> {
  const cfg = getJiraSyncConfig();
  if (!cfg.configured || !cfg.command) throw new Error(t("Zeff's Jira connection isn't set up (Jira tab)."));
  const results: string[] = [];
  try {
    await runStdioSession(
      { command: cfg.command, args: cfg.args, env: cfg.env, label: "Jira" },
      async (call) => {
        for (const o of run) {
          results.push(await jiraOp(call, o));
          note(`[Zeff] ✓ ${results[results.length - 1]}`);
        }
        // The tickets as Jira has them now (assignee, status) — not only at the next sync.
        const keys = [...new Set(run.map((o) => o.ticket.toUpperCase()))];
        try {
          const p = resultToPayload(await call(cfg.tool, { jql: `key in (${keys.join(",")})`, limit: keys.length, fields: cfg.fields }));
          const fresh = extractIssues(p)
            .map((i) => normalizeIssue(i, cfg.baseUrl))
            .filter((t): t is NormalizedTicket => t !== null);
          if (fresh.length) upsertTickets(fresh);
          note(`[Zeff] ${keys.join(", ")} re-read from Jira`);
        } catch {
          note(`[Zeff] ${keys.join(", ")} couldn't be re-read — the next Jira sync gets it`);
        }
      },
      120000,
    );
  } catch (e) {
    throw Object.assign(new Error(errorMessage(e)), { done: results });
  }
  return results;
}
