import { llmChoice, llmPreamble } from "@/plugins/llm/run";
import { isInstalled } from "@/plugins/state";
import { providerAvailable } from "@/plugins/state";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { aiChoice, getAppSettings } from "@/lib/ai";
import { findClaudeCli } from "@/plugins/claude-cli/cli";
import { COPILOT_MAX_PROMPT, findCopilotCli, runCopilot } from "@/plugins/copilot-cli/cli";
import type { AiProvider } from "@/lib/ai/shared";
import { asksForApproval, opsSettle, todoRef } from "@/lib/boards/shared";
import type { TodoOp, TodoView } from "@/lib/boards/shared";
import { addFollowUp, addTestedDelivery, addTodoInstruction, getTodo, handOverPlan, setTodoOps } from "@/lib/boards/store";
import { commentOnMr, openGitlabMr, postGitlabReply } from "@/lib/gitlab/reply";
import { runTodoOps } from "@/lib/ops";
import { gitlabItemsByKeys, listGitlabItems } from "@/lib/gitlab/store";
import type { WorkRun } from "@/db/schema";
import { errorMessage, NotFoundError, ValidationError } from "@/lib/errors";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { briefFor, taskFor, workerRules } from "./brief";
import { listRepos, repoForTicket } from "@/lib/repos";
import { addWorktree, baseFor, git, gitSummary } from "./git";
import { startInteractive } from "@/plugins/copilot-cli/interactive";
import { errPath, logPath, readErrors, readLog, readOutput, workDir } from "./log";
import { applyOutcome, normalizeResult } from "./outcome";
import { createRun, getRun, getWorkSettings, runsByStatus, toRunView, updateRun } from "./store";
import { parseMrTarget, WORK_RESULT_SCHEMA, workModeOf, workRef, type WorkResult, type WorkRunView } from "./shared";

/** Zeff's own booking tools — a worker never books: Zeff books its runs (Weekly report). */
const ZEFF_TOOLS = ["report_time", "update_time_entry", "delete_time_entry", "complete_todo", "create_job"].map((t) => `mcp__zeff__${t}`);
/** The Jira tools a send run may use, from Zeff's own Jira connection (server "zeff-jira"). */
const JIRA_SEND_TOOLS = ["jira_add_comment", "jira_get_transitions", "jira_transition_issue", "jira_update_issue", "jira_get_issue"].map((t) => `mcp__zeff-jira__${t}`);

const now = () => new Date().toISOString();
const jiraConfigPath = (id: number) => path.join(workDir(), `jira-mcp-${id}.json`);

/**
 * The environment a worker gets: Zeff's, without what belongs to Zeff's own server — a nested
 * Claude Code session's markers, NODE_ENV=production (npm would skip devDependencies), Next's
 * and npm's variables, Zeff's settings.
 */
function workerEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|NODE_ENV|PORT|HOSTNAME|DATABASE_PATH|NODE_OPTIONS)$/i.test(k)) continue;
    if (/^(NEXT_|__NEXT|npm_|ZEFF_|TURBOPACK)/i.test(k)) continue;
    env[k] = v;
  }
  return env;
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
export function dispatchTodo(todoId: number, opts: { provider?: AiProvider; instruction?: string; /** A session in this repo (Repos page), whatever the ticket says. */ repoId?: number } = {}): WorkRunView {
  if (!isInstalled("work")) throw new ValidationError("Work ist nicht installiert (Menü → Plugins) — ohne es arbeitet kein Worker an Todos.");
  const todo = getTodo(todoId);
  if (!todo) throw new NotFoundError(`Todo ${todoRef(todoId)} not found.`);
  // Your instruction: an AI run on the todo that does what you say (whatever the todo's own mode).
  const instruction = opts.instruction?.trim();
  if (instruction && todo.status !== "open") throw new ValidationError(`${todoRef(todoId)} is ${todo.status} already.`);
  const m: ReturnType<typeof workModeOf> = instruction ? { mode: "instruct" } : workModeOf(todo);
  if (!m.mode) throw new ValidationError(m.why);
  // (An instruction from the todo's own operations — Zeff running them right now — goes ahead.)
  const active = runsByStatus(["queued", "running"]).find((r) => r.todoId === todoId && !(opts.instruction && r.provider === "zeff"));
  if (active) throw new ValidationError(`${todoRef(todoId)} is with ${workRef(active.id)} already.`);
  const s = getWorkSettings();
  // A GitLab reply Zeff posts itself; a Jira one goes through Claude (with Zeff's Jira connection).
  const byZeff = !instruction && ((m.mode === "send" && todo.channel === "gitlab") || m.mode === "mr" || m.mode === "ops");
  // A worker is the LLM plugin's "worker" task: its backend (or the default).
  const provider: AiProvider | "zeff" = byZeff ? "zeff" : (opts.provider ?? llmChoice("worker").provider);
  if (provider !== "zeff" && !isInstalled("llm")) throw new ValidationError("Das LLM-Plugin ist nicht installiert (Menü → Plugins) — keine Worker.");
  if (provider !== "zeff" && !providerAvailable(provider)) throw new ValidationError(`${provider === "claude" ? "Claude CLI" : "Copilot CLI"}: das Plugin ist nicht installiert (Settings → Plugins).`);
  if (m.mode === "send" && provider === "copilot") throw new ValidationError("Only Claude can post to Jira (through Zeff's Jira connection) — install the Claude CLI plugin.");
  const repo = (opts.repoId ? listRepos().find((r) => r.id === opts.repoId) : undefined) ?? repoForTicket(todo.ticket)?.repo;
  if (m.mode === "code" && !repo) throw new ValidationError(`No repo for ${todo.ticket} — assign its board (or the ticket) to one on the Repos page.`);
  const app = getAppSettings();
  // The Work tab's model is one of the Settings provider's; another provider gets its own Settings model.
  const own = provider === "zeff" ? "" : provider === llmChoice("worker").provider ? llmChoice("worker").model : provider === "copilot" ? app.copilotModel : app.claudeModel;
  const model = (provider === aiChoice().provider ? s.model || own : own) || null;
  const run = createRun({
    ticket: todo.ticket,
    todoId,
    mode: m.mode,
    provider,
    model,
    permissionMode: provider === "claude" ? s.permissionMode : provider === "copilot" ? "allow-all-tools" : null,
    repo: repo?.path ?? null,
    prompt: instruction ? `${briefFor(todo)}\n\n## Deine Anweisung (vom Nutzer — sie geht vor)\n${instruction}` : briefFor(todo),
  });
  // Your instruction on the todo, as your words (context for the Lage, workers and agents too).
  if (instruction) addTodoInstruction(todoId, instruction, run.id);
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
  const running = runsByStatus(["running"]).filter((r) => r.provider !== "agent");
  let free = s.parallel - running.length;
  if (free <= 0) return;
  const busy = new Set(s.isolation === "checkout" ? running.filter((r) => codeLike(r.mode)).map((r) => r.repo) : []);
  for (const r of runsByStatus(["queued"])) {
    if (free <= 0) break;
    if (s.isolation === "checkout" && codeLike(r.mode) && r.repo) {
      if (busy.has(r.repo)) continue;
      busy.add(r.repo);
    }
    free--;
    start(r.id);
  }
}

/** A run that may change code (in the repo, its worktree): an implementation, or your instruction. */
const codeLike = (mode: string) => mode === "code" || mode === "instruct";

