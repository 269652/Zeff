import { getDb, schema } from "@/db";
import { runStdioSession, resultToPayload, type McpStdioConfig } from "./mcp-client";
import { assignTicketBoards, setBoardMemberCount, upsertBoards, type BoardInput } from "./store";
import { getJiraSyncConfig } from "./sync";

const { jiraTickets } = schema;

export type BoardSyncResult = { projects: number; boards: number; mappedTickets: number };

const KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

/** Group active-scope ticket keys by their project prefix (PROJ-241 -> PROJ). */
function ticketKeysByProject(): Map<string, string[]> {
  const rows = getDb().select({ key: jiraTickets.key }).from(jiraTickets).all();
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const key = r.key.toUpperCase();
    if (!KEY_RE.test(key)) continue;
    const proj = key.split("-")[0];
    const list = map.get(proj) ?? [];
    list.push(key);
    map.set(proj, list);
  }
  return map;
}

function asArray(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Discover the Jira Agile boards for every project the synced tickets belong to,
 * and record which board each ticket is on — all over ONE MCP session (no LLM).
 * Board->job mappings set on the Jira tab are preserved. A ticket that appears on
 * more than one board keeps the first (by project, then board order).
 */
export async function syncBoardsFromJira(): Promise<BoardSyncResult> {
  const cfg = getJiraSyncConfig();
  if (!cfg.configured || !cfg.command) {
    throw new Error("Jira MCP sync is not configured. Set it up on the Jira tab first (same server as ticket sync).");
  }
  const byProject = ticketKeysByProject();
  if (byProject.size === 0) throw new Error("No synced tickets yet — sync tickets first, then sync boards.");

  const config: McpStdioConfig = { command: cfg.command, args: cfg.args, env: cfg.env };

  const { boards, counts, owner, considered } = await runStdioSession(
    config,
    async (call) => {
      const boards: BoardInput[] = [];
      const counts = new Map<number, number>();
      const owner = new Map<string, number>(); // ticket key (upper) -> boardId (first wins)
      const considered: string[] = [];

      for (const [proj, keys] of byProject) {
        considered.push(...keys);
        let boardList: unknown[] = [];
        try {
          boardList = asArray(resultToPayload(await call("jira_get_agile_boards", { project_key: proj })), ["values", "boards"]);
        } catch {
          continue; // project without boards / no access
        }
        for (const raw of boardList) {
          if (!raw || typeof raw !== "object") continue;
          const b = raw as Record<string, unknown>;
          const id = Number(b.id);
          if (!Number.isFinite(id)) continue;
          boards.push({
            id,
            name: typeof b.name === "string" ? b.name : String(id),
            type: typeof b.type === "string" ? b.type : null,
            projectKey: proj,
          });
          const members = new Set<string>();
          for (const part of chunk(keys, 50)) {
            const jql = `key in (${part.join(",")})`;
            try {
              const ip = resultToPayload(await call("jira_get_board_issues", { board_id: String(id), jql, fields: "key", limit: 50 }));
              for (const raw2 of asArray(ip, ["issues"])) {
                const k = (raw2 as Record<string, unknown>)?.key;
                if (typeof k === "string") members.add(k.toUpperCase());
              }
            } catch {
              // skip this board's membership on error
            }
          }
          counts.set(id, members.size);
          for (const k of members) if (!owner.has(k)) owner.set(k, id);
        }
      }
      return { boards, counts, owner, considered };
    },
    180000,
  );

  upsertBoards(boards);
  for (const b of boards) setBoardMemberCount(b.id, counts.get(b.id) ?? 0);
  const assignments = [...owner.entries()].map(([key, boardId]) => ({ key, boardId }));
  assignTicketBoards(considered, assignments);

  return { projects: byProject.size, boards: boards.length, mappedTickets: assignments.length };
}
