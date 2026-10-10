/**
 * How the plugins' actions run (on the server), by type — each plugin's run.ts. Jira's run
 * together in one session (runJiraOps); the ones that open in your browser (a mail draft, an
 * appointment) don't run here at all. Server only.
 */
import type { TodoOp } from "@/lib/boards/shared";
import { runGitlabMerge, runGitlabNote, runGitlabOpenMr } from "../gitlab/run";
import { runKeepNote } from "../keep/run";
import { runTeamsMessage } from "../teams/run";
import { runGitCommit, runGitMergeMain, runGitPush, runWorkInstruct } from "../work/run";
import type { ActionContext, ActionResult } from "./run-types";

type Runner = (op: TodoOp, ctx: ActionContext) => Promise<ActionResult>;
const r = <T extends TodoOp["type"]>(f: (op: Extract<TodoOp, { type: T }>, ctx: ActionContext) => Promise<ActionResult>) => f as unknown as Runner;

export const RUNNERS: Partial<Record<TodoOp["type"], Runner>> = {
  "gitlab-reply": r<"gitlab-reply">(runGitlabNote),
  "gitlab-resolve": r<"gitlab-resolve">(runGitlabNote),
  "gitlab-open-mr": r<"gitlab-open-mr">(runGitlabOpenMr),
  "gitlab-merge": r<"gitlab-merge">(runGitlabMerge),
  "teams-message": r<"teams-message">(runTeamsMessage),
  "git-push": r<"git-push">(runGitPush),
  "git-commit-branch": r<"git-commit-branch">(runGitCommit),
  "git-merge-main": r<"git-merge-main">(runGitMergeMain),
  "work-instruct": r<"work-instruct">(runWorkInstruct),
  "keep-note": r<"keep-note">(runKeepNote),
};
