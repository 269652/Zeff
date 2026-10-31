import { isOwnKey } from "@/lib/ticket-keys";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { errorMessage, NotFoundError, ValidationError } from "@/lib/errors";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { t } from "@/lib/i18n/server";
import type { TicketAction } from "./shared";
import { getBoardRun } from "./store";

const { ticketActions } = schema;

export type ActionDone = { status: "done" | "failed"; detail: string | null; at: string };

/** What was done with a run's suggested actions, by "<ticket>#<index>" (the latest try). */
export function actionsDone(runId: number): Record<string, ActionDone> {
  const out: Record<string, ActionDone> = {};
  for (const r of getDb().select().from(ticketActions).where(eq(ticketActions.runId, runId)).orderBy(ticketActions.id).all()) {
    out[`${r.ticket}#${r.idx}`] = { status: r.status === "done" ? "done" : "failed", detail: r.detail, at: r.at };
  }
  return out;
}

/** A ticket's transitions as mcp-atlassian lists them. */
export function transitionsOf(payload: unknown): { id: string; name: string; to: string | null }[] {
  const list = Array.isArray(payload) ? payload : ((payload as { transitions?: unknown[] })?.transitions ?? []);
  return list.flatMap((item) => {
    const x = (item ?? {}) as { id?: string | number; name?: string; to_status?: string | { name?: string }; to?: { name?: string } };
    const to = typeof x.to_status === "string" ? x.to_status : (x.to_status?.name ?? x.to?.name ?? null);
    return x.id !== undefined && x.name ? [{ id: String(x.id), name: x.name, to }] : [];
  });
}

export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/\(→[^)]*\)/g, "")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .trim();

/**
 * Do one of a run's suggested ticket changes in Jira, through Zeff's Jira connection — a
 * transition (matched by its name or where it leads), an assignee, a comment — and keep what
 * happened. Only when you click it; once done, not again.
 */
export async function runTicketAction(runId: number, ticket: string, idx: number): Promise<{ action: TicketAction; detail: string }> {
  const run = getBoardRun(runId);
  const action = run?.result?.tickets.find((x) => x.key === ticket)?.actions?.[idx];
  if (!run || !action) throw new NotFoundError(t("That suggestion isn't there (any more)."));
  if (actionsDone(runId)[`${ticket}#${idx}`]?.status === "done") throw new ValidationError(t("“{label}” is done already.", { label: action.label }));
  const keep = (status: "done" | "failed", detail: string) =>
    getDb()
      .insert(ticketActions)
      .values({ runId, ticket, idx, type: action.type, label: action.label, action: JSON.stringify(action), status, detail: detail.slice(0, 1000), at: new Date().toISOString() })
      .run();
  // Your own card or row (KB-…, WS-…): a move to the column / status named; a comment as a note on it.
  if (isOwnKey(ticket)) {
    try {
      const { itemAction } = await import("@/lib/items");
      const detail = itemAction(ticket, action);
      keep("done", detail);
      return { action, detail };
    } catch (e) {
      keep("failed", errorMessage(e));
      throw e;
    }
  }
  const cfg = getJiraSyncConfig();
  if (!cfg.configured || !cfg.command) throw new ValidationError(t("Jira isn't set up — see the Jira tab."));

  try {
    const detail = await runStdioSession(
      { command: cfg.command, args: cfg.args, env: cfg.env, label: "Jira" },
      async (call) => {
        if (action.type === "transition") {
          const list = transitionsOf(resultToPayload(await call("jira_get_transitions", { issue_key: ticket })));
          const want = norm(action.to);
          const hit = list.find((x) => norm(x.name) === want || norm(x.to) === want) ?? list.find((x) => !!want && (norm(x.name).includes(want) || norm(x.to).includes(want)));
          if (!hit) throw new Error(t("No transition “{to}” from here — possible: {list}.", { to: action.to, list: list.map((x) => x.name).join(", ") || t("none") }));
          await call("jira_transition_issue", { issue_key: ticket, transition_id: hit.id });
          return `→ ${hit.to ?? hit.name}`;
        }
        if (action.type === "assign") {
          await call("jira_update_issue", { issue_key: ticket, fields: JSON.stringify({ assignee: action.assignee }) });
          return t("assigned: {assignee}", { assignee: action.assignee });
        }
        await call("jira_add_comment", { issue_key: ticket, body: action.comment });
        return t("Comment posted");
      },
      90000,
    );
    keep("done", detail);
    return { action, detail };
  } catch (e) {
    keep("failed", errorMessage(e));
    throw e;
  }
}
