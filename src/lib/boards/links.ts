import { gitlabItemsByKeys, listGitlabItems } from "@/lib/gitlab/store";
import type { GitlabItemView } from "@/lib/gitlab/shared";
import { listRepos, repoForTicket } from "@/lib/repos";
import type { TodoLinks, TodoView } from "./shared";

const excerpt = (s: string, n = 140) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * What a todo is about on GitLab, as links: its merge requests (named as !168 in it, the one its
 * comments are on, the one it merges) and the comments its operations answer or resolve — as
 * synced. Only todos that have any.
 */
export function todoLinks(list: TodoView[]): Record<number, TodoLinks> {
  const noteKeysOf = (t: TodoView) =>
    [
      ...t.ops.flatMap((o) => (o.type === "gitlab-reply" || o.type === "gitlab-resolve" ? [o.note] : [])),
      ...[...t.refs, t.target ?? ""].map((r) => /(?:^|gitlab:)(note:\d+)/.exec(r)?.[1] ?? ""),
    ].filter(Boolean);
  const mentionsOf = (t: TodoView) => [...new Set([...`${t.text} ${t.draft ?? ""} ${t.target ?? ""}`.matchAll(/(?<![\w/])!(\d+)\b/g)].map((m) => `!${m[1]}`))];

  const allNotes = [...new Set(list.flatMap(noteKeysOf))];
  const notes = new Map<string, GitlabItemView>();
  for (let i = 0; i < allNotes.length; i += 50) for (const [k, v] of gitlabItemsByKeys(allNotes.slice(i, i + 50))) notes.set(k, v);
  const needMrs = list.some(
    (t) => mentionsOf(t).length || noteKeysOf(t).length || /\b(feature|fix|bugfix|hotfix)\//.test(t.text) || t.ops.some((o) => o.type === "gitlab-merge" || o.type === "gitlab-open-mr" || o.type === "git-push"),
  );
  if (!needMrs) return {};
  const mrs = listGitlabItems({ kind: "mr", limit: 500 });
  const mrByKey = new Map(mrs.map((m) => [m.key, m]));
  const repos = listRepos();

  const out: Record<number, TodoLinks> = {};
  for (const t of list) {
    const found = new Map<string, GitlabItemView>();
    const noteLinks: TodoLinks["notes"] = {};
    for (const k of noteKeysOf(t)) {
      const n = notes.get(k);
      if (!n) continue;
      noteLinks[k] = { url: n.url, author: n.author, excerpt: excerpt(n.body), state: n.state };
      const mr = n.parent ? mrByKey.get(n.parent) : undefined;
      if (mr) found.set(mr.key, mr);
    }
    for (const o of t.ops) {
      if (o.type !== "gitlab-merge") continue;
      const mr = mrByKey.get(`mr:${o.project}!${o.iid}`);
      if (mr) found.set(mr.key, mr);
    }
    // "!168": the ticket's repo's merge request, else the one naming the ticket, else the only one.
    const project = repoForTicket(t.ticket, repos)?.repo.gitlabProject;
    // A branch it names or delivers: that branch's merge request (not a closed one).
    const branches = [
      /\b((?:feature|fix|bugfix|hotfix)\/[A-Za-z0-9._\-/]+)/.exec(t.text)?.[1]?.replace(/[.\-/]+$/, ""),
      ...t.ops.flatMap((o) => (o.type === "gitlab-open-mr" ? [o.source] : o.type === "git-push" ? [o.remote] : [])),
    ].filter((b): b is string => !!b);
    for (const b of branches) {
      const mr = mrs.find((m) => m.project === project && !!m.branch && (m.branch === b || m.branch.startsWith(b)) && !/closed/i.test(m.state ?? ""));
      if (mr) found.set(mr.key, mr);
    }
    const key = new RegExp(`(^|[^A-Za-z0-9])${t.ticket}(?![0-9])`, "i");
    for (const ref of mentionsOf(t)) {
      const same = mrs.filter((m) => m.ref === ref);
      const mr = same.find((m) => m.project === project) ?? same.find((m) => key.test(`${m.title} ${m.branch ?? ""}`)) ?? (same.length === 1 ? same[0] : undefined);
      if (mr) found.set(mr.key, mr);
    }
    if (found.size || Object.keys(noteLinks).length)
      out[t.id] = { mrs: [...found.values()].map((m) => ({ ref: m.ref, url: m.url, title: m.title, state: m.state })), notes: noteLinks };
  }
  return out;
}
