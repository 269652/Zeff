import { automationEnv, driverPath } from "@/plugins/drivers";
import { driverOf } from "@/lib/connectors/store";
import { t } from "@/lib/i18n/server";
import { getGitlabSettings } from "./store";

/**
 * Reply in the thread of a merge request comment (noteUrl: …/-/merge_requests/<n>#note_<id>) —
 * through GitLab's API from a GitLab tab in the automation Chrome, else through the page itself
 * (src/plugins/gitlab/driver.mjs, gitlab_reply). dryRun: find the thread, post nothing.
 */
export async function postGitlabReply(noteUrl: string, body: string, opts: { dryRun?: boolean } = {}): Promise<{ via: "api" | "page"; url: string; apiFailed?: string }> {
  if (driverOf("gitlab") === "api") return (await import("./api")).replyTo(noteUrl, body, !!opts.dryRun);
  const base = getGitlabSettings().baseUrl.replace(/\/+$/, "");
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const script = driverPath("gitlab");
  const out = await runStdioSession(
    { command: process.execPath, args: [script], env: automationEnv(), label: "GitLab" },
    async (call) => resultToPayload(await call("gitlab_reply", { baseUrl: base, noteUrl, body, dryRun: !!opts.dryRun })),
    180000,
  );
  const r = (typeof out === "string" ? JSON.parse(out) : out) as { via?: "api" | "page"; url?: string; apiFailed?: string };
  if (!r?.via) throw new Error(typeof out === "string" ? out.slice(0, 300) : t("GitLab gave no answer."));
  return { via: r.via, url: r.url ?? noteUrl, apiFailed: r.apiFailed };
}

/** A new comment on a merge request (project, !iid) — through GitLab's API in the automation Chrome (gitlab_comment). */
export async function commentOnMr(project: string, iid: number, body: string, opts: { dryRun?: boolean } = {}): Promise<{ url: string }> {
  if (driverOf("gitlab") === "api") return (await import("./api")).commentOn(project, iid, body, !!opts.dryRun);
  const base = getGitlabSettings().baseUrl.replace(/\/+$/, "");
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const script = driverPath("gitlab");
  const out = await runStdioSession(
    { command: process.execPath, args: [script], env: automationEnv(), label: "GitLab" },
    async (call) => resultToPayload(await call("gitlab_comment", { baseUrl: base, project, iid, body, dryRun: !!opts.dryRun })),
    120000,
  );
  const r = (typeof out === "string" ? JSON.parse(out) : out) as { url?: string };
  if (!r?.url) throw new Error(typeof out === "string" ? out.slice(0, 300) : t("GitLab gave no answer."));
  return { url: r.url };
}

/**
 * Resolve (or reopen) the thread of a merge request comment in GitLab — through the API from a
 * GitLab tab in the automation Chrome (gitlab_resolve). `resolvable: false`: a comment that
 * isn't a thread GitLab resolves.
 */
export async function resolveGitlabThread(noteUrl: string, resolved: boolean, opts: { dryRun?: boolean } = {}): Promise<{ resolvable: boolean; resolved?: boolean }> {
  if (driverOf("gitlab") === "api") return (await import("./api")).resolveThread(noteUrl, resolved, !!opts.dryRun);
  const base = getGitlabSettings().baseUrl.replace(/\/+$/, "");
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const script = driverPath("gitlab");
  const out = await runStdioSession(
    { command: process.execPath, args: [script], env: automationEnv(), label: "GitLab" },
    async (call) => resultToPayload(await call("gitlab_resolve", { baseUrl: base, noteUrl, resolved, dryRun: !!opts.dryRun })),
    120000,
  );
  const r = (typeof out === "string" ? JSON.parse(out) : out) as { resolvable?: boolean; resolved?: boolean };
  if (typeof r?.resolvable !== "boolean") throw new Error(typeof out === "string" ? out.slice(0, 300) : t("GitLab gave no answer."));
  return { resolvable: r.resolvable, resolved: r.resolved };
}

/**
 * Open a merge request (source → target branch) in a project — through GitLab's API from a
 * GitLab tab in the automation Chrome (src/plugins/gitlab/driver.mjs, gitlab_open_mr); the open one the
 * branch already has is returned instead. dryRun: check, create nothing.
 */
export async function openGitlabMr(
  v: { project: string; sourceBranch: string; targetBranch: string; title: string; description: string },
  opts: { dryRun?: boolean } = {},
): Promise<{ url?: string; iid?: number; existed?: boolean; dryRun?: boolean }> {
  type Opened = { url?: string; iid?: number; existed?: boolean; dryRun?: boolean };
  let r: Opened;
  if (driverOf("gitlab") === "api") r = await (await import("./api")).openMr(v, !!opts.dryRun);
  else {
    const base = getGitlabSettings().baseUrl.replace(/\/+$/, "");
    const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
    const script = driverPath("gitlab");
    const out = await runStdioSession(
      { command: process.execPath, args: [script], env: automationEnv(), label: "GitLab" },
      async (call) => resultToPayload(await call("gitlab_open_mr", { baseUrl: base, ...v, dryRun: !!opts.dryRun })),
      180000,
    );
    r = (typeof out === "string" ? JSON.parse(out) : out) as Opened;
    if (!r?.url && !r?.dryRun) throw new Error(typeof out === "string" ? out.slice(0, 300) : t("GitLab gave no answer."));
  }
  const iid = r.iid ?? Number(/merge_requests\/(\d+)/.exec(r.url ?? "")?.[1]);
  if (r.url && iid && !opts.dryRun) {
    const { recordOpenedMr } = await import("./store");
    const { myJiraName } = await import("@/lib/jira/store");
    recordOpenedMr({ project: v.project, iid, url: r.url, title: v.title, description: v.description, source: v.sourceBranch, author: myJiraName() });
  }
  return r;
}

/** Merge an open merge request (project, !iid) — through GitLab's API in the automation Chrome (gitlab_merge_mr). */
export async function mergeGitlabMr(project: string, iid: number, opts: { dryRun?: boolean } = {}): Promise<{ url: string; state?: string; already?: boolean }> {
  if (driverOf("gitlab") === "api") return (await import("./api")).mergeMr(project, iid, !!opts.dryRun);
  const base = getGitlabSettings().baseUrl.replace(/\/+$/, "");
  const { runStdioSession, resultToPayload } = await import("@/lib/jira/mcp-client");
  const script = driverPath("gitlab");
  const out = await runStdioSession(
    { command: process.execPath, args: [script], env: automationEnv(), label: "GitLab" },
    async (call) => resultToPayload(await call("gitlab_merge_mr", { baseUrl: base, project, iid, dryRun: !!opts.dryRun })),
    120000,
  );
  const r = (typeof out === "string" ? JSON.parse(out) : out) as { url?: string; state?: string; already?: boolean };
  if (!r?.url) throw new Error(typeof out === "string" ? out.slice(0, 300) : t("GitLab gave no answer."));
  return { url: r.url, state: r.state, already: r.already };
}
