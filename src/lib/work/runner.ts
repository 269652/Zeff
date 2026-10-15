import { llmChoice, llmPreamble } from "@/plugins/llm/run";
import { isInstalled } from "@/plugins/state";
import { providerAvailable } from "@/plugins/state";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { currentAccountId, withAccount } from "@/db/accounts";
import { sendToHost, spawnOnHost, workHostUp } from "./host";
import { announceRun, extWorkerRules } from "@/lib/ext/work";
import { workerMcpServers } from "./mcp";
import { aiChoice, defaultModelOf, getAppSettings } from "@/lib/ai";
import { findClaudeCli } from "@/plugins/claude-cli/cli";
import { COPILOT_MAX_PROMPT, findCopilotCli, runCopilot } from "@/plugins/copilot-cli/cli";
import { isAiProvider, type AiProvider } from "@/lib/ai/shared";
import { asksForApproval, opsSettle, todoRef } from "@/lib/boards/shared";
import type { TodoOp, TodoView } from "@/lib/boards/shared";
import { linkBranchContext, linkedBranchesOf } from "./branch-context";
import { newBranchName } from "./branch-name";
import { addFollowUp, addTestedDelivery, addTodoInstruction, getTodo, handOverPlan, setTodoOps } from "@/lib/boards/store";
import { commentOnMr, openGitlabMr, postGitlabReply } from "@/lib/gitlab/reply";
import { runTodoOps } from "@/lib/ops";
import { gitlabItemsByKeys, listGitlabItems } from "@/lib/gitlab/store";
import type { WorkRun } from "@/db/schema";
import { errorMessage, NotFoundError, ValidationError } from "@/lib/errors";
import { gitFailure } from "@/lib/git";
import { t } from "@/lib/i18n/server";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { endSideWork } from "./actions";
import { attachmentsDir, attachmentsNote, attachmentsPrompt } from "./attachments";
import { briefFor, taskFor, workerRules } from "./brief";
import { listRepos, repoForTicket } from "@/lib/repos";
import { addBranchWorktree, addWorktree, baseFor, git, gitSummary, repoRoot, switchBranch } from "./git";
import { startInteractive } from "@/plugins/copilot-cli/interactive";
import { readSessionOpts, saveSessionOpts } from "@/plugins/claude-cli/live";
import { liveDriverFor, liveDriverOf, liveDrivers, liveIdle } from "./live-driver";
import { errPath, lastJson, logPath, readErrors, readLog, readOutput, workDir } from "./log";
import { applyOutcome, normalizeResult } from "./outcome";
import { claudeSessionSettings, createRun, getRun, getWorkSettings, runsByStatus, toRunView, updateRun } from "./store";
import { parseMrTarget, WORK_RESULT_SCHEMA, workModeOf, workRef, type SessionOptions, type WorkResult, type WorkRunView } from "./shared";

/** Zeff's own booking tools — a worker never books: Zeff books its runs (Weekly report). (complete_todo is allowed: it only marks a todo "done by the worker".) */
const ZEFF_TOOLS = ["report_time", "update_time_entry", "delete_time_entry", "create_job"].map((tool) => `mcp__zeff__${tool}`);
/** The Jira tools a send run may use, from Zeff's own Jira connection (server "zeff-jira"). */
const JIRA_SEND_TOOLS = ["jira_add_comment", "jira_get_transitions", "jira_transition_issue", "jira_update_issue", "jira_get_issue"].map((tool) => `mcp__zeff-jira__${tool}`);

const now = () => new Date().toISOString();
/** The run's MCP config (Zeff's server, for a send run Jira too). */
const jiraConfigPath = (id: number) => path.join(workDir(), `jira-mcp-${id}.json`);

/**
 * The environment a worker gets: Zeff's, without what belongs to Zeff's own server — a nested
 * Claude Code session's markers, NODE_ENV=production (npm would skip devDependencies), Next's
 * and npm's variables, Zeff's settings.
 */
export function workerEnv(runId: number, viaHost = false): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|NODE_ENV|PORT|HOSTNAME|DATABASE_PATH|NODE_OPTIONS)$/i.test(k)) continue;
    if (/^(NEXT_|__NEXT|npm_|ZEFF_|TURBOPACK)/i.test(k)) continue;
    env[k] = v;
  }
  // Which run this is: `npm run deploy` doesn't wait for its own session — and needs it off this server's process tree.
  env.ZEFF_WORK_RUN = String(runId);
  env.ZEFF_WORK_ACCOUNT = currentAccountId();
  if (viaHost) env.ZEFF_WORK_VIA_HOST = "1";
  return env;
}

/** A worker's process: on the work host if it's up, else a child of this server. Resolves with its pid. */
async function launchWorker(id: number, w: { command: string; args: string[]; cwd: string; stdin: string; /** A Claude run that takes more messages while it works (needs the host). */ live?: boolean }): Promise<number> {
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(logPath(id)), { recursive: true });
  const { live, ...proc } = w;
  if (await workHostUp()) {
    // Live: the prompt and later messages as stream-json lines on stdin, which the host keeps open while the CLI works.
    const args = live ? [...proc.args, "--input-format", "stream-json", "--replay-user-messages"] : proc.args;
    return spawnOnHost({ runId: id, account: currentAccountId(), ...proc, args, live, env: workerEnv(id, true), outFile: logPath(id), errFile: errPath(id) });
  }
  const out = fs.openSync(/*turbopackIgnore: true*/ logPath(id), "a");
  const err = fs.openSync(/*turbopackIgnore: true*/ errPath(id), "a");
  const account = currentAccountId();
  // (Not detached on Windows — see scripts/work-host.mjs: no console means a window per console program the worker starts.)
  const child = spawn(/*turbopackIgnore: true*/ w.command, w.args, { cwd: w.cwd, env: workerEnv(id) as NodeJS.ProcessEnv, stdio: ["pipe", out, err], windowsHide: true, detached: process.platform !== "win32" });
  fs.closeSync(out);
  fs.closeSync(err);
  child.on("error", (e) => {
    fs.appendFileSync(/*turbopackIgnore: true*/ errPath(id), `${e.message}
`);
    void withAccount(account, () => finalize(id));
  });
  child.on("exit", () => void withAccount(account, () => finalize(id)));
  child.stdin?.on("error", () => {}); // a CLI that quits early: its exit says why
  child.stdin?.end(w.stdin, "utf8");
  child.unref();
  return child.pid ?? 0;
}

