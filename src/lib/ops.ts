import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { norm, transitionsOf } from "@/lib/boards/actions";
import { DELIVERY_OP_TYPES, opLabel, type TodoOp, type TodoView } from "@/lib/boards/shared";
import { forgetBranchWork } from "@/lib/branches";
import { errorMessage } from "@/lib/errors";
import {
  mergeGitlabMr,
  openGitlabMr,
  postGitlabReply,
  resolveGitlabThread,
} from "@/lib/gitlab/reply";
import { gitlabItemsByKeys, setGitlabState } from "@/lib/gitlab/store";

import { saveTeamsMessages, type TeamsMessageInput } from "@/lib/teams/store";
import { resultToPayload, runStdioSession } from "@/lib/jira/mcp-client";
import {
  extractIssues,
  normalizeIssue,
  type NormalizedTicket,
} from "@/lib/jira/normalize";
import { getJiraTicket, upsertTickets } from "@/lib/jira/store";
import { getJiraSyncConfig } from "@/lib/jira/sync";
import { listRepos } from "@/lib/repos";
import { setGitlabResolved } from "@/lib/resolved";

type Call = (tool: string, args: Record<string, unknown>) => Promise<unknown>;
type JiraOp = Extract<TodoOp, { type: `jira-${string}` }>;

/** A todo an operation leaves for afterwards (the next delivery step). */
export type NextTodo = { text: string; ops: TodoOp[]; owner?: "me" | "other" };

const gitAsync = (cwd: string, args: string[], timeout = 180000) =>
  new Promise<string>((resolve, reject) =>
    execFile(
      "git",
      args,
      { cwd, timeout, windowsHide: true },
      (err, stdout, stderr) =>
        err
          ? reject(
              new Error(
                String(stderr || err.message)
                  .trim()
                  .slice(0, 600),
              ),
            )
          : resolve(String(stdout).trim()),
    ),
  );

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
        `${op.ticket}: kein Übergang „${op.to}“ von hier — möglich: ${list.map((t) => t.name).join(", ") || "keiner"}.`,
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
    return `${op.ticket} zugewiesen: ${op.assignee}`;
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
    if (!created) throw lastError ?? new Error("Kein Vorgangstyp ging.");
    const key = createdKey(created);
    if (!key) throw new Error(`Jira hat das Ticket angelegt, aber keinen Schlüssel genannt: ${JSON.stringify(created).slice(0, 200)}`);
    let linked = "";
    try {
      await call("jira_create_issue_link", { link_type: "Relates", inward_issue_key: key, outward_issue_key: op.ticket });
      linked = ` (verknüpft mit ${op.ticket})`;
    } catch {
      linked = ` (Verknüpfung mit ${op.ticket} ging nicht — bitte in Jira setzen)`;
    }
    const url = getJiraTicket(op.ticket)?.url?.replace(/\/browse\/.*$/, `/browse/${key}`);
    return `Ticket ${key} angelegt${labels.length ? ` (Labels: ${labels.join(", ")})` : ""}${linked}${url ? `: ${url}` : ""}`;
  }
  await call("jira_add_comment", { issue_key: op.ticket, body: op.body });
  return `Kommentar auf ${op.ticket} gepostet`;
}

/** A 1:1 Teams message, through the Teams driver (scripts/teams-mcp.mjs) in the automation Chrome. */
type SentTeams = { to: string; newChat: boolean; away: string | null; message: (TeamsMessageInput & { link: string; sentAt: number }) | null };
async function sendTeamsMessage(to: string, body: string): Promise<SentTeams> {
  const script = path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "teams-mcp.mjs");
  return runStdioSession(
    { command: process.execPath, args: [script], env: {}, label: "Teams" },
    async (call) => resultToPayload(await call("teams_send", { to, text: body })) as SentTeams,
    180000,
  );
}

