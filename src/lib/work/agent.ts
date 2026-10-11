import fs from "node:fs";
import path from "node:path";
import { addTestedDelivery, deliversBranch, getTodo, listTodos, setTodoNeedsInput } from "@/lib/boards/store";
import { parseTodoRef, todoRef } from "@/lib/boards/shared";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { TodoOp, TodoView } from "@/lib/boards/shared";
import { listRepos, repoForTicket, type RepoView } from "@/lib/repos";
import { execFile } from "node:child_process";
import { logPath } from "./log";
import { applyOutcome, normalizeResult } from "./outcome";
import { pump, slug } from "./runner";
import { workModeOf, workRef, type WorkMode } from "./shared";
import { createRun, getRun, runsByStatus, updateRun } from "./store";
import { quarterHours, suggestEntry, unsuggestedRuns } from "./suggestions";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";

const { workRuns } = schema;

/**
 * Work on a todo by an agent outside Zeff (VS Code Copilot, a Claude Code session …) through
 * Zeff's MCP: a run of its own (provider "agent", the agent's name as its model) — the todo shows
 * as being worked on and the agent as a worker (one on top of Zeff's own), its notes as the log;
 * finished with its report and the time it took — a booking suggested (a shadow row to take over).
 */

const now = () => new Date().toISOString();
const note = (id: number, line: string) => {
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(logPath(id)), { recursive: true });
  fs.appendFileSync(/*turbopackIgnore: true*/ logPath(id), `${line}\n`);
};

/** The todo a reference names (T-12, 12), open. */
function openTodo(ref: string) {
  const id = parseTodoRef(ref);
  if (id === null) throw new ValidationError(`"${ref}" isn't a todo reference like T-12.`);
  const t = getTodo(id);
  if (!t) throw new NotFoundError(`${todoRef(id)} not found.`);
  return t;
}

/** The agent's run on a todo (running), if there is one. */
const agentRunOn = (todoId: number) => runsByStatus(["running"]).find((r) => r.todoId === todoId && r.provider === "agent");

/** An agent takes a todo: its run starts (or the one it has goes on). The run. */
export function startAgentWork(v: { todo: string; agent?: string; note?: string }) {
  const t = openTodo(v.todo);
  if (t.status !== "open") throw new ValidationError(`${t.ref} is ${t.status} already.`);
  const mine = agentRunOn(t.id);
  if (mine) return { run: getRun(mine.id)!, resumed: true, todo: t };
  const busy = runsByStatus(["queued", "running"]).find((r) => r.todoId === t.id);
  if (busy) throw new ValidationError(`${workRef(busy.id)} (${busy.provider}) is already on ${t.ref} — wait for it, or stop it on Zeff's Work tab.`);
  const agent = (v.agent ?? "").trim().slice(0, 60) || "Agent";
  const mode: WorkMode = workModeOf(t).mode ?? "code";
  const r = createRun({ ticket: t.ticket, todoId: t.id, mode, provider: "agent", model: agent, permissionMode: null, repo: repoForTicket(t.ticket)?.repo.path ?? null, prompt: v.note?.trim() ?? "" });
  updateRun(r.id, { status: "running", startedAt: now() });
  note(r.id, `[${agent}] übernimmt ${t.ref}: ${t.text}`);
  if (v.note?.trim()) note(r.id, `[${agent}] ${v.note.trim()}`);
  return { run: getRun(r.id)!, resumed: false, todo: t };
}

/** Where code work on a todo goes: the ticket's repo (Repos page), its default branch, and a feature branch name to use. */
export async function workplaceOf(t: Pick<TodoView, "ticket" | "kind" | "text">): Promise<{ repo: RepoView | null; base: string; branch: string; existing: string | null }> {
  const repo = repoForTicket(t.ticket)?.repo ?? null;
  const base = repo ? ((await tryGit(repo.path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])) || "origin/main").replace(/^origin\//, "") : "main";
  return { repo, base, branch: `${t.kind === "fix" ? "fix" : "feature"}/${t.ticket}-${slug(t.text) || "work"}`, existing: repo ? await existingBranch(repo.path, t.ticket, base) : null };
}

/**
 * The ticket's feature branch the work goes on, if it has one: named after the ticket, with
 * commits not on the default branch yet — the most recently committed (local or on origin).
 */