/** A process still there? */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The process and everything it started (tests, servers) — gone. */
function killTree(pid: number): void {
  if (process.platform === "win32") execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
  else
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // already gone
    }
}

/**
 * Hand a todo to a worker: what it does follows from the todo (do the work, write the message,
 * send it — see workModeOf), with the provider given or the one from the AI settings. Queued;
 * it starts as soon as a worker is free.
 */
export function dispatchTodo(
  todoId: number,
  opts: {
    provider?: AiProvider;
    instruction?: string;
    /** A session in this repo (Repos page), whatever the ticket says. */
    repoId?: number;
    /** Your next message in this run's conversation: Claude goes on with its session (where it worked), like Claude Code. */
    continueRun?: number;
    /** A folder in a git repo to work in (any folder, not only a registered repo) - its repo is used. */
    repoPath?: string;
    /** The branch to start from / work on (see workspace); none: the ticket's own branch, else the default. */
    branch?: string;
    /** worktree: a new branch from `branch` in a worktree · branch: `branch` itself in a worktree · checkout: in the repo itself. None: the Code settings. */
    workspace?: "worktree" | "branch" | "checkout";
    /** Started by you to talk to (the composer): it waits for you after each turn — else a task that ends with its result. */
    conversation?: boolean;
    /** The composer's choices: mode, model, effort, as administrator. */
    session?: SessionOptions;
    /** Pictures and documents sent with it: files for the CLI to read. */
    attachments?: { name: string; path: string }[];
  } = {},
): WorkRunView {
  if (!isInstalled("work")) throw new ValidationError(t("Code is not installed (Menu → Plugins) — without it no worker works on todos."));
  const todo = getTodo(todoId);
  if (!todo) throw new NotFoundError(t("Todo {ref} not found.", { ref: todoRef(todoId) }));
  // Your instruction: an AI run on the todo that does what you say (whatever the todo's own mode).
  const files = opts.attachments ?? [];
  // What the worker is told (with where the files are) and what shows as your words (with their names).
  const instruction = opts.instruction?.trim() ? `${opts.instruction.trim()}${attachmentsPrompt(files)}` : undefined;
  const shown = opts.instruction?.trim() ? `${opts.instruction.trim()}${attachmentsNote(files)}` : "";
  const prev = opts.continueRun ? getRun(opts.continueRun) : undefined;
  if (opts.continueRun && (!prev || prev.todoId !== todoId)) {
    throw new ValidationError(t("{run} isn't a session on {ref}.", { run: workRef(opts.continueRun), ref: todoRef(todoId) }));
  }
  if (prev && !instruction) throw new ValidationError(t("What's your next message?"));
  // Messages sent while the worker is busy are collected: one waiting for the run before it takes the next ones too, and they all go at once.
  if (prev && instruction && prev.status === "queued" && prev.afterRun) {
    const merged = updateRun(prev.id, { prompt: `${prev.prompt}\n\n## Weitere Nachricht des Nutzers (danach geschickt)\n${instruction}` });
    addTodoInstruction(todoId, shown, prev.id);
    return toRunView(merged ?? prev);
  }
  // A conversation goes on whatever became of its todo; a new instruction needs an open one.
  if (instruction && !prev && todo.status !== "open") throw new ValidationError(t("{ref} is {status} already.", { ref: todoRef(todoId), status: todo.status }));
  const m: ReturnType<typeof workModeOf> = instruction ? { mode: "instruct" } : workModeOf(todo, t);
  if (!m.mode) throw new ValidationError(m.why);
  // (An instruction from the todo's own operations — Zeff running them right now — goes ahead.)
  // (Your next message in a session may come while its worker still works: it waits for that run — see `afterRun`.)
  const active = prev ? undefined : runsByStatus(["queued", "running"]).find((r) => r.todoId === todoId && !(opts.instruction && r.provider === "zeff"));
  if (active) throw new ValidationError(t("{ref} is with {run} already.", { ref: todoRef(todoId), run: workRef(active.id) }));
  const s = getWorkSettings();
  // A GitLab reply Zeff posts itself; a Jira one goes through Claude (with Zeff's Jira connection).
  const byZeff = !instruction && ((m.mode === "send" && todo.channel === "gitlab") || m.mode === "mr" || m.mode === "ops");
  // A worker is the LLM plugin's "worker" task: its backend (or the default).
  // (Going on with a session: its provider, unless you pick another.)
  const prevProvider = prev && isAiProvider(prev.provider) ? prev.provider : undefined;
  const provider: AiProvider | "zeff" = byZeff ? "zeff" : (opts.provider ?? prevProvider ?? llmChoice("worker").provider);
  if (provider !== "zeff" && !isInstalled("llm")) throw new ValidationError(t("The LLM plugin is not installed (Menu → Plugins) — no workers."));
  if (provider !== "zeff" && !providerAvailable(provider)) {
    throw new ValidationError(t("{cli}: not installed (Menu → Plugins).", { cli: provider === "claude" ? "Claude CLI" : provider === "codex" ? "Codex CLI" : "Copilot CLI" }));
  }
  if (m.mode === "send" && (provider === "copilot" || provider === "codex")) {
    throw new ValidationError(t("Only Claude can post to Jira (through Zeff's Jira connection) — install the Claude CLI plugin."));
  }
  const chosen = opts.repoPath?.trim() ? repoRoot(opts.repoPath.trim()) : null;
  if (opts.repoPath?.trim() && !chosen) throw new ValidationError(t("{path} isn't in a git repo.", { path: opts.repoPath }));
  const repo = (opts.repoId ? listRepos().find((r) => r.id === opts.repoId) : undefined) ?? repoForTicket(todo.ticket)?.repo;
  const repoDir = chosen ?? repo?.path ?? null;
  if (opts.branch && !repoDir) throw new ValidationError(t("A branch needs a repo."));
  if (m.mode === "code" && !repoDir) {
    throw new ValidationError(t("No repo for {ticket} — assign its board (or the ticket) to one on the Repos page.", { ticket: todo.ticket }));
  }
  const app = getAppSettings();
  // The Code tab's model is one of the Settings provider's; another provider gets its own Settings model.
  const own = provider === "zeff" ? "" : provider === llmChoice("worker").provider ? llmChoice("worker").model : defaultModelOf(provider, app);
  const so = opts.session ?? {};
  // (The Code settings' model is a Claude/Copilot one: ChatGPT gets its own default.)
  const model = so.model?.trim() || (provider !== "codex" && provider === aiChoice().provider ? s.model || own : own) || null;
  // Claude resumes its session — in the folder it ran in (Claude keeps sessions by folder), so it knows everything said and done.
  const waitFor = prev && (prev.status === "queued" || prev.status === "running") ? prev : undefined;
  // A live session (the Code settings): its mode — yours from the composer, else the settings' (yours or Zeff's own runs).
  const cs = claudeSessionSettings();
  const driver = provider === "zeff" ? undefined : liveDriverFor(provider);
  const live = !!driver && cs.live && m.mode !== "send";
  if (provider === "codex" && !live) {
    throw new ValidationError(t("ChatGPT workers need Live sessions — switch them on in the Code settings (Claude sessions)."));
  }
  const resume = prev && !waitFor && resumes(provider, prev) && fs.existsSync(/*turbopackIgnore: true*/ prev.cwd!) ? prev : undefined;
  const modes = driver?.modes({ allowBypass: cs.allowBypass }) ?? [];
  // (Claude's from the Code settings — yours or Zeff's own runs; another provider's: its first.)
  const liveMode = so.permissionMode ?? (provider === "claude" ? (opts.conversation || prev ? cs.mode : cs.autoMode) : (modes[0]?.id ?? ""));
  if (live && !modes.some((x) => x.id === liveMode)) {
    throw new ValidationError(liveMode === "bypassPermissions" ? t("Bypass isn't allowed — Code settings → Claude sessions.") : t("Unknown mode."));
  }
  if (so.elevated && provider !== "claude") throw new ValidationError(t("Only live Claude sessions run as administrator."));
  if (so.elevated && !live) throw new ValidationError(t("Only live Claude sessions run as administrator."));
  const run = createRun({
    ticket: todo.ticket,
    todoId,
    mode: m.mode,
    provider,
    model: resume || waitFor ? (opts.provider || so.model ? model : (prev!.model ?? model)) : model,
    permissionMode: live ? liveMode : provider === "claude" ? s.permissionMode : provider === "copilot" ? "allow-all-tools" : null,
    repo: resume ? resume.repo : (waitFor?.repo ?? repoDir),
    // (A conversation goes on where it worked; a new run starts where you chose.)
    ...(resume ? { workspace: resume.workspace } : { workspace: repoDir && (opts.workspace ?? null), ...(opts.branch ? { base: opts.branch } : {}) }),
    prompt: resume || waitFor
      ? `## Deine Anweisung (vom Nutzer — sie geht vor)\n${instruction}`
      : instruction
        ? `${briefFor(todo)}

## Deine Anweisung (vom Nutzer — sie geht vor)
${instruction}`
        : briefFor(todo),
    ...(resume ? { sessionId: resume.sessionId, cwd: resume.cwd, branch: resume.branch, base: resume.base, baseSha: resume.baseSha } : {}),
    ...(waitFor ? { afterRun: waitFor.id } : {}),
  });
  if (live) saveSessionOpts(run.id, { ...so, permissionMode: liveMode, conversation: !!opts.conversation });
  // Your instruction on the todo, as your words (context for the Lage, workers and agents too).
  if (instruction) addTodoInstruction(todoId, shown, run.id);
  pump();
  return toRunView(getRun(run.id)!);
}

