import fs from "node:fs";
import path from "node:path";
import { t } from "@/lib/i18n/server";
import { resultToPayload, runStdioSession, type McpStdioConfig } from "./mcp-client";
import { extractIssues, normalizeIssue, type NormalizedTicket } from "./normalize";
import {
  assignTicketBoards,
  bookedTicketKeysMissingTitle,
  enabledBoardIds,
  insertTitleOnlyTickets,
  setTicketsMine,
  upsertTickets,
  type UpsertResult,
} from "./store";

export type JiraSyncConfig = {
  configured: boolean;
  /** Where the server config came from. */
  source: "env" | "mcp.json" | "none";
  command?: string;
  args: string[];
  env: Record<string, string>;
  tool: string;
  jql: string;
  fields: string;
  limit: number;
  baseUrl?: string;
};

const DEFAULT_FIELDS = "summary,description,status,created,updated,resolutiondate,issuetype,priority,assignee";

/** Parse a dotenv-style file into a plain object (used for the MCP server's envFile). */
function loadEnvFile(file: string): Record<string, string> {
  try {
    const txt = fs.readFileSync(file, "utf8");
    const env: Record<string, string> = {};
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith("#")) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
    return env;
  } catch {
    return {};
  }
}

/** Read a stdio Jira server from the project .mcp.json (jira / mcp-atlassian / atlassian). */
function configFromMcpJson(): { command: string; args: string[]; env: Record<string, string> } | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".mcp.json"), "utf8");
    const j = JSON.parse(raw) as { mcpServers?: Record<string, Record<string, unknown>> };
    const servers = j.mcpServers ?? {};
    const entry = servers.jira ?? servers["mcp-atlassian"] ?? servers.atlassian;
    const command = entry && typeof entry.command === "string" ? entry.command.trim() : "";
    if (!command || command === "\\") return null; // ignore the broken placeholder
    const env: Record<string, string> = { ...((entry!.env as Record<string, string>) ?? {}) };
    if (typeof entry!.envFile === "string") {
      Object.assign(env, loadEnvFile((entry!.envFile as string).replace("${workspaceFolder}", process.cwd())));
    }
    return { command, args: Array.isArray(entry!.args) ? (entry!.args as unknown[]).map(String) : [], env };
  } catch {
    return null;
  }
}

function parseArgs(raw?: string): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.map(String);
    } catch {
      // fall through to whitespace split
    }
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

function parseEnv(raw?: string): Record<string, string> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === "object") {
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
    }
  } catch {
    // ignore
  }
  return {};
}

/**
 * Resolve the Jira MCP server config: an explicit JIRA_MCP_COMMAND in the
 * environment wins; otherwise the project .mcp.json (jira / mcp-atlassian) entry
 * is used, loading its envFile so credentials come from the same place the MCP
 * server uses.
 */
export function getJiraSyncConfig(): JiraSyncConfig {
  const tool = process.env.JIRA_MCP_TOOL?.trim() || "jira_search";
  const jql = process.env.JIRA_JQL?.trim() || "assignee = currentUser() ORDER BY updated DESC";
  const fields = process.env.JIRA_FIELDS?.trim() || DEFAULT_FIELDS;
  const limit = Number(process.env.JIRA_MCP_LIMIT) > 0 ? Number(process.env.JIRA_MCP_LIMIT) : 100;

  const envCommand = process.env.JIRA_MCP_COMMAND?.trim();
  if (envCommand) {
    const env = parseEnv(process.env.JIRA_MCP_ENV);
    return {
      configured: true,
      source: "env",
      command: envCommand,
      args: parseArgs(process.env.JIRA_MCP_ARGS),
      env,
      tool,
      jql,
      fields,
      limit,
      baseUrl: process.env.JIRA_BASE_URL?.trim() || env.JIRA_URL || undefined,
    };
  }

  const fromJson = configFromMcpJson();
  if (fromJson) {
    return {
      configured: true,
      source: "mcp.json",
      command: fromJson.command,
      args: fromJson.args,
      env: fromJson.env,
      tool,
      jql,
      fields,
      limit,
      baseUrl: process.env.JIRA_BASE_URL?.trim() || fromJson.env.JIRA_URL || undefined,
    };
  }

  return { configured: false, source: "none", args: [], env: {}, tool, jql, fields, limit, baseUrl: process.env.JIRA_BASE_URL?.trim() || undefined };
}

export type SyncResult = UpsertResult & { fetched: number; titlesAdded: number; boardTickets: number; mine: number; /** Boards not read to the end (nothing deactivated then). */ unreadBoards?: number };

/**
 * Sync tickets by calling the configured Jira MCP server directly (no LLM):
 *   1. tickets assigned to the current user (any board), and
 *   2. ALL issues on every ENABLED board (any assignee),
 * merged and upserted in one session. Each ticket is flagged `mine` (assigned to
 * you) vs. a teammate's, and mapped to its board. Tickets no longer returned are
 * marked inactive. It also fetches titles for tickets booked in Zeff that aren't
 * in either set, so their {ticket-name} shows in the report.
 */
export async function syncFromJira(): Promise<SyncResult> {
  const { clearAttention, raiseLogin } = await import("@/lib/attention");
  try {
    const r = await readFromJira();
    clearAttention("login:jira");
    return r;
  } catch (e) {
    // Jira turned the token away: you're asked to sign in (or renew the token) — not Zeff.
    const message = e instanceof Error ? e.message : String(e);
    if (/\b40[13]\b|unauthori[sz]ed|forbidden|not authenticated/i.test(message)) raiseLogin("jira", message);
    throw e;
  }
}