async function existingBranch(dir: string, ticket: string, base: string): Promise<string | null> {
  const key = new RegExp(`(^|[^A-Za-z0-9])${ticket}(?![0-9])`, "i");
  const seen = new Set<string>();
  for (const ref of (await tryGit(dir, ["for-each-ref", "--sort=-committerdate", "--format=%(refname)", "refs/heads", "refs/remotes/origin"])).split("\n")) {
    const local = ref.startsWith("refs/heads/");
    const name = ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/origin\//, "");
    if (!name || name === "HEAD" || name === base || seen.has(name) || !key.test(name) || /^zeff\//.test(name)) continue;
    seen.add(name);
    if (Number((await tryGit(dir, ["rev-list", "--count", `origin/${base}..${local ? name : `origin/${name}`}`])) || 0) > 0) return name;
  }
  return null;
}

/** Git in a checkout, without blocking the server (a child process, awaited) — "" when it fails. */
const tryGit = (cwd: string, args: string[], timeout = 30000) =>
  new Promise<string>((resolve) =>
    execFile("git", args, { cwd, encoding: "utf8", timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, out) => resolve(err ? "" : String(out).trim())),
  );

/**
 * The work's uncommitted files in a checkout: the tracked ones changed, and new (untracked) ones
 * in a folder where tracked files changed too (a file the work replaced or added beside them) —
 * not untracked ones elsewhere (uploads, caches).
 */
async function changedFiles(dir: string): Promise<string[]> {
  const lines = (await tryGit(dir, ["status", "--porcelain=v1", "--untracked-files=all"], 60000))
    .split("\n")
    .filter((l) => l.trim())
    // "XY path" (the first line's leading space trimmed away with the output's): its state, its path.
    .map((l) => {
      const t = l.trim();
      return { untracked: t.startsWith("??"), path: t.replace(/^\S{1,2}\s+/, "").replace(/^.* -> /, "").replace(/^"|"$/g, "") };
    });
  const folder = (f: string) => f.slice(0, Math.max(0, f.lastIndexOf("/")));
  const touched = new Set(lines.filter((l) => !l.untracked).map((l) => folder(l.path)));
  return lines.filter((l) => !l.untracked || touched.has(folder(l.path))).map((l) => l.path);
}

/** A folder, comparable: absolute, no trailing separator, lower case ("C:/a/b/" and "c:\a\b" alike). */
const dirKey = (p: string) => path.resolve(p).replace(/[\\/]+$/, "").toLowerCase();

/** Where a branch is checked out (the repo's checkout or one of its worktrees), if anywhere. */
async function worktreeOf(repo: string, branch: string): Promise<string | null> {
  let at: string | null = null;
  for (const line of (await tryGit(repo, ["worktree", "list", "--porcelain"])).split("\n")) {
    if (line.startsWith("worktree ")) at = line.slice(9).trim();
    else if (line.trim() === `branch refs/heads/${branch}`) return at;
  }
  return null;
}

/**
 * The registered repo a folder belongs to: the repo itself, a worktree of it (an agent's
 * "../<repo>-<TICKET>"), or a folder inside it.
 */
async function repoAt(dir: string): Promise<RepoView | undefined> {
  const repos = listRepos().filter((r) => r.ok);
  const at = dirKey(dir);
  const direct = repos.find((r) => dirKey(r.path) === at || at.startsWith(`${dirKey(r.path)}${path.sep}`));
  if (direct) return direct;
  // A worktree: its common git dir is the repo's .git.
  const common = await tryGit(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common) return undefined;
  const root = dirKey(path.basename(common) === ".git" ? path.dirname(common) : common);
  return repos.find((r) => dirKey(r.path) === root);
}

/**
 * After an agent's work: its delivery as ONE follow-up todo — its operations open the merge
 * request (committing the changes first when they aren't, pushing the branch when it isn't),
 * the "Merge into main" alternative beside it merges straight into the default branch instead
 * (the other way round for a repo that delivers directly). The branch: the one given, else
 * where the uncommitted changes are (a feature branch named for the todo, when that's the
 * default branch), else the newest branch with commits since the work began. Not again when
 * there's an open delivery for that branch. What happened, in words (null: nothing to deliver).
 */
export async function proposeAgentDelivery(t: TodoView, runId: number, v: { branch?: string; repo?: string; since: string | null; title: string; description: string }): Promise<string | null> {
  // The folder it names (the repo, a worktree of it, or a folder in it) — else the ticket's repo.
  const repo = (v.repo?.trim() ? await repoAt(v.repo.trim()) : undefined) ?? repoForTicket(t.ticket)?.repo ?? null;
  if (!repo?.ok) return v.branch ? `Kein Repo für ${t.ticket} bekannt (Repos-Seite)${v.repo?.trim() ? ` und ${v.repo.trim()} gehört zu keinem` : ""} — ${v.branch} nicht als Auslieferung angelegt.` : null;
  await tryGit(repo.path, ["fetch", "origin", "--quiet"], 60000);
  const base = ((await tryGit(repo.path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])) || "origin/main").replace(/^origin\//, "");
  const current = await tryGit(repo.path, ["branch", "--show-current"]);
  const dirty = await changedFiles(repo.path);
  // Which branch the work is on.
  let name = v.branch?.trim().replace(/^origin\//, "") ?? "";
  if (!name && dirty.length) name = current && current !== base ? current : (await workplaceOf(t)).branch;
  if (!name && v.since) {
    const since = Date.parse(v.since);
    const recent = (await tryGit(repo.path, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)\t%(committerdate:iso-strict)", "refs/heads"]))
      .split("\n")
      .map((l) => l.split("\t"))
      .filter(([b, at]) => b && b !== base && Date.parse(at) >= since);
    const key = new RegExp(`(^|[^A-Za-z0-9])${t.ticket}(?![0-9])`, "i");
    name = (recent.find(([b]) => key.test(b)) ?? recent[0])?.[0] ?? "";
  }
  if (!name) return null;
  if (name === base) return `Die Arbeit liegt direkt auf ${base} — kein Feature-Branch, nichts angelegt.`;
  // Already on its way: an open delivery for that branch.
  // (Now, or planned behind its test todo.)
  const open = listTodos({ ticket: t.ticket, status: "open" }).find((x) => deliversBranch(x, name));
  if (open) return `${todoRef(open.id)} liefert ${name} schon aus.`;
  // The uncommitted changes go along — from where the branch is checked out: a worktree of its own
  // (an agent's), else the repo's checkout when it's on that branch — or (no branch named) when the
  // work was left on the default branch (it comes along onto the new one). Never the checkout's
  // own changes while the branch lives elsewhere.
  const checkout = await worktreeOf(repo.path, name);
  const inCheckout = checkout && dirKey(checkout) !== dirKey(repo.path) ? await changedFiles(checkout) : null;
  const commit: TodoOp | null =
    checkout && inCheckout
      ? inCheckout.length
        ? { type: "git-commit-branch", repo: checkout, branch: name, files: inCheckout, message: v.title, target: base }
        : null
      : dirty.length && (current === name || (current === base && !v.branch?.trim()))
        ? { type: "git-commit-branch", repo: repo.path, branch: name, files: dirty, message: v.title, target: base }
        : null;
  const local = !!commit || !!(await tryGit(repo.path, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]));
  const remote = !!(await tryGit(repo.path, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`]));
  if (!local && !remote) return `Branch ${name} gibt es in ${repo.name} nicht — nichts angelegt.`;
  if (!commit) {
    const ahead = Number((await tryGit(repo.path, ["rev-list", "--count", `origin/${base}..${local ? name : `origin/${name}`}`])) || 0);
    if (!ahead) return `${name} hat nichts, was nicht schon auf ${base} ist — nichts angelegt.`;
  }
  const unpushed = !!commit || (local && (!remote || Number((await tryGit(repo.path, ["rev-list", "--count", `origin/${name}..${name}`])) || 0) > 0));
  const viaMr: TodoOp[] = [
    ...(commit ? [commit] : []),
    ...(unpushed ? [{ type: "git-push" as const, repo: repo.path, branch: name, remote: name, target: base, title: v.title, description: v.description }] : []),
    ...(repo.gitlabProject ? [{ type: "gitlab-open-mr" as const, repo: repo.path, project: repo.gitlabProject, source: name, target: base, title: v.title, description: v.description }] : []),
  ];
  const direct: TodoOp[] = [...(commit ? [commit] : []), { type: "git-merge-main", repo: repo.path, branch: local ? name : `origin/${name}`, target: base }];
  const viaDirect = repo.delivery === "direct" || !repo.gitlabProject;
  const ops = viaDirect ? direct : viaMr;
  const text = `${name} ausliefern: ${viaDirect ? `in ${base} mergen` : `Merge Request nach ${base}`}${commit?.type === "git-commit-branch" ? ` (${commit.files.length} Datei${commit.files.length === 1 ? "" : "en"} noch nicht committet)` : ""}`;
  // First tested by hand — the delivery (its buttons) comes once that's ticked off.
  const test = addTestedDelivery({ from: t, workRunId: runId, source: `Follow-up von ${workRef(runId)}`, branch: name, delivery: { text, ops } });
  return `${todoRef(test.id)}: erst manuell testen und verifizieren — danach erscheint die Auslieferung (${text})`;
}

/** A line in the agent's log (what it's doing now). */
export function agentProgress(v: { todo: string; message: string }) {
  const t = openTodo(v.todo);
  const r = agentRunOn(t.id);
  if (!r) throw new ValidationError(`No agent is working on ${t.ref} — call start_todo first.`);
  note(r.id, `[${r.model ?? "Agent"}] ${v.message.trim().slice(0, 2000)}`);
  if (t.needsInput) setTodoNeedsInput(t.id, null); // it goes on: answered
  return r;
}

/** The agent asks you something and waits: the todo shows ❗ and its question till it goes on (todo_progress) or finishes. */
export function agentNeedsInput(v: { todo: string; question: string }) {
  const t = openTodo(v.todo);
  const r = agentRunOn(t.id);
  if (!r) throw new ValidationError(`No agent is working on ${t.ref} — call start_todo first.`);
  const question = v.question.trim();
  if (!question) throw new ValidationError("A question is needed.");
  note(r.id, `[${r.model ?? "Agent"}] ❗ wartet auf dich: ${question.slice(0, 2000)}`);
  setTodoNeedsInput(t.id, question);
  return r;
}

/**
 * The agent is through: its report (what it did — Markdown), the line to book, how long it took
 * (minutes; else since it started), whether it's done — and what's left as follow-ups. The run
 * ends with them; a done todo is ticked off (and the comments it came from with it).
 */
export async function finishAgentWork(v: {
  todo: string;
  agent?: string;
  summary: string;
  entry: string;
  minutes?: number;
  outcome?: "done" | "partial" | "blocked";
  /** The feature branch the work was committed on (and the repo's folder, when the ticket's repo isn't set up). */
  branch?: string;
  repo?: string;
  followUps?: { text: string; kind?: string; channel?: string; target?: string; draft?: string }[];
}) {
  const t = openTodo(v.todo);
  if (t.needsInput) setTodoNeedsInput(t.id, null);
  let run = agentRunOn(t.id);
  const minutes = Number(v.minutes);
  // Not started through Zeff: the run is made now, begun the minutes it took ago.
  if (!run) {
    if (t.status !== "open") throw new ValidationError(`${t.ref} is ${t.status} already.`);
    const s = startAgentWork({ todo: v.todo, agent: v.agent });
    run = s.run;
    if (minutes > 0) updateRun(run.id, { startedAt: new Date(Date.now() - minutes * 60000).toISOString() });
    run = getRun(run.id)!;
  }
  // Done only when it says so — partial or blocked, the todo stays open (its plan waits too).
  const outcome = v.outcome ?? "done";
  const res = normalizeResult({ outcome, summary: v.summary, entry: v.entry, completedTodos: outcome === "done" ? [t.id] : [], followUps: v.followUps ?? [] });
  if (!res) throw new ValidationError("A report (summary) is needed.");
  const finishedAt = now();
  const durationMs = minutes > 0 ? Math.round(minutes * 60000) : run.startedAt ? Date.parse(finishedAt) - Date.parse(run.startedAt) : null;
  note(run.id, `[${run.model ?? "Agent"}] fertig (${res.outcome}): ${res.entry}`);
  updateRun(run.id, {
    status: "done",
    outcome: res.outcome,
    summary: res.summary,
    entryLine: res.entry || null,
    result: JSON.stringify(res),
    durationMs,
    finishedAt,
  });
  const done = getRun(run.id)!;
  // Code on a branch: its delivery as the next todo (push → merge request, or merge into main) —
  // before the todo's ticked off, so what was planned after it goes on after the delivery.
  const delivery = await proposeAgentDelivery(t, run.id, {
    branch: v.branch,
    repo: v.repo,
    since: run.startedAt,
    title: `${t.ticket}: ${res.entry || t.text}`,
    description: `${res.summary}\n\n${workRef(run.id)} (${run.model ?? "Agent"}) · ${t.ref}`,
  });
  if (delivery) note(run.id, `[Zeff] Auslieferung: ${delivery}`);
  // Its branch first: the report it leaves on the todo links to what it pushed.
  if (v.branch?.trim()) updateRun(run.id, { branch: v.branch.trim() });
  // Its time, as a booking to take over (a shadow row in the Weekly report): the minutes it took,
  // its one line — with the todo and its runs as evidence. Nothing is booked yet.
  let suggestion: string | null = null;
  if (durationMs && durationMs > 0) {
    const runs = [...new Set([run.id, ...unsuggestedRuns([t.id])])];
    const ms = runs.length > 1 ? getDb().select({ ms: workRuns.durationMs }).from(workRuns).where(inArray(workRuns.id, runs)).all().reduce((a, r) => a + (r.ms ?? 0), 0) : durationMs;
    const s = suggestEntry({ hours: quarterHours(ms), description: res.entry || t.text, ticket: t.ticket, reportedBy: run.model ?? v.agent ?? "agent", todoIds: [t.id], runIds: runs });
    suggestion = `${s.ref} (${s.hours} h)`;
    note(run.id, `[Zeff] Buchung vorgeschlagen: ${suggestion} — „${s.description}“`);
  }
  const { closed, marked, added, dupes } = applyOutcome(getRun(run.id)!, res);
  if (dupes?.length) note(run.id, `[Zeff] Follow-ups weggelassen — sie wiederholen ${dupes.join(", ")}; der Bericht steht am Todo.`);
  setImmediate(pump);
  return { run: done, closed, marked, added, durationMs, delivery, suggestion };
}