/**
 * Start what's queued while workers are free (the settings' number) — oldest first. Working in
 * the checkout (not in worktrees), one code run per repo at a time.
 */
export function pump(): void {
  if (!isInstalled("work")) return;
  const s = getWorkSettings();
  // Agents outside Zeff (through its MCP) work on top of its own workers.
  // (A live session waiting for you doesn't hold a worker — like a Claude Code tab you left open.)
  const running = runsByStatus(["running"]).filter((r) => r.provider !== "agent" && !liveIdle(r.id));
  let free = s.parallel - running.length;
  if (free <= 0) return;
  const inPlace = (r: WorkRun) => (r.workspace ?? s.isolation) === "checkout";
  const busy = new Set(running.filter((r) => codeLike(r.mode) && inPlace(r)).map((r) => r.repo));
  for (const r of runsByStatus(["queued"])) {
    if (free <= 0) break;
    // A message sent while the run before it still worked waits for that run.
    if (r.afterRun) {
      const before = getRun(r.afterRun);
      if (before && (before.status === "queued" || before.status === "running")) continue;
    }
    if (inPlace(r) && codeLike(r.mode) && r.repo) {
      if (busy.has(r.repo)) continue;
      busy.add(r.repo);
    }
    free--;
    start(r.id);
  }
}

/**
 * A run this one can go on with: the same conversation (its folder is the caller's to check). Claude resumes
 * its session in any mode (--resume); another provider's only while sessions run live (its driver
 * resumes the thread).
 */
const resumes = (provider: string, from: Pick<WorkRun, "provider" | "sessionId" | "cwd">): boolean =>
  from.provider === provider &&
  !!from.sessionId &&
  !!from.cwd &&
  (provider === "claude" || (!!liveDriverFor(provider) && claudeSessionSettings().live));

/** A run that may change code (in the repo, its worktree): an implementation, or your instruction. */
const codeLike = (mode: string) => mode === "code" || mode === "instruct";

