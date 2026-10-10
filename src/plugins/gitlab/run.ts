/** The GitLab plugin's actions, run: through the automation Chrome (and GitLab's API where it can). Server only. */
import type { TodoOp } from "@/lib/boards/shared";
import { forgetBranchWork } from "@/lib/branches";
import { mergeGitlabMr, openGitlabMr, postGitlabReply, resolveGitlabThread } from "@/lib/gitlab/reply";
import { gitlabItemsByKeys, setGitlabState } from "@/lib/gitlab/store";
import { setGitlabResolved } from "@/lib/resolved";
import type { ActionResult } from "../actions/run-types";

/** A reply in a comment's thread, or the thread resolved. */
export async function runGitlabNote(op: Extract<TodoOp, { type: "gitlab-reply" | "gitlab-resolve" }>): Promise<ActionResult> {
      const item = gitlabItemsByKeys([op.note]).get(op.note);
      if (!item || item.kind !== "comment")
        throw new Error(
          `The GitLab comment ${op.note} isn't among the synced ones — sync GitLab first.`,
        );
      if (op.type === "gitlab-reply") {
        const r = await postGitlabReply(item.url, op.body);
        return {
          what: `Reply posted in ${item.ref} (${r.via === "api" ? "API" : "through the page"})`,
        };
      }
      const r = await resolveGitlabThread(item.url, true);
      if (r.resolvable) setGitlabState(op.note, "resolved");
      setGitlabResolved(op.note, true);
      return {
        what: r.resolvable
          ? `Thread in ${item.ref} resolved`
          : `Comment in ${item.ref} done (no resolvable thread)`,
      };
    }

/** A merge request opened — its merge as the next step (once it's approved). */
export async function runGitlabOpenMr(op: Extract<TodoOp, { type: "gitlab-open-mr" }>): Promise<ActionResult> {
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
        what: `${mr.existed ? "MR already existed" : "MR opened"}: ${mr.url}`,
        next: iid
          ? {
              text: `Merge !${iid} into ${op.target} as soon as it's approved`,
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

/** A merge request merged. */
export async function runGitlabMerge(op: Extract<TodoOp, { type: "gitlab-merge" }>): Promise<ActionResult> {
      const r = await mergeGitlabMr(op.project, op.iid);
      forgetBranchWork();
      return {
        what: r.already
          ? `!${op.iid} was already merged`
          : `!${op.iid} merged: ${r.url}`,
      };
    }
