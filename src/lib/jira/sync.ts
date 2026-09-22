import fs from "node:fs";
import path from "node:path";
import { callStdioTool, resultToPayload, type McpStdioConfig } from "./mcp-client";
import { extractIssues, normalizeIssue, type NormalizedTicket } from "./normalize";
import { upsertTickets, type UpsertResult } from "./store";

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

const DEFAULT_FIELDS = "summary,status,created,updated,resolutiondate,issuetype,priority,assignee";

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

export type SyncResult = UpsertResult & { fetched: number };

/**
 * Sync assigned tickets by calling the configured Jira MCP server directly
 * (no LLM), then upserting them. Tickets no longer returned are marked inactive.
 */
export async function syncFromJira(): Promise<SyncResult> {
  const cfg = getJiraSyncConfig();
  if (!cfg.configured || !cfg.command) {
    throw new Error(
      "Jira MCP sync is not configured. Set JIRA_MCP_COMMAND (and optionally JIRA_MCP_ARGS/JIRA_MCP_ENV/JIRA_JQL) in .env.local, or use Paste import.",
    );
  }
  const config: McpStdioConfig = { command: cfg.command, args: cfg.args, env: cfg.env };
  // mcp-atlassian cold-starts in ~30s (Python env + Jira connect), so allow generous time.
  const result = await callStdioTool(config, cfg.tool, { jql: cfg.jql, limit: cfg.limit, fields: cfg.fields }, 150000);
  const payload = resultToPayload(result);
  const issues = extractIssues(payload);
  const tickets = issues
    .map((i) => normalizeIssue(i, cfg.baseUrl))
    .filter((t): t is NormalizedTicket => t !== null);
  if (tickets.length === 0) {
    throw new Error(
      `The Jira MCP tool "${cfg.tool}" returned no recognizable issues (fetched ${issues.length} raw items). Check JIRA_MCP_TOOL / JIRA_JQL.`,
    );
  }
  const upserted = upsertTickets(tickets, { markMissingInactive: true });
  return { ...upserted, fetched: issues.length };
}

/** Import tickets from pasted JSON (an array of issues or an object with issues/results). */
export function importPastedTickets(text: string, baseUrl?: string): SyncResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON.");
  }
  const issues = extractIssues(json);
  const tickets = issues
    .map((i) => normalizeIssue(i, baseUrl ?? getJiraSyncConfig().baseUrl))
    .filter((t): t is NormalizedTicket => t !== null);
  if (tickets.length === 0) {
    throw new Error("No recognizable Jira issues found (need objects with a key like PROJ-80).");
  }
  const upserted = upsertTickets(tickets);
  return { ...upserted, fetched: issues.length };
}
