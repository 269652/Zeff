import { ApiError, int, str, TICKET, type ApiContribution } from "@/lib/plugins/api-kit";
import { t } from "@/lib/i18n/server";

/**
 * Work's part of the plugin API (docs/plugins/api.md): runs, their logs, sessions. The code that does
 * the work is loaded when a method runs, so this file costs nothing at start.
 */

/** A run as plugins see it. */
async function runInfo(id: number, full = false) {
  const { getRun, toRunView } = await import("@/lib/work/store");
  const raw = getRun(id);
  if (!raw) throw new ApiError("not_found", `No run ${id}.`);
  const r = toRunView(raw);
  const { runBrief } = await import("@/lib/ext/work");
  return { ...runBrief(r), ...(full ? { result: r.result, repo: r.repo, cwd: r.cwd, base: r.base, sessionId: r.sessionId, turns: r.turns, gitSummary: r.gitSummary } : {}) };
}

export const WORK_API: ApiContribution = {
  events: {
    "work.run.started": { description: "A Work run started working" },
    "work.run.finished": { description: "A Work run ended (done, failed, stopped or interrupted)" },
    "work.changed": { description: "Something in Work changed (no details; at most every half second)", topic: "work" },
  },
  permissions: () => ({
    "work.read": t("Read Work sessions, their logs and results"),
    "work.write": t("Start, continue and stop Work sessions"),
  }),
  methods: {
    "work.runs.list": {
      perm: "work.read",
      summary: "Recent runs, newest first (limit, status, ticket, todoId).",
      run: async (p) => {
        const { recentRuns } = await import("@/lib/work/store");
        const limit = int(p, "limit", { min: 1, max: 200 }) ?? 50;
        const status = str(p, "status", { max: 20 });
        const ticket = str(p, "ticket", { max: 40 }).toUpperCase();
        const todoId = int(p, "todoId");
        const { runBrief } = await import("@/lib/ext/work");
        return recentRuns(200)
          .filter((r) => (!status || r.status === status) && (!ticket || r.ticket === ticket) && (todoId === undefined || r.todoId === todoId))
          .slice(0, limit)
          .map(runBrief);
      },
    },
    "work.runs.get": { perm: "work.read", summary: "One run with its result, repo and turns.", run: (p) => runInfo(int(p, "id", { required: true, min: 1 })!, true) },
    "work.runs.log": {
      perm: "work.read",
      summary: "A run's conversation, up to 500 lines from `from`.",
      run: async (p) => {
        const id = int(p, "id", { required: true, min: 1 })!;
        const run = await runInfo(id);
        const { readLog } = await import("@/lib/work/log");
        const from = int(p, "from") ?? 0;
        const all = readLog(id).lines;
        return { status: run.status, lines: all.slice(from, from + 500), next: Math.min(all.length, from + 500) };
      },
    },
    "work.sessions.start": {
      perm: "work.write",
      summary: "A new todo and a worker on it, like the message box.",
      run: async (p) => {
        const instruction = str(p, "instruction", { required: true });
        const ticket = str(p, "ticket", { max: 40 });
        if (ticket && !TICKET.test(ticket)) throw new ApiError("bad_request", "ticket: a ticket key like ABC-123");
        const { startSessionAction } = await import("./server-actions");
        const r = await startSessionAction({ instruction, ticket, repoId: int(p, "repoId"), provider: str(p, "provider", { max: 20 }) || undefined });
        if (!r.ok) throw new ApiError("failed", r.error);
        return { runId: r.runId };
      },
    },
    "work.sessions.send": {
      perm: "work.write",
      summary: "Go on with a run's conversation (queued while the worker still answers).",
      run: async (p) => {
        const { startSessionAction } = await import("./server-actions");
        const r = await startSessionAction({ instruction: str(p, "message", { required: true }), continueRunId: int(p, "runId", { required: true, min: 1 }) });
        if (!r.ok) throw new ApiError("failed", r.error);
        return { runId: r.runId };
      },
    },
    "work.runs.cancel": {
      perm: "work.write",
      summary: "Stop a run.",
      run: async (p) => {
        const { cancelRun } = await import("@/lib/work/runner");
        try {
          cancelRun(int(p, "id", { required: true, min: 1 })!);
        } catch (e) {
          throw new ApiError("failed", e instanceof Error ? e.message : String(e));
        }
        return true;
      },
    },
  },
};
