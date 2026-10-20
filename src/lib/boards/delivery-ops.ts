import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getJiraTicket } from "@/lib/jira/store";
import { listGitlabItems } from "@/lib/gitlab/store";
import type { GitlabItemView } from "@/lib/gitlab/shared";
import { listRepos, repoForTicket, type RepoView } from "@/lib/repos";
import { gitText } from "@/lib/git";
import { getTodo, listTodos, setTodoOps } from "./store";
import type { TodoOp, TodoView } from "./shared";

/** Git in a checkout, without blocking the server (a child process, awaited) — "" when it fails. */
const tryGit = (cwd: string, args: string[]) => gitText(cwd, args, { maxBuffer: 64 * 1024 * 1024 });

/** "Merge Request für feature/… öffnen", "MR erstellen", "open a PR" — a todo that asks for one. */
const OPENS_MR = (text: string) =>
  /\b(merge[- ]?request|mr|pull[- ]?request|pr)\b/i.test(text) && /(?<!\p{L})(öffnen|eröffnen|erstellen|anlegen|aufmachen|stellen|open|create|raise)(?!\p{L})/iu.test(text);

/** "… nach main mergen", "!168 mergen", "merge it into main" — a todo that asks to merge (not "nach dem Merge prüfen"). */
const MERGES = (text: string) => /(?<!\p{L})(mergen|einmergen)(?!\p{L})|\bmerge\b[^.]{0,60}\binto\s+(main|master)\b/iu.test(text);

/** A branch named in a todo's text (cut off as the AI may have: "feature/PROJ-454-kategorienbaum-und-…-der-m"). */
const BRANCH_IN_TEXT = /\b((?:feature|fix|bugfix|hotfix|zeff)\/[A-Za-z0-9._\-/]+)/;

/** The kinds of todo that do the work (a push of their branch is a convenience, not their delivery). */
const WORK_KINDS: string[] = ["implement", "fix", "test"];

/** What git and GitLab (as synced) know of a repo's branches — read once per repo. */
type RepoFacts = { repo: RepoView & { gitlabProject: string }; main: string; base: string; branches: string[]; mrs: GitlabItemView[] };