/** One run begins: where it works (a worktree of its own, the repo, or a scratch folder), its full prompt, its process. */
function start(id: number): void {
  let r = getRun(id);
  if (!r || r.status !== "queued") return;
  // Sent while the run before it worked: it goes on with that conversation, where it worked — or, if there's none to resume, from the todo's brief.
  if (r.afterRun) {
    const before = getRun(r.afterRun);
    const resumable = !!before && resumes(r.provider, before) && fs.existsSync(/*turbopackIgnore: true*/ before.cwd!);
    const todo = getTodo(r.todoId);
    r =
      updateRun(
        id,
        resumable
          ? { afterRun: null, sessionId: before.sessionId, cwd: before.cwd, branch: before.branch, base: before.base, baseSha: before.baseSha, repo: before.repo ?? r.repo }
          : { afterRun: null, prompt: todo ? `${briefFor(todo)}\n\n${r.prompt}` : r.prompt },
      ) ?? r;
  }
  const startedAt = now();
  updateRun(id, { status: "running", startedAt });
  announceRun(id, "work.run.started");
  try {
    const s = getWorkSettings();
    const todo = getTodo(r.todoId);
    if (!todo) throw new Error(t("{ref} doesn't exist any more.", { ref: todoRef(r.todoId) }));
    // Zeff's own runs (operations, GitLab replies, merge requests): no worktree, no CLI.
    if (r.provider === "zeff") {
      fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(logPath(id)), { recursive: true });
      updateRun(id, { cwd: null });
      void (r.mode === "mr" ? openMr(r, todo) : r.mode === "ops" ? runOps(r, todo) : postReply(r, todo));
      return;
    }
    const mode = r.mode === "draft" || r.mode === "send" || r.mode === "instruct" ? r.mode : "code";
    // Queued with a session: the next message in a conversation — Claude resumes it where it worked.
    const resume = resumes(r.provider, r);
    let cwd = path.join(workDir(), "scratch");
    let branch: string | null = null;
    let base: string | null = null;
    let baseSha: string | null = null;
    const so = readSessionOpts(id);
    if (resume) {
      ({ cwd, branch, base, baseSha } = { cwd: r.cwd!, branch: r.branch, base: r.base, baseSha: r.baseSha });
    } else if (codeLike(mode) && r.repo) {
      const where = r.workspace ?? s.isolation;
      if (where === "branch" && r.base) {
        // The existing branch itself, in a worktree of its own.
        base = r.base;
        ({ cwd, branch, baseSha } = addBranchWorktree(r.repo, r.base, id));
      } else if (where === "checkout") {
        cwd = r.repo;
        // A branch chosen for the checkout itself: switched to (nothing uncommitted may be lost).
        if (r.base) switchBranch(cwd, r.base);
        base = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
        baseSha = git(cwd, ["rev-parse", "HEAD"]);
      } else {
        base = r.base || baseFor(r.repo, r.ticket);
        ({ cwd, branch, baseSha } = addWorktree(r.repo, r.ticket, id, base));
      }
    } else if (mode === "draft" && r.repo) {
      cwd = r.repo; // to look things up — read only
    }
    fs.mkdirSync(/*turbopackIgnore: true*/ cwd, { recursive: true });
    // House rules: everyone's, then the repo's own.
    const repoRules = r.repo ? (listRepos().find((x) => x.path === r.repo)?.instructions ?? "") : "";
    // (Your instructions and context from the LLM plugin first — for every worker.)
    const rules = workerRules([llmPreamble(), s.instructions, repoRules, extWorkerRules()].filter((x) => x.trim()).join("\n\n"), { conversation: !!so?.conversation, live: !!so && !!liveDriverFor(r.provider) });
    // A conversation going on: just your words. A task: the brief, what to do, and its result as JSON at the end (a live Claude task — without --json-schema).
    const tail = `\n\nAntworte am Ende mit dem Ergebnis als JSON in einem \`\`\`json-Block, nach diesem JSON-Schema:\n${JSON.stringify(WORK_RESULT_SCHEMA)}`;
    const isolation = r.workspace === "checkout" || (!r.workspace && s.isolation === "checkout") ? "checkout" : "worktree";
    const task = taskFor(mode, {
      todo,
      runId: id,
      repo: r.repo,
      cwd,
      branch,
      base,
      isolation,
      onExisting: r.workspace === "branch" && !!branch,
      linked: linkedBranchesOf(todo),
      newBranch: newBranchName(todo),
    });
    const prompt = resume && so ? r.prompt : `${r.prompt}\n\n${task}${so && !so.conversation ? tail : ""}`;
    updateRun(id, { cwd, branch, base, baseSha, prompt });

    const driver = so ? liveDriverFor(r.provider) : undefined;
    if (so && driver) {
      const cs = claudeSessionSettings();
      // (Claude is handed its session's id; another CLI makes its own — the driver reports it.)
      const sessionId = resume ? r.sessionId! : driver.assignsSessionId ? randomUUID() : null;
      if (sessionId) updateRun(id, { sessionId });
      void driver
        .start({
          runId: id,
          conversation: !!so.conversation,
          elevated: !!so.elevated,
          effort: so.effort ?? cs.effort,
          model: r.model,
          mode: so.permissionMode ?? r.permissionMode ?? "",
          allowBypass: cs.allowBypass,
          askTimeoutMin: cs.askTimeoutMin,
          cwd,
          rules,
          prompt,
          name: `Zeff ${workRef(id)} · ${r.ticket || "session"}`,
          disallowedTools: [...ZEFF_TOOLS, ...(codeLike(mode) ? [] : ["Edit", "Write", "MultiEdit", "NotebookEdit"])],
          resumeSession: resume ? sessionId : null,
          newSessionId: resume ? null : sessionId,
        })
        .catch((e) => {
          fs.appendFileSync(/*turbopackIgnore: true*/ errPath(id), `${errorMessage(e)}\n`);
          void finalize(id);
        });
      return;
    }

    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(logPath(id)), { recursive: true });
    let command: string;
    let args: string[];
    let stdin: string | null = null;
    let sessionId: string | null = null;
    if (r.provider === "copilot") {
      const cli = findCopilotCli();
      if (!cli) throw new Error(t("The Copilot CLI wasn't found (npm install -g @github/copilot, or set COPILOT_CLI)."));
      const tail = `\n\nAntworte am Ende mit einem JSON-Objekt nach diesem JSON-Schema, in einem \`\`\`json-Block:\n${JSON.stringify(WORK_RESULT_SCHEMA)}`;
      // A live session (it asks you for permissions on the Code tab, you can write to it, switch it to autopilot).
      if (s.copilotMode !== "headless") {
        // The session writes its log itself (as it goes), not a process' output.
        updateRun(id, { permissionMode: s.copilotMode === "autopilot" ? "acp-autopilot" : "acp" });
        void startInteractive({
          runId: id,
          command: cli.command,
          args: [...cli.args, "--deny-tool", "shell(git push)", ...(r.model ? ["--model", r.model] : [])],
          cwd,
          env: workerEnv(id) as NodeJS.ProcessEnv,
          prompt: `${rules}\n\n${prompt}${tail}\n\nWenn dir etwas unklar ist, frag mich direkt — ich antworte hier.`,
          autopilot: s.copilotMode === "autopilot",
        })
          .then((pid) => updateRun(id, { pid }))
          .catch((e) => {
            fs.appendFileSync(/*turbopackIgnore: true*/ errPath(id), `${errorMessage(e)}\n`);
            void finalize(id);
          });
        return;
      }
      command = cli.command;
      // The prompt on stdin (no command-line length limit).
      args = [...cli.args, "--allow-all-tools", "--deny-tool", "shell(git push)", "--no-ask-user", ...(r.model ? ["--model", r.model] : [])];
      stdin = `${rules}\n\n${prompt}${tail}`;
    } else {
      const cli = findClaudeCli();
      if (!cli) throw new Error(t("The Claude CLI wasn't found — install Claude Code, or set CLAUDE_CLI."));
      sessionId = resume ? r.sessionId! : randomUUID();
      // CLAUDE_CLI may be a script (a stand-in): run with node.
      const script = /\.(c|m)?js$/i.test(cli);
      const disallowed = [...ZEFF_TOOLS, ...(codeLike(mode) ? [] : ["Edit", "Write", "MultiEdit", "NotebookEdit"]), ...(mode === "send" ? ["Bash", "PowerShell"] : [])];
      command = script ? process.execPath : cli;
      args = [
        ...(script ? [cli] : []),
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--json-schema",
        JSON.stringify(WORK_RESULT_SCHEMA),
        ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId, "--name", `Zeff ${workRef(id)} · ${r.ticket}`]),
        "--permission-mode",
        r.permissionMode || "auto",
        "--permission-prompts",
        "none",
        "--append-system-prompt",
        rules,
        "--disallowedTools",
        disallowed.join(","),
        // The pictures and documents you sent: outside the working folder, but for it to read.
        "--add-dir",
        attachmentsDir(),
      ];
      if (r.model) args.push("--model", r.model);
      // Zeff's MCP server of this run's account (the folder's .mcp.json would say the first account's), and for a send run the Jira connection.
      let extra: Record<string, unknown> = {};
      if (mode === "send") {
        const jira = getJiraSyncConfig();
        if (!jira.configured || !jira.command) {
          throw new Error(t("Zeff's Jira connection isn't set up (Jira tab) — nothing can be posted without it."));
        }
        extra = { "zeff-jira": { type: "stdio", command: jira.command, args: jira.args, env: jira.env } };
      }
      fs.writeFileSync(/*turbopackIgnore: true*/ jiraConfigPath(id), JSON.stringify(workerMcpServers(currentAccountId(), extra)), { mode: 0o600 });
      args.push("--mcp-config", jiraConfigPath(id), ...(mode === "send" ? ["--allowedTools", JIRA_SEND_TOOLS.join(",")] : []));
      stdin = prompt;
    }

    // Detached, its output straight into files: a run outlives a restart of Zeff's server — on the
    // work host (the launcher's, outside this server's process tree), else started here.
    void launchWorker(id, { command, args, cwd, stdin: stdin ?? "", live: r.provider === "claude" })
      .then((pid) => updateRun(id, { pid, sessionId }))
      .catch((e) => {
        fs.appendFileSync(/*turbopackIgnore: true*/ errPath(id), `${errorMessage(e)}
`);
        void finalize(id);
      });
  } catch (e) {
    updateRun(id, { status: "failed", error: errorMessage(e).slice(0, 2000), finishedAt: now(), durationMs: Date.now() - Date.parse(startedAt) });
    announceRun(id, "work.run.finished");
    setImmediate(pump);
  }
}

