/**
 * Synced GitLab items — the parts pages, forms and the server share. No DB access here
 * (client-safe).
 */
import { type T, translator } from "@/lib/i18n/shared";

/** A merge request, a comment on one, or a branch. */
export type GitlabKind = "mr" | "comment" | "branch";

export const gitlabKindLabels = (t: T): Record<GitlabKind, string> => ({ mr: t("MR"), comment: t("Comment"), branch: t("Branch") });

export type GitlabItemView = {
  key: string;
  kind: GitlabKind;
  project: string;
  projectUrl: string;
  /** "!167" or the branch name. */
  ref: string;
  title: string;
  /** Markdown, as GitLab keeps it (relative links — see gitlabMarkdown). */
  body: string;
  author: string | null;
  state: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string;
  branch: string | null;
  parent: string | null;
  /** A comment's thread (GitLab's discussion id). */
  thread: string | null;
  /** A comment marked done here (GitLab's own "resolved" is `state`). */
  resolvedAt: string | null;
  /** A context item links to it already. */
  inContext: boolean;
};

/** A comment's thread resolved in GitLab. */
export const resolvedInGitlab = (item: Pick<GitlabItemView, "kind" | "state">) => item.kind === "comment" && item.state === "resolved";

/** A comment that's done — resolved in GitLab or marked here: Boards runs make no new todos from it. */
export const gitlabDone = (item: Pick<GitlabItemView, "kind" | "state" | "resolvedAt">) => resolvedInGitlab(item) || (item.kind === "comment" && !!item.resolvedAt);

/**
 * The synced item a GitLab link points at — "note:<id>" (…/merge_requests/167#note_<id>),
 * "mr:<project>!<iid>" (…/-/merge_requests/167, also /diffs etc.), "branch:<project>:<name>"
 * (…/-/tree/<name>) — or null for any other link.
 */
export function gitlabLinkKey(url: string | null | undefined): string | null {
  let u: URL;
  try {
    u = new URL(String(url ?? "").trim());
  } catch {
    return null;
  }
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const mr = /^\/(.+?)\/-\/merge_requests\/(\d+)/.exec(u.pathname);
  const note = /^#note_(\d+)$/.exec(u.hash);
  if (mr && note) return `note:${note[1]}`;
  if (mr) return `mr:${dec(mr[1])}!${mr[2]}`;
  const branch = /^\/(.+?)\/-\/tree\/(.+?)\/?$/.exec(u.pathname);
  if (branch) return `branch:${dec(branch[1])}:${dec(branch[2])}`;
  return null;
}

/** An item's Markdown with GitLab's relative links made whole: uploads belong to the project, other paths to the site. */
export function gitlabMarkdown(item: Pick<GitlabItemView, "body" | "projectUrl">): string {
  let origin = "";
  try {
    origin = new URL(item.projectUrl).origin;
  } catch {
    return item.body;
  }
  return item.body
    .replace(/\]\((\/uploads\/[^)\s]+)\)/g, (_, p: string) => `](${item.projectUrl}${p})`)
    .replace(/\]\((\/[^)\s]+)\)/g, (_, p: string) => `](${origin}${p})`);
}

/** The Jira key an item names (its title, branch or ref), when its prefix is one of `prefixes` ("PROJ"). */
export function gitlabTicket(item: Pick<GitlabItemView, "title" | "branch" | "ref">, prefixes: Set<string>): string | null {
  for (const s of [item.title, item.branch, item.ref]) {
    for (const m of String(s ?? "").matchAll(/\b([A-Za-z][A-Za-z0-9]+)-(\d+)\b/g)) {
      const prefix = m[1].toUpperCase();
      if (prefixes.has(prefix)) return `${prefix}-${m[2]}`;
    }
  }
  return null;
}

/** "Comment on !167 Title", "!167 Title", "Branch feature/x". */
export function gitlabHeadline(item: Pick<GitlabItemView, "kind" | "ref" | "title">, t: T = translator("en")): string {
  if (item.kind === "branch") return t("Branch {ref}", { ref: item.ref });
  if (item.kind === "comment") return t("Comment on {ref} {title}", { ref: item.ref, title: item.title });
  return `${item.ref} ${item.title}`;
}