async function factsOf(repo: RepoView & { gitlabProject: string }): Promise<RepoFacts> {
  const main = (await tryGit(repo.path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])) || "origin/main";
  const base = main.replace(/^origin\//, "");
  const branches = [
    ...new Set(
      (await tryGit(repo.path, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin"]))
        .split("\n")
        .map((r) => r.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/origin\//, ""))
        .filter((r) => r && r !== "HEAD" && r !== base),
    ),
  ];
  return { repo, main, base, branches, mrs: listGitlabItems({ kind: "mr", limit: 500 }).filter((m) => m.project === repo.gitlabProject) };
}

const aheadOf = async (f: RepoFacts, name: string) => {
  const local = !!(await tryGit(f.repo.path, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]));
  return Number((await tryGit(f.repo.path, ["rev-list", "--count", `${f.main}..${local ? name : `origin/${name}`}`])) || 0);
};
const mrOf = (f: RepoFacts, name: string) => f.mrs.find((m) => m.branch === name && /opened/i.test(m.state ?? "")) ?? f.mrs.find((m) => m.branch === name && !/closed/i.test(m.state ?? ""));

/** The branch a todo names (exactly, or the one its cut-off name starts). */
function namedBranch(f: RepoFacts, text: string): string {
  const named = BRANCH_IN_TEXT.exec(text)?.[1]?.replace(/[.\-/]+$/, "");
  if (!named) return "";
  if (f.branches.includes(named)) return named;
  const starts = f.branches.filter((b) => b.startsWith(named));
  return starts.length === 1 ? starts[0] : "";
}

/** The branch the work before it went on: the latest run (a worker's, an agent's) on it or the steps before it. */
function branchBefore(t: TodoView): string {
  const seen = new Set<number>();
  for (let id: number | null = t.id; id && !seen.has(id) && seen.size < 10; id = getTodo(id)?.parentId ?? null) {
    seen.add(id);
    const run = getDb()
      .select({ branch: schema.workRuns.branch })
      .from(schema.workRuns)
      .where(and(eq(schema.workRuns.todoId, id), isNotNull(schema.workRuns.branch)))
      .orderBy(desc(schema.workRuns.id))
      .get();
    // A worker's own worktree branch (zeff/…) isn't what goes to GitLab.
    if (run?.branch && !run.branch.startsWith("zeff/")) return run.branch.replace(/^origin\//, "");
  }
  return "";
}

/** Push (what isn't yet) and open the merge request to main, for a branch. */
async function openMrOps(f: RepoFacts, t: TodoView, name: string): Promise<TodoOp[]> {
  const local = !!(await tryGit(f.repo.path, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]));
  const remote = !!(await tryGit(f.repo.path, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`]));
  const unpushed = local && (!remote || Number((await tryGit(f.repo.path, ["rev-list", "--count", `origin/${name}..${name}`])) || 0) > 0);
  const title = `${t.ticket}: ${getJiraTicket(t.ticket)?.summary ?? t.text}`.slice(0, 250);
  const description = `${t.ref} · ${t.text}`;
  return [
    ...(unpushed ? [{ type: "git-push" as const, repo: f.repo.path, branch: name, remote: name, target: f.base, title, description }] : []),
    { type: "gitlab-open-mr" as const, repo: f.repo.path, project: f.repo.gitlabProject, source: name, target: f.base, title, description },
  ];
}

/**
 * The operations a delivery todo asks for in words, worked out without AI — for a todo with
 * none yet:
 * - "open a merge request (for feature/…)": the branch it names, else the ticket's one branch
 *   ahead of main without one — pushed if it isn't (all of it), then the merge request to main;
 * - "merge (… nach main)": the branch it names, else the one the work before it went on — its
 *   open merge request merged (the button waits for the approval), or, without one yet, opened.
 * Null: not such a todo, or nothing to do (no branch, no GitLab project, it's being delivered).
 */
export async function deliveryOpsFor(t: TodoView, opts: { delivering?: Set<string>; facts?: Map<string, RepoFacts> } = {}): Promise<TodoOp[] | null> {
  // (A hand-over to a worker — the AI's suggestion "Hand to Copilot" — is no delivery: the push and the merge request still get their buttons, before it.)
  if (t.status !== "open" || t.ops.some((o) => o.type !== "work-instruct")) return null;
  const opens = t.owner === "me" && OPENS_MR(t.text);
  const merges = !opens && (t.kind === "merge" || MERGES(t.text));
  if (!opens && !merges) return null;
  const repo = repoForTicket(t.ticket, listRepos())?.repo;
  if (!repo?.ok || !repo.gitlabProject) return null;
  const f = opts.facts?.get(repo.path) ?? (await factsOf(repo as RepoView & { gitlabProject: string }));
  opts.facts?.set(repo.path, f);

  let name = namedBranch(f, t.text);
  if (!name && merges) name = branchBefore(t);
  if (!name && opens) {
    const key = new RegExp(`(^|[^A-Za-z0-9])${t.ticket}(?![0-9])`, "i");
    const candidates: string[] = [];
    for (const b of f.branches) if (key.test(b) && !mrOf(f, b) && (await aheadOf(f, b)) > 0) candidates.push(b);
    if (candidates.length === 1) name = candidates[0];
  }
  if (!name || opts.delivering?.has(name)) return null;
  const mr = mrOf(f, name);
  if (merges && mr && /opened/i.test(mr.state ?? "")) return [{ type: "gitlab-merge", project: f.repo.gitlabProject, iid: Number(mr.ref.replace("!", "")), source: name }];
  if (mr || !(await aheadOf(f, name))) return null; // merged already, or nothing to deliver
  return openMrOps(f, t, name);
}

/** The branch a todo's own work was done on (its latest run's — an agent's; a worker's own worktree branch zeff/… doesn't count) and the repo that has it. */
function workBranchOf(t: TodoView): { name: string; repo: RepoView } | null {
  const run = getDb()
    .select({ branch: schema.workRuns.branch, repo: schema.workRuns.repo })
    .from(schema.workRuns)
    .where(and(eq(schema.workRuns.todoId, t.id), isNotNull(schema.workRuns.branch), isNotNull(schema.workRuns.repo)))
    .orderBy(desc(schema.workRuns.id))
    .get();
  const name = run?.branch?.replace(/^origin\//, "") ?? "";
  if (!run || !name || name.startsWith("zeff/")) return null;
  const repo = listRepos().find((r) => r.path === run.repo);
  return repo?.ok ? { name, repo } : null;
}

/**
 * What the branch a todo's work was done on needs next — worked out from git, without AI:
 * - it exists here but isn't pushed (or has commits that aren't): a push action;
 * - it's on the remote with commits of its own, GitLab has no merge request for it and the repo
 *   has a GitLab project: an "open merge request" action.
 * The push action of a branch that has been pushed meanwhile goes. `remove`: ops to take away.
 */
async function workBranchOps(t: TodoView, open: TodoView[], mrs: GitlabItemView[]): Promise<{ add: TodoOp[]; remove: TodoOp[] }> {
  const found = workBranchOf(t);
  if (!found) return { add: [], remove: [] };
  const { name, repo } = found;
  const main = (await tryGit(repo.path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])) || "origin/main";
  const base = main.replace(/^origin\//, "");
  const local = !!(await tryGit(repo.path, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]));
  const remote = !!(await tryGit(repo.path, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`]));
  if (!local && !remote) return { add: [], remove: [] };
  const ahead = Number((await tryGit(repo.path, ["rev-list", "--count", `${main}..${local ? name : `origin/${name}`}`])) || 0);
  const unpushed = local && (!remote || Number((await tryGit(repo.path, ["rev-list", "--count", `origin/${name}..${name}`])) || 0) > 0);
  const pushOf = (o: TodoOp) => o.type === "git-push" && o.branch === name && o.remote === name;
  // A push action we gave it, and the branch is on the remote now: done.
  // …or when another todo (a delivery) carries the push for that branch now.
  const covered = open.some((x) => x.id !== t.id && !WORK_KINDS.includes(x.kind) && x.ops.some((o) => (o.type === "git-push" && o.branch === name) || (o.type === "gitlab-open-mr" && o.source === name)));
  const remove = (remote && !unpushed) || (covered && WORK_KINDS.includes(t.kind)) ? t.ops.filter(pushOf) : [];
  const title = `${t.ticket}: ${getJiraTicket(t.ticket)?.summary ?? t.text}`.slice(0, 250);
  const description = `${t.ref} · ${t.text}`;
  const add: TodoOp[] = [];
  if (ahead > 0 && unpushed && !open.some((x) => x.ops.some(pushOf) || (x.id !== t.id && x.ops.some((o) => o.type === "gitlab-open-mr" && o.source === name)))) add.push({ type: "git-push", repo: repo.path, branch: name, remote: name, target: base, title, description });
  const delivers = (o: TodoOp) => (o.type === "gitlab-open-mr" && o.source === name) || (o.type === "gitlab-merge" && o.source === name);
  const hasMr = mrs.some((m) => m.branch === name && !/closed/i.test(m.state ?? "") && m.project === repo.gitlabProject);
  if (ahead > 0 && remote && !unpushed && repo.gitlabProject && !hasMr && !open.some((x) => x.ops.some(delivers))) {
    add.push({ type: "gitlab-open-mr", repo: repo.path, project: repo.gitlabProject, source: name, target: base, title, description });
  }
  return { add, remove };
}

/**
 * Open todos that ask for a delivery (a merge request opened, a branch merged) but have no
 * button: given its operations. (The Ticket-Lage and plans write them as text; this makes them
 * one click, every time.) How many.
 */
export async function attachOpenMrOps(): Promise<number> {
  const open = listTodos({ status: "open" });
  // Branches an open todo delivers already.
  // (A push on the todo of the work itself is only a convenience — the delivery todo that names the branch carries the real one.)
  const delivering = new Set(open.filter((t) => !WORK_KINDS.includes(t.kind)).flatMap((t) => t.ops.flatMap((o) => ("source" in o ? [o.source] : "branch" in o ? [o.branch.replace(/^origin\//, "")] : []))));
  const facts = new Map<string, RepoFacts>();
  let n = 0;
  for (const t of open) {
    const ops = await deliveryOpsFor(t, { delivering, facts });
    if (!ops) continue;
    setTodoOps(t.id, [...ops, ...t.ops]);
    for (const o of ops) if ("source" in o) delivering.add(o.source);
    n++;
  }
  // The work's branch: pushed when it isn't, a merge request opened when it's there and has none.
  const mrs = listGitlabItems({ kind: "mr", limit: 500 });
  for (const t of listTodos({ status: "open" })) {
    const { add, remove } = await workBranchOps(t, listTodos({ status: "open" }), mrs);
    if (!add.length && !remove.length) continue;
    setTodoOps(t.id, [...t.ops.filter((o) => !remove.includes(o)), ...add]);
    n++;
  }
  // The work's branches and merge requests as context of their todos (links) — again after a run rewrote the todos.
  try {
    (await import("@/lib/work/branch-context")).linkBranchContext(listTodos({ status: "open" }).map((x) => x.id));
  } catch {
    // without the links, then
  }
  return n;
}

/**
 * Ops with every "open merge request" turned into "merge !n" where that merge request is open already (opened since — by you, by an earlier
 * step, on GitLab's side). Null: nothing to change.
 */
export function upgradeOpenOps(ops: TodoOp[], mrs: { project: string; branch: string | null; state: string | null; ref: string }[]): TodoOp[] | null {
  let changed = false;
  const next = ops.map((o) => {
    if (o.type !== "gitlab-open-mr") return o;
    const mr = mrs.find((m) => m.project === o.project && m.branch === o.source && /opened/i.test(m.state ?? ""));
    if (!mr) return o;
    changed = true;
    return { type: "gitlab-merge" as const, project: o.project, iid: Number(mr.ref.replace("!", "")), source: o.source };
  });
  return changed ? next : null;
}

/** The open todos' "open merge request" actions whose merge request exists already become its merge. Returns how many todos changed. */
export async function upgradeOpenMrOps(): Promise<number> {
  const todos = listTodos({ status: "open" }).filter((t) => t.ops.some((o) => o.type === "gitlab-open-mr"));
  if (!todos.length) return 0;
  const mrs = listGitlabItems({ kind: "mr", limit: 500 });
  let n = 0;
  for (const t of todos) {
    const next = upgradeOpenOps(t.ops, mrs);
    if (next) {
      setTodoOps(t.id, next);
      n++;
    }
  }
  return n;
}
