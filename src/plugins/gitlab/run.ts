/** The GitLab plugin's actions, run: through the automation Chrome (and GitLab's API where it can). Server only. */
import type { TodoOp } from "@/lib/todos/shared";
import { mergeGitlabMr, openGitlabMr, postGitlabReply, resolveGitlabThread } from "@/lib/gitlab/reply";
import { gitlabItemsByKeys, setGitlabState } from "@/lib/gitlab/store";
import { setGitlabResolved } from "@/lib/resolved";
import { t } from "@/lib/i18n/server";
import type { ActionResult } from "../actions/run-types";

/** A reply in a comment's thread, or the thread resolved. */
export async function runGitlabNote(op: Extract<TodoOp, { type: "gitlab-reply" | "gitlab-resolve" }>): Promise<ActionResult> {
      const item = gitlabItemsByKeys([op.note]).get(op.note);
      if (!item || item.kind !== "comment")
        throw new Error(
          t("The GitLab comment {note} isn't among the synced ones — sync GitLab first.", { note: op.note }),
        );
      if (op.type === "gitlab-reply") {
        const r = await postGitlabReply(item.url, op.body);
        return {
          what: r.via === "api" ? t("Reply posted in {ref} (API)", { ref: item.ref }) : t("Reply posted in {ref} (through the page)", { ref: item.ref }),
        };
      }
      const r = await resolveGitlabThread(item.url, true);
      if (r.resolvable) setGitlabState(op.note, "resolved");
      setGitlabResolved(op.note, true);
      return {
        what: r.resolvable
          ? t("Thread in {ref} resolved", { ref: item.ref })
          : t("Comment in {ref} done (no resolvable thread)", { ref: item.ref }),
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
        what: mr.existed ? t("MR already existed: {url}", { url: mr.url }) : t("MR opened: {url}", { url: mr.url }),
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
      return {
        what: r.already
          ? t("!{iid} was already merged", { iid: op.iid })
          : t("!{iid} merged: {url}", { iid: op.iid, url: r.url }),
      };
    }