/** One run begins: where it works (a worktree of its own, the repo, or a scratch folder), its full prompt, its process. */
function start(id: number): void {
  const r = getRun(id);
  if (!r || r.status !== "queued") return;
  const startedAt = now();
  updateRun(id, { status: "running", startedAt });
  try {
    const s = getWorkSettings();
    const todo = getTodo(r.todoId);
    if (!todo) throw new Error(`${todoRef(r.todoId)} doesn't exist any more.`);
    // Zeff's own runs (operations, GitLab replies, merge requests): no worktree, no CLI.
    if (r.provider === "zeff") {
      fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(logPath(id)), { recursive: true });
      updateRun(id, { cwd: null });
      void (r.mode === "mr" ? openMr(r, todo) : r.mode === "ops" ? runOps(r, todo) : postReply(r, todo));
      return;
    }
    const mode = r.mode === "draft" || r.mode === "send" || r.mode === "instruct" ? r.mode : "code";
    let cwd = path.join(workDir(), "scratch");
    let branch: string | null = null;
    let base: string | null = null;
    let baseSha: string | null = null;
    if (codeLike(mode) && r.repo) {
      if (s.isolation === "worktree") {
        base = baseFor(r.repo, r.ticket);
        ({ cwd, branch, baseSha } = addWorktree(r.repo, r.ticket, id, base));
      } else {
        cwd = r.repo;
        base = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
        baseSha = git(cwd, ["rev-parse", "HEAD"]);
      }
    } else if (mode === "draft" && r.repo) {
      cwd = r.repo; // to look things up — read only
    }
    fs.mkdirSync(/*turbopackIgnore: true*/ cwd, { recursive: true });
    // House rules: everyone's, then the repo's own.
    const repoRules = r.repo ? (listRepos().find((x) => x.path === r.repo)?.instructions ?? "") : "";
    // (Your instructions and context from the LLM plugin first — for every worker.)
    const rules = workerRules([llmPreamble(), s.instructions, repoRules].filter((x) => x.trim()).join("\n\n"));
    const prompt = `${r.prompt}\n\n${taskFor(mode, { todo, runId: id, repo: r.repo, cwd, branch, base, isolation: s.isolation })}`;
    updateRun(id, { cwd, branch, base, baseSha, prompt });

    fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(logPath(id)), { recursive: true });
    const out = fs.openSync(/*turbopackIgnore: true*/ logPath(id), "a");
    const err = fs.openSync(/*turbopackIgnore: true*/ errPath(id), "a");
    let command: string;
    let args: string[];
    let stdin: string | null = null;
    let sessionId: string | null = null;
    if (r.provider === "copilot") {
      const cli = findCopilotCli();
      if (!cli) throw new Error("The Copilot CLI wasn't found (npm install -g @github/copilot, or set COPILOT_CLI).");
      const tail = `\n\nAntworte am Ende mit einem JSON-Objekt nach diesem JSON-Schema, in einem \`\`\`json-Block:\n${JSON.stringify(WORK_RESULT_SCHEMA)}`;
      // A live session (it asks you for permissions on the Work tab, you can write to it, switch it to autopilot).
      if (s.copilotMode !== "headless") {
        // The session writes its log itself (as it goes), not a process' output.
        fs.closeSync(out);
        fs.closeSync(err);
        updateRun(id, { permissionMode: s.copilotMode === "autopilot" ? "acp-autopilot" : "acp" });
        void startInteractive({
          runId: id,
          command: cli.command,
          args: [...cli.args, "--deny-tool", "shell(git push)", ...(r.model ? ["--model", r.model] : [])],
          cwd,
          env: workerEnv() as NodeJS.ProcessEnv,
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
      if (!cli) throw new Error("The Claude CLI wasn't found — install Claude Code, or set CLAUDE_CLI.");
      sessionId = randomUUID();
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
        "--session-id",
        sessionId,
        "--name",
        `Zeff ${workRef(id)} · ${r.ticket}`,
        "--permission-mode",
        r.permissionMode || "auto",
        "--permission-prompts",
        "none",
        "--append-system-prompt",
        rules,
        "--disallowedTools",
        disallowed.join(","),
      ];
      if (r.model) args.push("--model", r.model);
      if (mode === "send") {
        const jira = getJiraSyncConfig();
        if (!jira.configured || !jira.command) throw new Error("Zeff's Jira connection isn't set up (Jira tab) — nothing can be posted without it.");
        fs.writeFileSync(
          /*turbopackIgnore: true*/ jiraConfigPath(id),
          JSON.stringify({ mcpServers: { "zeff-jira": { type: "stdio", command: jira.command, args: jira.args, env: jira.env } } }),
          { mode: 0o600 },
        );
        args.push("--mcp-config", jiraConfigPath(id), "--allowedTools", JIRA_SEND_TOOLS.join(","));
      }
      stdin = prompt;
    }

    // Detached, its output straight into files: a run outlives a restart of Zeff's server.
    const child = spawn(/*turbopackIgnore: true*/ command, args, { cwd, env: workerEnv() as NodeJS.ProcessEnv, stdio: ["pipe", out, err], windowsHide: true, detached: true });
    fs.closeSync(out);
    fs.closeSync(err);
    child.on("error", (e) => {
      fs.appendFileSync(/*turbopackIgnore: true*/ errPath(id), `${e.message}\n`);
      void finalize(id);
    });
    child.on("exit", () => void finalize(id));
    child.stdin?.on("error", () => {}); // a CLI that quits early: its exit says why
    child.stdin?.end(stdin ?? "", "utf8");
    child.unref();
    updateRun(id, { pid: child.pid ?? null, sessionId });
  } catch (e) {
    updateRun(id, { status: "failed", error: errorMessage(e).slice(0, 2000), finishedAt: now(), durationMs: Date.now() - Date.parse(startedAt) });
    setImmediate(pump);
  }
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
      if (!iid || !mr) throw new Error(`Which comment (or merge request) to answer isn't known (${todo.target ?? "no target"}) — sync GitLab, or post it yourself.`);
      note(`[Zeff] Der Kommentar ist nicht bekannt — als neuer Kommentar in ${mr.ref} (${mr.project}).`);
      const c = await commentOnMr(mr.project, iid, todo.draft ?? "");
      note(`[Zeff] Gepostet: ${c.url}`);
      const result: WorkResult = { outcome: "done", summary: `Kommentar in ${mr.ref} gepostet: ${c.url}`, entry: `Kommentar in ${mr.ref} gepostet`, completedTodos: [todo.id], followUps: [] };
      note(`\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``);
      await finalize(r.id);
      return;
    }
    note(`[Zeff] Antwort auf ${item.ref} (${item.author ?? "?"}) — über GitLabs API aus dem Automation-Chrome, sonst über die Seite.`);
    const res = await postGitlabReply(item.url, todo.draft ?? "");
    note(res.via === "api" ? `[Zeff] Über die API gepostet: ${res.url}` : `[Zeff] API ging nicht (${res.apiFailed}) — über die Seite gepostet: ${res.url}`);
    const result: WorkResult = {
      outcome: "done",
      summary: `Antwort im Thread von ${item.ref} gepostet (${res.via === "api" ? "API" : "über die Seite"}): ${res.url}`,
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
      const f = addFollowUp({ ticket: todo.ticket, text: n.text, kind: "merge", parentId: todo.id, workRunId: r.id, source: `Follow-up von ${workRef(r.id)}`, ops: n.ops, owner: n.owner });
      handOverPlan(todo.id, f.id, ["merge", "review"]);
      note(`[Zeff] Als Nächstes: ${todoRef(f.id)} — ${n.text}${n.owner === "other" ? " (wartet aufs Approval)" : ""}`);
    }
    // Ticked off only when the operations are the todo (a reply, a comment, a delivery …) — a side
    // step of other work (the ticket moved while it's implemented) leaves it open.
    const settles = opsSettle(todo);
    if (!settles) note(`[Zeff] ${todoRef(todo.id)} bleibt offen — die Schritte waren nur ein Teil davon.`);
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
      note(`[Zeff] Als Nächstes an ${todoRef(todo.id)}: die Bitte ums Approval als Antwort im Thread — ein Klick.`);
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
    const t = parseMrTarget(todo.target);
    if (!t) throw new Error("Which branch into which isn't known.");
    const [title, ...rest] = (todo.draft ?? todo.text).split("\n");
    note(`[Zeff] Merge Request ${t.source} → ${t.target} in ${t.project} — über GitLabs API aus dem Automation-Chrome.`);
    const mr = await openGitlabMr({ project: t.project, sourceBranch: t.source, targetBranch: t.target, title: title.trim(), description: rest.join("\n").trim() });
    note(mr.existed ? `[Zeff] Es gab schon einen offenen: ${mr.url}` : `[Zeff] Geöffnet: ${mr.url}`);
    const result: WorkResult = {
      outcome: "done",
      summary: `Merge Request ${mr.existed ? "(bestand schon) " : ""}${t.source} → ${t.target}: ${mr.url}`,
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
    execFile("git", args, { cwd, timeout: 180000, windowsHide: true }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().slice(0, 500))) : resolve(String(stdout).trim()))),
  );

/**
 * After a code run with commits: the delivery as a follow-up todo (each step a "Run", no AI) —
 * per the repo's setting either push it as a feature branch (then open the merge request, then
 * merge it once approved — each step leaving the next), or merge it straight into the default
 * branch and push. Returns what to add to the git summary.
 */
async function proposeDelivery(r: WorkRun, res: WorkResult): Promise<string> {
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
  const text = direct ? `${r.branch} in ${base} mergen und pushen` : `${r.branch} ausliefern: als ${remote} pushen, Merge Request nach ${base}`;
  // First tested by hand — the delivery (its buttons) comes once that's ticked off.
  const test = addTestedDelivery({ from: todo, workRunId: r.id, source: `Follow-up von ${workRef(r.id)}`, branch: direct ? r.branch : remote, delivery: { text, ops } });
  return `\n\nErst testen: ${todoRef(test.id)} — danach die Auslieferung: ${text}`;
}

/** The JSON object at the end of a plain-text answer (Copilot's): the last ```json block, else the last object that parses. */
function lastJson(text: string): unknown {
  const fences = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (const f of fences.reverse()) {
    try {
      return JSON.parse(f[1]);
    } catch {
      // the next one
    }
  }
  const t = text.slice(-60000);
  const end = t.lastIndexOf("}");
  for (let i = t.lastIndexOf("{", end); i >= 0; i = t.lastIndexOf("{", i - 1)) {
    try {
      return JSON.parse(t.slice(i, end + 1));
    } catch {
      // further back
    }
  }
  return null;
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
    fs.appendFileSync(/*turbopackIgnore: true*/ logPath(r.id), "\n[Zeff] Copilot gab kein strukturiertes Ergebnis aus — aus seinem Bericht nachträglich strukturiert.\n");
    return normalizeResult(answer.output);
  } catch (e) {
    fs.appendFileSync(/*turbopackIgnore: true*/ logPath(r.id), `\n[Zeff] Bericht ließ sich nicht strukturieren: ${errorMessage(e)}\n`);
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
  if (r.provider === "claude") {
    const log = readLog(id);
    const end = log.result;
    sessionId = log.sessionId ?? sessionId;
    if (end) {
      costUsd = typeof end.total_cost_usd === "number" ? end.total_cost_usd : null;
      turns = end.num_turns ?? null;
      denials = end.permission_denials?.length ?? 0;
    }
    if (end && !end.is_error && end.subtype === "success") result = normalizeResult(end.structured_output);
    if (!result) error = end?.result ? `${end.subtype ?? "error"}: ${end.result}` : readErrors(id) || "The run ended without a result.";
  } else {
    const output = readOutput(id);
    result = normalizeResult(lastJson(output));
    if (!result && r.provider === "copilot" && output.trim() && getRun(id)?.status === "running") result = await structureCopilotReport(r, output);
    if (!result) error = readErrors(id) || "Copilot gave no result in the asked-for format.";
    if (getRun(id)?.status !== "running") return; // stopped meanwhile
  }
  let gitText = codeLike(r.mode) && r.cwd && r.baseSha ? gitSummary(r.cwd, r.baseSha) : "";
  if (result) {
    if (codeLike(r.mode) && r.branch && getRun(id)?.status === "running") gitText += await proposeDelivery(r, result);
    try {
      applyOutcome(r, result);
    } catch (e) {
      error = `Its result couldn't be taken in: ${errorMessage(e)}`;
    }
  }
  updateRun(id, {
    status: result ? "done" : gone ? "interrupted" : "failed",
    finishedAt,
    durationMs,
    costUsd,
    turns,
    denials,
    sessionId,
    result: result ? JSON.stringify(result) : null,
    outcome: result?.outcome ?? null,
    summary: result?.summary ?? null,
    entryLine: result?.entry ?? null,
    gitSummary: gitText || null,
    error: error?.slice(0, 4000) ?? null,
  });
  fs.rmSync(/*turbopackIgnore: true*/ jiraConfigPath(id), { force: true });
  setImmediate(pump);
}

/** Stop a run (or take it out of the queue): its process and everything it started. */
export function cancelRun(id: number): void {
  const r = getRun(id);
  if (!r) throw new NotFoundError(`${workRef(id)} not found.`);
  if (r.status === "queued") {
    updateRun(id, { status: "cancelled", finishedAt: now(), error: "Taken out of the queue." });
    return;
  }
  if (r.status !== "running") throw new ValidationError(`${workRef(id)} isn't running.`);
  const finishedAt = now();
  updateRun(id, {
    status: "cancelled",
    finishedAt,
    durationMs: r.startedAt ? Date.parse(finishedAt) - Date.parse(r.startedAt) : null,
    error: "Stopped.",
    gitSummary: codeLike(r.mode) && r.cwd && r.baseSha ? gitSummary(r.cwd, r.baseSha) || null : null,
  });
  if (r.pid && alive(r.pid)) killTree(r.pid);
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
  for (const r of runsByStatus(["running"])) {
    if (r.provider === "agent") continue; // an agent outside Zeff: it ends its run through the MCP
    // A live session was this server's: it's over with the old one — ended, to start again by hand.
    if (r.permissionMode?.startsWith("acp")) {
      if (r.pid && alive(r.pid)) killTree(r.pid);
      fs.appendFileSync(/*turbopackIgnore: true*/ errPath(r.id), "Zeff wurde neu gestartet — die interaktive Sitzung ist damit beendet. „Nochmal“ startet sie neu.\n");
      void finalize(r.id, true);
      continue;
    }
    if (r.pid && alive(r.pid)) {
      const t = setInterval(() => {
        if (alive(r.pid!)) return;
        clearInterval(t);
        void finalize(r.id, true);
      }, 3000);
      t.unref?.();
    } else void finalize(r.id, true);
  }
  pump();
}
