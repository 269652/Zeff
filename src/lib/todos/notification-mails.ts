import { gitlabLinkKey } from "@/lib/gitlab/shared";

/**
 * A mail that only announces something Zeff has synced itself — a GitLab comment ("… commented on a discussion: <merge request>#note_466019 …"),
 * a Jira comment (a link with focusedCommentId) — names the original: its GitLab key ("note:466019") or its Jira comment id. The
 * original then stands in for the mail wherever a todo names it (one entry, not a mail and a comment saying the same).
 */
export function notificationOf(m: { subject: string; preview: string }): { gitlab?: string; jira?: string } {
  const text = `${m.subject} ${m.preview}`;
  for (const url of text.match(/https?:\/\/[^\s<>"')]+/g) ?? []) {
    const key = gitlabLinkKey(url.replace(/[.,;]+$/, ""));
    if (key?.startsWith("note:")) return { gitlab: key };
  }
  const jira = /[?&]focusedCommentId=(\d+)/.exec(text);
  return jira ? { jira: jira[1] } : {};
}
