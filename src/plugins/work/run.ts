/** The Work plugin's actions, run: the delivery in the repo (commit, push, merge into main) and handing a todo to a worker. Server only. */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TodoOp } from "@/lib/boards/shared";
import { forgetBranchWork } from "@/lib/branches";
import { errorMessage } from "@/lib/errors";
import { listRepos } from "@/lib/repos";
import type { ActionContext, ActionResult } from "../actions/run-types";

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

/** The branch pushed — the merge request as the next step (with a GitLab project). */
export async function runGitPush(op: Extract<TodoOp, { type: "git-push" }>): Promise<ActionResult> {
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

/** The work's files committed on its branch — the push as the next step. */
export async function runGitCommit(op: Extract<TodoOp, { type: "git-commit-branch" }>): Promise<ActionResult> {
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

/** The branch merged into the default branch (in a worktree of its own) and pushed. */
export async function runGitMergeMain(op: Extract<TodoOp, { type: "git-merge-main" }>): Promise<ActionResult> {
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

/** The todo handed to a worker with the instruction — a run on the Work tab (its report comes back on the todo). */
export async function runWorkInstruct(op: Extract<TodoOp, { type: "work-instruct" }>, ctx: ActionContext): Promise<ActionResult> {
  const { dispatchTodo } = await import("@/lib/work/runner");
  const run = dispatchTodo(ctx.todo.id, { instruction: op.instruction });
  return { what: `An ${run.ref} übergeben (${run.status === "running" ? "läuft" : "wartet auf einen freien Worker"}) — der Bericht kommt an ${ctx.todo.ref}.` };
}