/**
 * Your message to a Claude session that is still working (like Claude Code): it goes to the CLI
 * through the work host and is taken in when the CLI is idle (or at its next step) - no new run.
 * Throws with the reason when it can't (not running, no host, the CLI is just finishing).
 */
export async function messageRunningSession(runId: number, text: string): Promise<void> {
  const r = getRun(runId);
  if (!r) throw new NotFoundError(`${workRef(runId)} not found.`);
  const message = text.trim();
  if (!message) throw new ValidationError("What's your message?");
  const driver = liveDriverOf(runId);
  if (r.status !== "running" || (r.provider !== "claude" && !driver)) throw new ValidationError(`${workRef(runId)} isn't a working session.`);
  if (driver?.view(runId)) await driver.send(runId, message, []);
  else if (!(await sendToHost(runId, message))) throw new ValidationError(`${workRef(runId)} can't take a message right now - it is just finishing (or the work host isn't running). Send it again in a moment.`);
  addTodoInstruction(r.todoId, message, runId);
}

/**
 * A drafted GitLab reply, posted by Zeff itself — into the thread of the comment it answers,
 * through the API (else the page) in the automation Chrome. Logged like a worker's run, its
 * result (the todo done) in the log's last lines.
 */
async function postReply(r: WorkRun, todo: TodoView): Promise<void> {
  const note = (msg: string) => fs.appendFileSync(/*turbopackIgnore: true*/ logPath(r.id), `${msg}\n`);
  try {
    // The comment answered: a real note id (in the target, else the todo's sources)…
    const key = [todo.target ?? "", ...todo.refs].map((x) => /note:(\d+)/.exec(x)?.[0]).find(Boolean);
    const item = key ? gitlabItemsByKeys([key]).get(key) : undefined;
    if (!item || item.kind !== "comment") {
      // …else a new comment on the merge request it's about (!n, its project from the ticket's repo or the synced merge requests).
      const iid = Number(/!(\d+)/.exec(`${todo.target ?? ""} ${todo.text} ${todo.draft ?? ""}`)?.[1]);
      const mrs = listGitlabItems({ kind: "mr", limit: 500 }).filter((x) => x.ref === `!${iid}`);
      const repoProject = repoForTicket(todo.ticket)?.repo.gitlabProject;
      const mr = mrs.find((x) => x.project === repoProject) ?? mrs.find((x) => new RegExp(`(^|[^A-Za-z0-9])${todo.ticket}(?![0-9])`, "i").test(`${x.title} ${x.branch ?? ""}`)) ?? (mrs.length === 1 ? mrs[0] : undefined);
      if (!iid || !mr) {
        const target = todo.target ?? t("no target");
        throw new Error(t("Which comment (or merge request) to answer isn't known ({target}) — sync GitLab, or post it yourself.", { target }));
      }
      note(`[Zeff] The comment isn't known — posting as a new comment in ${mr.ref} (${mr.project}).`);
      const c = await commentOnMr(mr.project, iid, todo.draft ?? "");
      note(`[Zeff] Posted: ${c.url}`);
      const result: WorkResult = { outcome: "done", summary: `Comment posted in ${mr.ref}: ${c.url}`, entry: `Kommentar in ${mr.ref} gepostet`, completedTodos: [todo.id], followUps: [] };
      note(`\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``);
      await finalize(r.id);
      return;
    }
    note(`[Zeff] Reply to ${item.ref} (${item.author ?? "?"}) — through GitLab's API from the automation Chrome, else through the page.`);
    const res = await postGitlabReply(item.url, todo.draft ?? "");
    note(res.via === "api" ? `[Zeff] Posted through the API: ${res.url}` : `[Zeff] The API didn't work (${res.apiFailed}) — posted through the page: ${res.url}`);
    const result: WorkResult = {
      outcome: "done",
      summary: `Reply posted in the thread of ${item.ref} (${res.via === "api" ? "API" : "through the page"}): ${res.url}`,
      entry: `Antwort in ${item.ref} gepostet`,
      completedTodos: [todo.id],
      followUps: [],
    };
    note(`\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``);
  } catch (e) {
    fs.appendFileSync(/*turbopackIgnore: true*/ errPath(r.id), `${errorMessage(e)}\n`);
  }
  await finalize(r.id);
}

/** A todo's operations, run by Zeff itself (no AI): done, the todo is; one failing, it stays open with the rest. */
async function runOps(r: WorkRun, todo: TodoView): Promise<void> {
  const note = (msg: string) => fs.appendFileSync(/*turbopackIgnore: true*/ logPath(r.id), `${msg}\n`);
  try {
    const { done, next } = await runTodoOps(todo, note);
    // What's next (the following delivery step) as a todo of its own.
    for (const n of next) {
      const f = addFollowUp({ ticket: todo.ticket, text: n.text, kind: "merge", parentId: todo.id, workRunId: r.id, source: `Follow-up from ${workRef(r.id)}`, ops: n.ops, owner: n.owner });
      handOverPlan(todo.id, f.id, ["merge", "review"]);
      note(`[Zeff] Up next: ${todoRef(f.id)} — ${n.text}${n.owner === "other" ? " (waiting for the approval)" : ""}`);
    }
    // Ticked off only when the operations are the todo (a reply, a comment, a delivery …) — a side
    // step of other work (the ticket moved while it's implemented) leaves it open.
    const settles = opsSettle(todo);
    if (!settles) note(`[Zeff] ${todoRef(todo.id)} stays open — the steps were only part of it.`);
    // Threads resolved, the approval still to ask for: that's the next click — a reply in the thread.
    const resolved = todo.ops.find((o): o is Extract<TodoOp, { type: "gitlab-resolve" }> => o.type === "gitlab-resolve");
    if (!settles && resolved && asksForApproval(todo.text) && !getTodo(todo.id)?.ops.length) {
      const pushed = [...todo.userNotes].reverse().find((n) => n.urlLabel)?.urlLabel;
      setTodoOps(todo.id, [
        {
          type: "gitlab-reply",
          note: resolved.note,
          body: `Die Review-Punkte sind umgesetzt${pushed ? ` und gepusht (${pushed})` : ""}, die Threads habe ich aufgelöst. Bitte noch einmal prüfen und den MR approven — danke!`,
        },
      ]);
      note(`[Zeff] Up next on ${todoRef(todo.id)}: asking for the approval as a reply in the thread — one click.`);
    }
    const result: WorkResult = {
      outcome: settles ? "done" : "partial",
      summary: done.map((d) => `- ${d}`).join("\n"),
      entry: done.join("; ").slice(0, 200),
      completedTodos: settles ? [todo.id] : [],
      followUps: [],
    };
    note(`\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``);
  } catch (e) {
    fs.appendFileSync(/*turbopackIgnore: true*/ errPath(r.id), `${errorMessage(e)}\n`);
  }
  await finalize(r.id);
}

/** A merge request for a pushed branch, opened by Zeff itself — through GitLab's API in the automation Chrome. */
async function openMr(r: WorkRun, todo: TodoView): Promise<void> {
  const note = (msg: string) => fs.appendFileSync(/*turbopackIgnore: true*/ logPath(r.id), `${msg}\n`);
  try {
    const mt = parseMrTarget(todo.target);
    if (!mt) throw new Error(t("Which branch into which isn't known."));
    const [title, ...rest] = (todo.draft ?? todo.text).split("\n");
    note(`[Zeff] Merge request ${mt.source} → ${mt.target} in ${mt.project} — through GitLab's API from the automation Chrome.`);
    const mr = await openGitlabMr({ project: mt.project, sourceBranch: mt.source, targetBranch: mt.target, title: title.trim(), description: rest.join("\n").trim() });
    note(mr.existed ? `[Zeff] There was an open one already: ${mr.url}` : `[Zeff] Opened: ${mr.url}`);
    const result: WorkResult = {
      outcome: "done",
      summary: `Merge request ${mr.existed ? "(existed already) " : ""}${mt.source} → ${mt.target}: ${mr.url}`,
      entry: "Merge Request geöffnet",
      completedTodos: [todo.id],
      followUps: [],
    };
    note(`\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``);
  } catch (e) {
    fs.appendFileSync(/*turbopackIgnore: true*/ errPath(r.id), `${errorMessage(e)}\n`);
  }
  await finalize(r.id);
}

/** A branch name's part from a line of text: "PLZ-Validierung im Formular" → "plz-validierung-im-formular". */
/** Words as a branch name's part: "Quote-MD erweitern" → "quote-md-erweitern" (at most 40 characters). */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

const gitAsync = (cwd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile("git", args, { cwd, timeout: 180000, windowsHide: true }, (err, stdout, stderr) => (err ? reject(gitFailure(err, String(stderr || err.message).trim().slice(0, 500))) : resolve(String(stdout).trim()))),
  );

/**
 * After a code run with commits: the delivery as a follow-up todo (each step a "Run", no AI) —
 * per the repo's setting either push it as a feature branch (then open the merge request, then
 * merge it once approved — each step leaving the next), or merge it straight into the default
 * branch and push. Returns what to add to the git summary.
 */
async function proposeDelivery(r: WorkRun, res: WorkResult): Promise<string> {
  // Work on a branch you picked stays on it (its commits are there) - no merge into main behind your back.
  if (r.workspace === "branch") return `

Die Commits liegen auf ${r.branch} (dem gewählten Branch) - nichts wird von Zeff gemergt.`;
  if (!r.cwd || !r.branch || !r.baseSha || !r.repo) return "";
  const commits = await gitAsync(r.cwd, ["rev-list", "--count", `${r.baseSha}..HEAD`]).catch(() => "0");
  if (!Number(commits)) return "";
  const todo = getTodo(r.todoId);
  if (!todo) return "";
  const repo = listRepos().find((x) => x.path === r.repo);
  // Delivered into the default branch (main) — whatever branch the worker started from.
  const base = (await gitAsync(r.cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "origin/main")).replace(/^origin\//, "") || "main";
  const what = res.entry || todo.text;
  const title = `${r.ticket}: ${what}`;
  const description = `${res.summary}\n\nZeff ${workRef(r.id)} · ${todoRef(todo.id)}`;
  const remote = `${todo.kind === "fix" ? "fix" : "feature"}/${r.ticket}-${slug(what) || `w${r.id}`}`;
  // One todo: push and open the merge request in one go (its "Merge into main" alternative
  // merges straight instead) — or merge straight in, for a repo that delivers so.
  const direct = repo?.delivery === "direct" || !repo?.gitlabProject;
  const ops: TodoOp[] = direct
    ? [{ type: "git-merge-main", repo: r.repo, branch: r.branch, target: base }]
    : [
        { type: "git-push", repo: r.repo, branch: r.branch, remote, target: base, title, description },
        { type: "gitlab-open-mr", repo: r.repo, project: repo!.gitlabProject!, source: remote, target: base, title, description },
      ];
  const text = direct ? `Merge ${r.branch} into ${base} and push` : `Deliver ${r.branch}: push as ${remote}, merge request into ${base}`;
  // First tested by hand — the delivery (its buttons) comes once that's ticked off.
  addTestedDelivery({ from: todo, workRunId: r.id, source: `Follow-up from ${workRef(r.id)}`, branch: direct ? r.branch : remote, delivery: { text, ops } });
  linkBranchContext([todo.id]);
  return `\n\n${t("Once {ref} is ticked off: test by hand first — then the delivery: {text}", { ref: todoRef(todo.id), text })}`;
}

/** Runs being finished right now (finishing can wait for Copilot), so a second exit signal doesn't finish them twice. */
const finishing = ((globalThis as { __zeffWorkFinishing?: Set<number> }).__zeffWorkFinishing ??= new Set<number>());

/**
 * Copilot's report without the structured answer at its end: Copilot turns its own report (the
 * end of its output) into it — what it did, what it finished, what's next (follow-ups with
 * drafts). Noted in the log, so it's plain where the structure came from.
 */
async function structureCopilotReport(r: WorkRun, output: string): Promise<WorkResult | null> {
  const schema = JSON.stringify(WORK_RESULT_SCHEMA);
  const room = COPILOT_MAX_PROMPT - schema.length - 1500;
  const prompt = `Ein Worker hat ${todoRef(r.todoId)} auf ${r.ticket} bearbeitet (Auftrag: ${WORK_MODE_LABELS_DE[r.mode as "code" | "draft" | "send"] ?? r.mode}). Hier ist das Ende seiner Ausgabe — sein Bericht:

${output.slice(-Math.max(2000, room))}

Gib diesen Bericht im verlangten Format zurück: outcome, summary (Markdown: Erledigt, Offen, Tests, wo die Änderungen liegen), entry (eine Zeile für die Zeitbuchung), completedTodos (${r.todoId}, wenn es laut Bericht erledigt ist), followUps (was danach zu tun ist — Antworten in Teams, Kommentare und Status-Änderungen in Jira, Antworten in GitLab — je mit fertigem Entwurf, channel und target ${r.ticket}), changes, checks. Erfinde nichts, was nicht im Bericht steht.`;
  try {
    const app = getAppSettings();
    const answer = await runCopilot<unknown>(prompt, WORK_RESULT_SCHEMA, { model: r.model ?? (app.copilotModel || undefined), timeoutMs: 300000 });
    fs.appendFileSync(/*turbopackIgnore: true*/ logPath(r.id), "\n[Zeff] Copilot gave no structured result — structured afterwards from its report.\n");
    return normalizeResult(answer.output);
  } catch (e) {
    fs.appendFileSync(/*turbopackIgnore: true*/ logPath(r.id), `\n[Zeff] Couldn't structure the report: ${errorMessage(e)}\n`);
    return null;
  }
}

const WORK_MODE_LABELS_DE = { code: "umsetzen", draft: "Entwurf schreiben", send: "senden" } as const;

/**
 * A run's process is gone: read how it ended — its answer, cost, steps, what was refused —
 * what git says it changed; take the answer in (todos done, follow-ups, a draft); start the
 * next. `gone`: found dead after a restart, without an end of its own.
 */
export async function finalize(id: number, gone = false): Promise<void> {
  const r = getRun(id);
  if (!r || r.status !== "running" || finishing.has(id)) return;
  finishing.add(id);
  try {
    await finish(r, gone);
  } catch (e) {
    // Finishing failed (its log unreadable, delivery or the database throwing): the run ends as an
    // error all the same — left "running", it would hold the queue (and account switching) forever.
    console.error(`[work] finishing run ${id} failed:`, e);
    try {
      updateRun(id, { status: "failed", error: t("Finishing the run failed: {error}", { error: errorMessage(e) }).slice(0, 2000), finishedAt: now() });
      announceRun(id, "work.run.finished");
    } catch {
      // the database itself: nothing more to do here
    }
    setImmediate(pump);
  } finally {
    finishing.delete(id);
  }
}

async function finish(r: WorkRun, gone: boolean): Promise<void> {
  const id = r.id;
  const finishedAt = now();
  const durationMs = r.startedAt ? Date.parse(finishedAt) - Date.parse(r.startedAt) : null;
  let result: WorkResult | null = null;
  let error: string | null = null;
  let costUsd: number | null = null;
  let turns: number | null = null;
  let denials: number | null = null;
  let sessionId = r.sessionId;
  let closedText: string | null = null;
  const liveDriver = liveDriverOf(id);
  if (liveDriver) {
    // A live session: its last turn's JSON — or closed by you (no result: nothing taken in, its last words the summary).
    const o = liveDriver.outcome(id);
    sessionId = o.sessionId ?? sessionId;
    costUsd = o.costUsd;
    turns = o.turns;
    denials = o.denials;
    result = o.closed ? null : o.result;
    if (o.closed) closedText = o.lastText.slice(-4000) || "Closed.";
    else if (!result) error = readErrors(id) || (o.lastText ? `It ended without a result. Its last words: ${o.lastText.slice(-1500)}` : "The session ended without a result.");
  } else if (r.provider === "claude") {
    const log = readLog(id);
    const end = log.result;
    sessionId = log.sessionId ?? sessionId;
    if (end) {
      costUsd = typeof end.total_cost_usd === "number" ? end.total_cost_usd : null;
      turns = end.num_turns ?? null;
      denials = end.permission_denials?.length ?? 0;
    }
    if (end && !end.is_error && end.subtype === "success") result = normalizeResult(end.structured_output);
    if (!result) error = end?.result ? `${end.subtype ?? "error"}: ${end.result}` : readErrors(id) || t("The run ended without a result.");
  } else {
    const output = readOutput(id);
    result = normalizeResult(lastJson(output));
    if (!result && r.provider === "copilot" && output.trim() && getRun(id)?.status === "running") result = await structureCopilotReport(r, output);
    if (!result) error = readErrors(id) || t("Copilot gave no result in the asked-for format.");
    if (getRun(id)?.status !== "running") return; // stopped meanwhile
  }
  let gitText = codeLike(r.mode) && r.cwd && r.baseSha ? gitSummary(r.cwd, r.baseSha) : "";
  if (result) {
    if (codeLike(r.mode) && r.branch && getRun(id)?.status === "running") gitText += await proposeDelivery(r, result);
    try {
      applyOutcome(r, result);
    } catch (e) {
      error = t("Its result couldn't be taken in: {error}", { error: errorMessage(e) });
    }
  }
  updateRun(id, {
    status: result || closedText !== null ? "done" : gone ? "interrupted" : "failed",
    finishedAt,
    durationMs,
    costUsd,
    turns,
    denials,
    sessionId,
    result: result ? JSON.stringify(result) : null,
    outcome: result?.outcome ?? null,
    summary: result?.summary ?? closedText,
    entryLine: result?.entry ?? null,
    gitSummary: gitText || null,
    error: error?.slice(0, 4000) ?? null,
  });
  endSideWork(id, result?.summary ?? null, result?.outcome ?? null);
  fs.rmSync(/*turbopackIgnore: true*/ jiraConfigPath(id), { force: true });
  announceRun(id, "work.run.finished");
  setImmediate(pump);
}

/** Stop a run (or take it out of the queue): its process and everything it started. */
export function cancelRun(id: number): void {
  const r = getRun(id);
  if (!r) throw new NotFoundError(t("{ref} not found.", { ref: workRef(id) }));
  // Messages waiting for this run (sent while it worked) are taken back with it.
  for (const w of runsByStatus(["queued"]).filter((x) => x.afterRun === id)) cancelRun(w.id);
  if (r.status === "queued") {
    updateRun(id, { status: "cancelled", finishedAt: now(), error: t("Taken out of the queue.") });
    announceRun(id, "work.run.finished");
    return;
  }
  if (r.status !== "running") throw new ValidationError(t("{ref} isn't running.", { ref: workRef(id) }));
  const finishedAt = now();
  updateRun(id, {
    status: "cancelled",
    finishedAt,
    durationMs: r.startedAt ? Date.parse(finishedAt) - Date.parse(r.startedAt) : null,
    error: t("Stopped."),
    gitSummary: codeLike(r.mode) && r.cwd && r.baseSha ? gitSummary(r.cwd, r.baseSha) || null : null,
  });
  endSideWork(id, null, "blocked");
  announceRun(id, "work.run.finished");
  const liveDriver = liveDriverOf(id);
  if (liveDriver) liveDriver.kill(id);
  else if (r.pid && alive(r.pid)) killTree(r.pid);
  fs.rmSync(/*turbopackIgnore: true*/ jiraConfigPath(id), { force: true });
  setImmediate(pump);
}

/**
 * When Zeff's server starts: runs still running (their process outlived the old server) are
 * watched again; those whose process is gone are read to their end (or marked interrupted);
 * then the queue goes on.
 */
export function resumeWork(): void {
  if (!isInstalled("work")) return;
  // Live Claude sessions outlive the server (their host): found again, their logs read where they stand.
  const running = runsByStatus(["running"]);
  const live = running.filter((r) => liveDriverFor(r.provider)?.has(r.id));
  for (const d of liveDrivers()) d.reattach(live.filter((r) => r.provider === d.provider).map((r) => r.id));
  for (const r of runsByStatus(["running"])) {
    if (r.provider === "agent") continue; // an agent outside Zeff: it ends its run through the MCP
    if (live.some((x) => x.id === r.id)) continue;
    // A live session was this server's: it's over with the old one — ended, to start again by hand.
    if (r.permissionMode?.startsWith("acp")) {
      if (r.pid && alive(r.pid)) killTree(r.pid);
      const why = t("Zeff was restarted — that ended the interactive session. Run it again to start a new one.");
      fs.appendFileSync(/*turbopackIgnore: true*/ errPath(r.id), `${why}\n`);
      void finalize(r.id, true);
      continue;
    }
    if (r.pid && alive(r.pid)) {
      const timer = setInterval(() => {
        if (alive(r.pid!)) return;
        clearInterval(timer);
        void finalize(r.id, true);
      }, 3000);
      timer.unref?.();
    } else void finalize(r.id, true);
  }
  pump();
}