/** One operation outside Jira — GitLab through the automation Chrome, git in the repo. What happened, and what's next. */
async function otherOp(
  op: Exclude<TodoOp, JiraOp>,
): Promise<{ what: string; next?: NextTodo; ref?: string; todoNote?: string }> {
  switch (op.type) {
    case "gitlab-reply":
    case "gitlab-resolve": {
      const item = gitlabItemsByKeys([op.note]).get(op.note);
      if (!item || item.kind !== "comment")
        throw new Error(
          `Der GitLab-Kommentar ${op.note} ist nicht unter den gesyncten — GitLab erst syncen.`,
        );
      if (op.type === "gitlab-reply") {
        const r = await postGitlabReply(item.url, op.body);
        return {
          what: `Antwort in ${item.ref} gepostet (${r.via === "api" ? "API" : "über die Seite"})`,
        };
      }
      const r = await resolveGitlabThread(item.url, true);
      if (r.resolvable) setGitlabState(op.note, "resolved");
      setGitlabResolved(op.note, true);
      return {
        what: r.resolvable
          ? `Thread in ${item.ref} aufgelöst`
          : `Kommentar in ${item.ref} erledigt (kein auflösbarer Thread)`,
      };
    }
    case "teams-message": {
      const r = await sendTeamsMessage(op.to, op.body);
      // The sent message kept (its link, a badge) and named on the todo — so it's known it went out.
      if (r.message) saveTeamsMessages([r.message]);
      const at = new Date(r.message?.sentAt ?? Date.now()).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
      return {
        what: `Teams-Nachricht an ${r.to} gesendet${r.newChat ? " (neuer Chat)" : ""}${r.message ? `: ${r.message.link}` : ""}${r.away ? ` — Hinweis: ${r.away}` : ""}`,
        ref: r.message ? `teams:${r.message.key}` : undefined,
        todoNote: `Teams-Nachricht an ${r.to} gesendet am ${at}${r.away ? ` (${r.away})` : ""}.`,
      };
    }
    case "git-push": {
      await gitAsync(op.repo, [
        "push",
        "-u",
        "origin",
        `${op.branch}:refs/heads/${op.remote}`,
      ]);
      forgetBranchWork();
      const project = listRepos().find(
        (r) => r.path === op.repo,
      )?.gitlabProject;
      return {
        what: `${op.branch} gepusht als origin/${op.remote}`,
        next: project
          ? {
              text: `Merge Request ${op.remote} → ${op.target} öffnen`,
              ops: [
                {
                  type: "gitlab-open-mr",
                  repo: op.repo,
                  project,
                  source: op.remote,
                  target: op.target,
                  title: op.title ?? op.remote,
                  description: op.description ?? "",
                },
              ],
            }
          : undefined,
      };
    }
    case "gitlab-open-mr": {
      const mr = await openGitlabMr({
        project: op.project,
        sourceBranch: op.source,
        targetBranch: op.target,
        title: op.title,
        description: op.description,
      });
      const iid =
        mr.iid ?? Number(/merge_requests\/(\d+)/.exec(mr.url ?? "")?.[1]);
      return {
        what: `${mr.existed ? "MR gab es schon" : "MR geöffnet"}: ${mr.url}`,
        next: iid
          ? {
              text: `!${iid} nach ${op.target} mergen, sobald er approved ist`,
              ops: [
                {
                  type: "gitlab-merge",
                  project: op.project,
                  iid,
                  source: op.source,
                },
              ],
              owner: "other",
            }
          : undefined,
      };
    }
    case "gitlab-merge": {
      const r = await mergeGitlabMr(op.project, op.iid);
      forgetBranchWork();
      return {
        what: r.already
          ? `!${op.iid} war schon gemergt`
          : `!${op.iid} gemergt: ${r.url}`,
      };
    }
    case "git-commit-branch": {
      const current = await gitAsync(op.repo, ["branch", "--show-current"]);
      if (current !== op.branch) {
        const exists = await gitAsync(op.repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${op.branch}`]).then(
          () => true,
          () => false,
        );
        if (exists) throw new Error(`${op.branch} gibt es schon, und ausgecheckt ist ${current || "nichts"} — erst dorthin wechseln, dann noch mal.`);
        // A new branch from where the checkout is — the changes come along.
        await gitAsync(op.repo, ["switch", "-c", op.branch]);
      }
      // Only these files (what the work changed) — anything else stays as it is.
      await gitAsync(op.repo, ["add", "--", ...op.files]);
      await gitAsync(op.repo, ["commit", "-m", op.message, "--", ...op.files]);
      forgetBranchWork();
      return {
        what: `${op.files.length} Datei${op.files.length === 1 ? "" : "en"} auf ${op.branch} committet`,
        next: {
          text: `${op.branch} pushen (danach Merge Request nach ${op.target})`,
          ops: [{ type: "git-push", repo: op.repo, branch: op.branch, remote: op.branch, target: op.target, title: op.message, description: "" }],
        },
      };
    }
    case "git-merge-main": {
      // In a worktree of its own (your checkout stays as it is): the default branch from origin, the branch merged in, pushed.
      const dir = path.join(
        path.dirname(op.repo),
        ".zeff-worktrees",
        `${path.basename(op.repo)}-merge-${Date.now()}`,
      );
      await gitAsync(op.repo, [
        "fetch",
        "origin",
        op.target,
        ...(op.branch.startsWith("origin/") ? [op.branch.slice(7)] : []),
      ]);
      await gitAsync(
        op.repo,
        ["worktree", "add", "--detach", dir, `origin/${op.target}`],
        300000,
      );
      try {
        try {
          await gitAsync(dir, [
            "merge",
            "--no-ff",
            "-m",
            `Merge branch '${op.branch.replace(/^origin\//, "")}' into ${op.target}`,
            op.branch,
          ]);
        } catch (e) {
          await gitAsync(dir, ["merge", "--abort"]).catch(() => {});
          throw new Error(
            `Merge-Konflikt — ${op.branch} lässt sich nicht von selbst in ${op.target} mergen: ${errorMessage(e)}`,
          );
        }
        await gitAsync(dir, ["push", "origin", `HEAD:refs/heads/${op.target}`]);
      } finally {
        await gitAsync(op.repo, ["worktree", "remove", "--force", dir]).catch(
          () =>
            fs.rmSync(/*turbopackIgnore: true*/ dir, {
              recursive: true,
              force: true,
            }),
        );
      }
      forgetBranchWork();
      return { what: `${op.branch} in ${op.target} gemergt und gepusht` };
    }
  }
}

/**
 * Run a todo's operations, in order — Jira ones in one session of Zeff's Jira connection, GitLab
 * ones through the automation Chrome, git ones in the repo — each noted as it's done. At the
 * first that fails it stops: the ones done are taken off the todo (a retry doesn't do them
 * twice), and it throws. What was done, and the todos to leave for what's next.
 */
export async function runTodoOps(
  todo: TodoView,
  note: (line: string) => void,
): Promise<{ done: string[]; next: NextTodo[] }> {
  const done: string[] = [];
  const next: NextTodo[] = [];
  let left = [...todo.ops];
  const keep = () =>
    getDb()
      .update(schema.todos)
      .set({ ops: JSON.stringify(left) })
      .where(eq(schema.todos.id, todo.id))
      .run();
  try {
    while (left.length) {
      const op = left[0];
      note(`[Zeff] ${opLabel(op)} …`);
      if (op.type.startsWith("jira-")) {
        const cfg = getJiraSyncConfig();
        if (!cfg.configured || !cfg.command)
          throw new Error(
            "Zeffs Jira-Verbindung ist nicht eingerichtet (Jira-Tab).",
          );
        // The Jira operations in a row go in one session.
        const run: JiraOp[] = [];
        while (left.length && left[0].type.startsWith("jira-"))
          run.push(left.shift() as JiraOp);
        const results: string[] = [];
        try {
          await runStdioSession(
            {
              command: cfg.command,
              args: cfg.args,
              env: cfg.env,
              label: "Jira",
            },
            async (call) => {
              for (const o of run) {
                results.push(await jiraOp(call, o));
                note(`[Zeff] ✓ ${results[results.length - 1]}`);
              }
              // The tickets as Jira has them now (assignee, status) — not only at the next sync.
              const keys = [...new Set(run.map((o) => o.ticket.toUpperCase()))];
              try {
                const p = resultToPayload(
                  await call(cfg.tool, {
                    jql: `key in (${keys.join(",")})`,
                    limit: keys.length,
                    fields: cfg.fields,
                  }),
                );
                const fresh = extractIssues(p)
                  .map((i) => normalizeIssue(i, cfg.baseUrl))
                  .filter((t): t is NormalizedTicket => t !== null);
                if (fresh.length) upsertTickets(fresh);
                note(`[Zeff] ${keys.join(", ")} aus Jira neu gelesen`);
              } catch {
                note(
                  `[Zeff] ${keys.join(", ")} ließ sich nicht neu lesen — der nächste Jira-Sync holt es`,
                );
              }
            },
            120000,
          );
        } catch (e) {
          left = [...run.slice(results.length), ...left]; // not done: back on the list
          done.push(...results);
          throw e;
        }
        done.push(...results);
        continue;
      }
      const r = await otherOp(op as Exclude<TodoOp, JiraOp>);
      left.shift();
      done.push(r.what);
      // What it left to know (a sent message): on the todo — its reference, its note.
      if (r.ref || r.todoNote) {
        const t = getDb().select({ refs: schema.todos.refs }).from(schema.todos).where(eq(schema.todos.id, todo.id)).get();
        const refs = [...new Set([...(JSON.parse(t?.refs ?? "[]") as string[]), ...(r.ref ? [r.ref] : [])])];
        getDb()
          .update(schema.todos)
          .set({ refs: JSON.stringify(refs), ...(r.todoNote ? { note: r.todoNote.slice(0, 500) } : {}) })
          .where(eq(schema.todos.id, todo.id))
          .run();
      }
      // What's next as a todo — unless this run delivers further itself (commit → push → MR, or → merge, in one go).
      if (r.next && !left.some((o) => (DELIVERY_OP_TYPES as readonly string[]).includes(o.type))) next.push(r.next);
      note(`[Zeff] ✓ ${r.what}`);
    }
    return { done, next };
  } catch (e) {
    note(`[Zeff] ✗ ${errorMessage(e)}`);
    throw e;
  } finally {
    keep();
  }
}
