/**
 * GitLab through its own API (REST v4) with a token or an OAuth sign-in — the other driver next to
 * the automation Chrome (src/plugins/gitlab/driver.mjs): the same reads and writes, with the same
 * results. Server only.
 */
import { accessToken, type OAuthEndpoints } from "@/lib/connectors/oauth";
import { getConnector } from "@/lib/connectors/store";
import { t } from "@/lib/i18n/server";
import type { GitlabItemInput } from "./store";
import { getGitlabSettings } from "./store";

const baseUrl = () => getGitlabSettings().baseUrl.replace(/\/+$/, "");

/** Where the OAuth sign-in goes: the GitLab itself. `api` is what Zeff needs (reading and writing merge requests). */
export const gitlabEndpoints = (): OAuthEndpoints => ({ authUrl: `${baseUrl()}/oauth/authorize`, tokenUrl: `${baseUrl()}/oauth/token`, scope: "api read_user" });

async function bearer(force = false): Promise<string> {
  const c = getConnector("gitlab");
  if (c.authKind === "oauth") return accessToken("gitlab", gitlabEndpoints(), force);
  if (!c.token) throw new Error(t("GitLab isn't connected — add a token on the GitLab page."));
  return c.token;
}

/** What GitLab's API returns (only the fields Zeff reads). */
type User = { id: number; username: string; name: string; email?: string; commit_email?: string; public_email?: string };
type Mr = {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description?: string;
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
  source_branch: string;
  web_url: string;
  references?: { full?: string };
  author?: { name?: string };
  created_at: string;
  updated_at: string;
};
type Note = { id: number; body?: string; system?: boolean; resolvable?: boolean; resolved?: boolean; author?: { name?: string }; created_at: string; updated_at: string; position?: NotePosition | null };
type Discussion = { id: string; notes?: Note[] };
type Branch = { name: string; merged?: boolean; default?: boolean; web_url?: string; commit?: { author_email?: string; author_name?: string; committed_date?: string; created_at?: string; message?: string; title?: string } };

type Res = { status: number; body: unknown; next: string };

/** One request to GitLab's API (a 401 with OAuth: the token refreshed, once). */
async function request(path: string, init: { method?: string; body?: unknown } = {}, retried = false): Promise<Res> {
  const res = await fetch(`${baseUrl()}/api/v4${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${await bearer(retried)}`, accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(60000),
  }).catch((e) => {
    throw new Error(t("{host} isn't reachable (VPN?): {why}", { host: new URL(baseUrl()).host, why: String((e as Error)?.message ?? e).slice(0, 160) }));
  });
  if (res.status === 401 && !retried && getConnector("gitlab").authKind === "oauth") return request(path, init, true);
  if (res.status === 401) throw new Error(t("GitLab doesn't accept the token (expired or revoked) — connect again on the GitLab page."));
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: the text stays
  }
  return { status: res.status, body, next: res.headers.get("x-next-page") ?? "" };
}

const get = async (path: string): Promise<unknown> => {
  const r = await request(path);
  if (r.status < 200 || r.status >= 300) throw new Error(t("GitLab answered {status} for {path}", { status: r.status, path: path.split("?")[0] }));
  return r.body;
};

