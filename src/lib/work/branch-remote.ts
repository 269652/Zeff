import { getDb, schema } from "@/db";
import { listRepos } from "@/lib/repos";
import { repoWebUrl } from "./remote";

/**
 * A branch Zeff has just pushed: its GitLab "branch" item (the todo's context entry, with its address)
 * is on the remote from now on — made when there is none, and no longer "not pushed" when there was
 * one (the work's branch is noted so before its push). The GitLab sync's own copy of it replaces this
 * one later; it says the same. False: the repo has no GitLab project (nothing to link to).
 */
export function markBranchOnRemote(repoPath: string, name: string): boolean {
  const repo = listRepos().find((r) => r.path === repoPath);
  const web = repoWebUrl(repoPath);
  const branch = name.replace(/^origin\//, "");
  if (!repo?.gitlabProject || !web || !branch) return false;
  const now = new Date().toISOString();
  getDb()
    .insert(schema.gitlabItems)
    .values({ key: `branch:${repo.gitlabProject}:${branch}`, kind: "branch", project: repo.gitlabProject, projectUrl: web, ref: branch, title: branch, body: "", url: `${web}/-/tree/${branch}`, branch, state: null, syncedAt: now })
    .onConflictDoUpdate({ target: schema.gitlabItems.key, set: { state: null, syncedAt: now } })
    .run();
  return true;
}