async function readFromJira(): Promise<SyncResult> {
  const cfg = getJiraSyncConfig();
  if (!cfg.configured || !cfg.command) {
    throw new Error(
      t("Jira MCP sync is not configured. Set JIRA_MCP_COMMAND (and optionally JIRA_MCP_ARGS/JIRA_MCP_ENV/JIRA_JQL) in .env.local, or use Paste import."),
    );
  }
  const config: McpStdioConfig = { command: cfg.command, args: cfg.args, env: cfg.env, label: "Jira MCP" };
  const normalize = (issues: unknown[]) =>
    issues.map((i) => normalizeIssue(i, cfg.baseUrl)).filter((x): x is NormalizedTicket => x !== null);

  // mcp-atlassian cold-starts in ~30s; do every fetch over ONE session.
  return runStdioSession(
    config,
    async (call) => {
      // 1. My assigned tickets (expand=changelog brings history for time-to-respond).
      const myRaw = extractIssues(resultToPayload(await call(cfg.tool, { jql: cfg.jql, limit: cfg.limit, fields: cfg.fields, expand: "changelog" })));
      const myTickets = normalize(myRaw);
      const myKeys = myTickets.map((x) => x.key);

      // 2. All issues on each enabled board (any assignee). First enabled board wins per ticket.
      //    jira_get_board_issues caps `limit` at 50 and requires `jql`; page with `start_at`.
      const BOARD_PAGE = 50;
      const BOARD_MAX = 500; // most-recently-updated per board, to bound huge boards
      const boardIds = enabledBoardIds();
      const members: { key: string; boardId: number }[] = [];
      const seen = new Set<string>();
      const boardTickets: NormalizedTicket[] = [];
      // Boards not read to the end (a timeout, an error): their tickets aren't known — nothing is
      // deactivated then (a tick of bad luck would otherwise drop a whole board's tickets).
      const unread: number[] = [];
      for (const boardId of boardIds) {
        for (let startAt = 0; startAt < BOARD_MAX; startAt += BOARD_PAGE) {
          let payload: unknown;
          try {
            payload = resultToPayload(
              await call("jira_get_board_issues", { board_id: String(boardId), jql: "ORDER BY updated DESC", fields: cfg.fields, limit: BOARD_PAGE, start_at: startAt }),
            );
          } catch {
            unread.push(boardId);
            break; // can't read this board/page — stop paging it (its tickets just aren't refreshed)
          }
          const raw = extractIssues(payload);
          if (raw.length === 0) break;
          for (const x of normalize(raw)) {
            boardTickets.push(x);
            if (!seen.has(x.key)) { seen.add(x.key); members.push({ key: x.key, boardId }); }
          }
          const total = Number((payload as { total?: unknown })?.total ?? 0);
          if (raw.length < BOARD_PAGE || (total > 0 && startAt + BOARD_PAGE >= total)) break;
        }
      }

      if (myTickets.length === 0 && boardTickets.length === 0) {
        throw new Error(
          t("The Jira MCP tool \"{tool}\" / jira_get_board_issues returned no recognizable issues. Check the config on the Jira tab.", { tool: cfg.tool }),
        );
      }

      // 3. Merge (my tickets win for shared keys — they carry the changelog), upsert, deactivate the rest.
      const byKey = new Map<string, NormalizedTicket>();
      for (const x of boardTickets) byKey.set(x.key, x);
      for (const x of myTickets) byKey.set(x.key, x);
      const all = [...byKey.values()];
      const upserted = upsertTickets(all, { markMissingInactive: unread.length === 0 });

      // 4. Board membership + mine flags across everything we just synced.
      const unionKeys = all.map((x) => x.key);
      assignTicketBoards(unionKeys, members);
      setTicketsMine(myKeys, unionKeys);

      // 5. Titles for tickets booked in Zeff but not in either set above.
      const missing = bookedTicketKeysMissingTitle();
      let titlesAdded = 0;
      for (let i = 0; i < missing.length; i += 50) {
        const chunk = missing.slice(i, i + 50);
        try {
          const p2 = resultToPayload(await call(cfg.tool, { jql: `key in (${chunk.join(",")})`, limit: chunk.length, fields: cfg.fields }));
          titlesAdded += insertTitleOnlyTickets(normalize(extractIssues(p2)));
        } catch {
          // ignore title-fetch failures (e.g. tickets the user can't view)
        }
      }
      return { ...upserted, fetched: myRaw.length + boardTickets.length, titlesAdded, boardTickets: boardTickets.length, mine: myKeys.length, unreadBoards: unread.length };
    },
    180000,
  );
}

/** Import tickets from pasted JSON (an array of issues or an object with issues/results). */
export function importPastedTickets(text: string, baseUrl?: string): SyncResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(t("That is not valid JSON."));
  }
  const issues = extractIssues(json);
  const tickets = issues
    .map((i) => normalizeIssue(i, baseUrl ?? getJiraSyncConfig().baseUrl))
    .filter((x): x is NormalizedTicket => x !== null);
  if (tickets.length === 0) {
    throw new Error(t("No recognizable Jira issues found (need objects with a key like PROJ-80)."));
  }
  const upserted = upsertTickets(tickets);
  return { ...upserted, fetched: issues.length, titlesAdded: 0, boardTickets: 0, mine: 0 };
}