/** All pages (up to `max`) of a list. */
async function list<T = unknown>(path: string, max = 3): Promise<T[]> {
  const out: T[] = [];
  let page = "1";
  for (let i = 0; i < max && page; i++) {
    const r = await request(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (r.status < 200 || r.status >= 300) throw new Error(t("GitLab answered {status} for {path}", { status: r.status, path: path.split("?")[0] }));
    if (Array.isArray(r.body)) out.push(...r.body);
    page = r.next;
  }
  return out;
}

const mrBase = (project: string, iid: number) => `/projects/${encodeURIComponent(project)}/merge_requests/${iid}`;

/** The merge-request link of a comment: …/<project>/-/merge_requests/<n>#note_<id>. */
export function parseNoteUrl(noteUrl: string): { project: string; iid: number; noteId: string } {
  const m = /^(https?:\/\/[^/]+)\/(.+?)\/-\/merge_requests\/(\d+)[^#]*#note_(\d+)$/.exec(String(noteUrl || ""));
  if (!m) throw new Error(t("The link must be a merge request comment's (…/-/merge_requests/<n>#note_<id>)."));
  if (new URL(m[1]).origin !== new URL(baseUrl()).origin) throw new Error(t("The comment isn't on {base}.", { base: baseUrl() }));
  return { project: decodeURIComponent(m[2]), iid: Number(m[3]), noteId: m[4] };
}

/** Merge requests you wrote, are assigned to or review, their comments and your recent branches — the driver's `gitlab_items`. */
export async function readItems(o: { sinceIso?: string; days?: number }): Promise<{ user: { username: string; name: string }; items: GitlabItemInput[] }> {
  const days = Math.max(1, Math.min(3650, Number(o.days) || 90));
  const fallback = new Date(Date.now() - days * 864e5).toISOString();
  const sinceIso = o.sinceIso && !Number.isNaN(Date.parse(o.sinceIso)) ? new Date(o.sinceIso).toISOString() : fallback;
  const me = (await get("/user")) as User;
  const mine = new Set([me.email, me.commit_email, me.public_email].filter((e): e is string => !!e).map((e) => e.toLowerCase()));
  const since = encodeURIComponent(sinceIso);
  const lists = await Promise.all([
    list<Mr>(`/merge_requests?scope=all&state=all&author_id=${me.id}&updated_after=${since}`),
    list<Mr>(`/merge_requests?scope=assigned_to_me&state=all&updated_after=${since}`),
    list<Mr>(`/merge_requests?scope=all&state=all&reviewer_id=${me.id}&updated_after=${since}`),
  ]);
  const mrs = new Map<number, Mr>();
  for (const mr of lists.flat()) mrs.set(mr.id, mr);
  const items: GitlabItemInput[] = [];
  const projectOf = (mr: Mr) => ({ project: String(mr.references?.full ?? "").replace(/!\d+$/, "") || String(mr.project_id), projectUrl: String(mr.web_url).split("/-/")[0] });
  for (const mr of mrs.values()) {
    const p = projectOf(mr);
    // An open merge request's approval (shown in its state: "opened · approved").
    let approved = false;
    if (mr.state === "opened") {
      try {
        const a = ((await get(`/projects/${mr.project_id}/merge_requests/${mr.iid}/approvals`)) as { approved?: boolean; approved_by?: unknown[] } | null) ?? {};
        approved = a.approved === true || (Array.isArray(a.approved_by) && a.approved_by.length > 0);
      } catch {
        // no approvals to read: not approved
      }
    }
    items.push({
      key: `mr:${p.project}!${mr.iid}`,
      kind: "mr",
      ...p,
      ref: `!${mr.iid}`,
      title: mr.title,
      body: mr.description || "",
      author: mr.author?.name ?? null,
      state: `${mr.draft || mr.work_in_progress ? "draft · " : ""}${mr.state}${approved ? " · approved" : ""}`,
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      url: mr.web_url,
      branch: mr.source_branch,
      parent: null,
    } as GitlabItemInput);
    // Its comments, thread by thread — yours too (no system notes); a thread with anything new comes whole.
    for (const d of await list<Discussion>(`/projects/${mr.project_id}/merge_requests/${mr.iid}/discussions`, 3)) {
      const notes = (d.notes ?? []).filter((n) => !n.system);
      if (!notes.some((n) => n.created_at >= sinceIso || n.updated_at >= sinceIso)) continue;
      for (const n of notes)
        items.push({
          thread: String(d.id),
          key: `note:${n.id}`,
          kind: "comment",
          ...p,
          ref: `!${mr.iid}`,
          title: mr.title,
          // A comment on the code: its file and line(s) first — the agent answering it needs where it is.
          body: notePlace(n.position) ? `${notePlace(n.position)}\n\n${n.body || ""}` : n.body || "",
          author: n.author?.name ?? null,
          state: n.resolvable ? (n.resolved ? "resolved" : "unresolved") : null,
          createdAt: n.created_at,
          updatedAt: n.updated_at,
          url: `${mr.web_url}#note_${n.id}`,
          branch: mr.source_branch,
          parent: `mr:${p.project}!${mr.iid}`,
        } as GitlabItemInput);
    }
  }
  // Your branches in those projects: the last commit is yours, and recent.
  const projects = new Map<number, ReturnType<typeof projectOf>>();
  for (const mr of mrs.values()) projects.set(mr.project_id, projectOf(mr));
  for (const [pid, p] of projects) {
    for (const b of await list<Branch>(`/projects/${pid}/repository/branches`, 3)) {
      const c = b.commit ?? {};
      const ours = mine.has(String(c.author_email ?? "").toLowerCase()) || (c.author_name && c.author_name === me.name);
      if (!ours || !(String(c.committed_date || c.created_at || "") >= fallback)) continue;
      const mr = [...mrs.values()].find((m) => m.project_id === pid && m.source_branch === b.name);
      items.push({
        key: `branch:${p.project}:${b.name}`,
        kind: "branch",
        ...p,
        ref: b.name,
        title: b.name,
        body: c.message || c.title || "",
        author: c.author_name ?? null,
        state: b.merged ? "merged" : b.default ? "default" : mr ? `!${mr.iid} ${mr.state}` : null,
        createdAt: c.created_at || c.committed_date,
        updatedAt: c.committed_date || c.created_at,
        url: b.web_url || `${p.projectUrl}/-/tree/${encodeURIComponent(b.name)}`,
        branch: b.name,
        parent: mr ? `mr:${p.project}!${mr.iid}` : null,
      } as GitlabItemInput);
    }
  }
  return { user: { username: me.username, name: me.name }, items };
}

/** The thread a comment is in (on its merge request). */
async function discussionOf(project: string, iid: number, noteId: string): Promise<Discussion> {
  for (const d of await list<Discussion>(`${mrBase(project, iid)}/discussions`, 20)) if ((d.notes ?? []).some((n) => String(n.id) === noteId)) return d;
  throw new Error(t("No thread with comment {note} on !{iid}.", { note: noteId, iid }));
}

const must = (r: Res, what: string): unknown => {
  if (r.status < 200 || r.status >= 300) throw new Error(`${what} (${r.status})${typeof r.body === "string" ? `: ${r.body.slice(0, 300)}` : ""}`);
  return r.body;
};

/** A reply in the thread of a comment. dryRun: find the thread, post nothing. */
export async function replyTo(noteUrl: string, body: string, dryRun: boolean): Promise<{ via: "api"; url: string }> {
  if (!body.trim()) throw new Error(t("Nothing to post (the draft is empty)."));
  const { project, iid, noteId } = parseNoteUrl(noteUrl);
  const d = await discussionOf(project, iid, noteId);
  if (!dryRun) must(await request(`${mrBase(project, iid)}/discussions/${d.id}/notes`, { method: "POST", body: { body } }), t("GitLab refused the reply"));
  return { via: "api", url: noteUrl };
}

/** A new comment on a merge request. */
export async function commentOn(project: string, iid: number, body: string, dryRun: boolean): Promise<{ url: string }> {
  const mr = (await get(mrBase(project, iid))) as Mr;
  if (dryRun) return { url: mr.web_url };
  const note = must(await request(`${mrBase(project, iid)}/notes`, { method: "POST", body: { body } }), t("GitLab refused the comment")) as Note;
  return { url: `${mr.web_url}#note_${note.id}` };
}

/** A comment's thread resolved (or opened again). */
export async function resolveThread(noteUrl: string, resolved: boolean, dryRun: boolean): Promise<{ resolvable: boolean; resolved?: boolean }> {
  const { project, iid, noteId } = parseNoteUrl(noteUrl);
  const d = await discussionOf(project, iid, noteId);
  const notes: Note[] = d.notes ?? [];
  if (!notes.some((n) => n.resolvable)) return { resolvable: false };
  if (dryRun) return { resolvable: true, resolved: notes.every((n) => !n.resolvable || n.resolved) };
  must(await request(`${mrBase(project, iid)}/discussions/${d.id}?resolved=${resolved ? "true" : "false"}`, { method: "PUT" }), t("GitLab refused to change the thread"));
  return { resolvable: true, resolved };
}

/** A merge request merged (dryRun: only checked). */
export async function mergeMr(project: string, iid: number, dryRun: boolean): Promise<{ url: string; state?: string; already?: boolean }> {
  const mr = (await get(mrBase(project, iid))) as Mr;
  if (mr.state === "merged") return { url: mr.web_url, state: "merged", already: true };
  if (mr.state !== "opened") throw new Error(t("!{iid} is {state}.", { iid, state: mr.state }));
  if (mr.draft || mr.work_in_progress) throw new Error(t("!{iid} is a draft — mark it ready first.", { iid }));
  if (dryRun) return { url: mr.web_url, state: mr.state };
  const done = must(await request(`${mrBase(project, iid)}/merge`, { method: "PUT" }), t("GitLab refused to merge !{iid}", { iid })) as Mr;
  return { url: done.web_url, state: done.state };
}

/** A merge request opened — the open one the branch has is returned instead. dryRun: check, create nothing. */
export async function openMr(v: { project: string; sourceBranch: string; targetBranch: string; title: string; description: string }, dryRun: boolean): Promise<{ url?: string; iid?: number; existed?: boolean; dryRun?: boolean }> {
  const base = `/projects/${encodeURIComponent(v.project)}`;
  const proj = await request(base);
  if (proj.status !== 200) throw new Error(t("GitLab answered {status} for the project {project}.", { status: proj.status, project: v.project }));
  for (const b of [v.sourceBranch, v.targetBranch]) {
    const r = await request(`${base}/repository/branches/${encodeURIComponent(b)}`);
    if (r.status !== 200) throw new Error(t("The branch {branch} isn't on GitLab ({status}).", { branch: b, status: r.status }));
  }
  const open = ((await get(`${base}/merge_requests?state=opened&source_branch=${encodeURIComponent(v.sourceBranch)}`)) as Mr[]) ?? [];
  if (open[0]) return { url: open[0].web_url, iid: open[0].iid, existed: true };
  if (dryRun) return { dryRun: true };
  const mr = must(await request(`${base}/merge_requests`, { method: "POST", body: { source_branch: v.sourceBranch, target_branch: v.targetBranch, title: v.title, description: v.description, remove_source_branch: true } }), t("GitLab refused the merge request")) as Mr;
  return { url: mr.web_url, iid: mr.iid };
}

/** Who the connection is for — a read of the user, to test it and to show who is signed in. */
export async function whoAmI(): Promise<{ username: string; name: string }> {
  const me = (await get("/user")) as User;
  return { username: String(me.username), name: String(me.name) };
}

/** Where a note on the code is: "src/x.ts:42", a range "src/x.ts:40-44", a removed line "src/x.ts:17 (removed line)"; "" for a note on the MR. */
export function notePlace(pos: NotePosition | null | undefined): string {
  if (!pos || pos.position_type === "image") return "";
  const path = pos.new_path || pos.old_path;
  if (!path) return "";
  const from = pos.line_range?.start ? (pos.line_range.start.new_line ?? pos.line_range.start.old_line) : null;
  const to = pos.line_range?.end ? (pos.line_range.end.new_line ?? pos.line_range.end.old_line) : null;
  const line = pos.new_line ?? pos.old_line ?? null;
  return `${path}${from && to && from !== to ? `:${from}-${to}` : line ? `:${line}` : ""}${pos.new_line == null && pos.old_line != null ? " (removed line)" : ""}`;
}

/** A diff note's position, as GitLab's API gives it. */
export type NotePosition = {
  position_type?: string;
  new_path?: string | null;
  old_path?: string | null;
  new_line?: number | null;
  old_line?: number | null;
  line_range?: { start?: { new_line?: number | null; old_line?: number | null }; end?: { new_line?: number | null; old_line?: number | null } } | null;
};
