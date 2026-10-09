#!/usr/bin/env node
/**
 * gitlab-mcp — a stdio MCP server that reads your GitLab merge requests, their comments and
 * your branches for Zeff, deterministically (no LLM). It ATTACHES to the automation Chrome (the
 * one Chrono/Punch/Teams use; default http://127.0.0.1:9222, override with GITLAB_CDP_ENDPOINT)
 * and calls GitLab's API from a GitLab tab there, with the session Chrome has (no token or
 * password is touched). Reading is GET only; the one write is gitlab_reply, on your click.
 *
 * Tools:
 *   gitlab_items {baseUrl, sinceIso, days, openIfMissing} -> JSON { user, items }: merge requests
 *     you wrote, are assigned to or review (updated since sinceIso), their comments (yours
 *     too), and your branches in their projects with commits in the last `days` days
 *   gitlab_reply {baseUrl, noteUrl, body, dryRun} -> JSON { via, url }: a reply in the thread of
 *     the comment at noteUrl — through the API (the page's CSRF token), else through the page
 *     itself (Reply…, type, send). dryRun: find the thread, post nothing.
 *   gitlab_merge_mr {baseUrl, project, iid, dryRun} -> JSON { url, state }: merge an open merge
 *     request through the API (dryRun: only check it can be merged).
 *   gitlab_comment {baseUrl, project, iid, body, dryRun} -> JSON { url }: a new comment on a merge
 *     request through the API. dryRun: check it's there, post nothing.
 *   gitlab_resolve {baseUrl, noteUrl, resolved, dryRun} -> JSON { resolvable, resolved }: the
 *     thread of the comment at noteUrl resolved (or opened again) through the API.
 *   gitlab_open_mr {baseUrl, project, sourceBranch, targetBranch, title, description, dryRun}
 *     -> JSON { url, iid } — a merge request through the API (an open one for the branch is
 *     reused). dryRun: check project and branches, create nothing.
 */
import { connectToChrome, ChromeConnectError, withTabLock } from "./chrome-cdp.mjs";

const CDP = process.env.GITLAB_CDP_ENDPOINT || process.env.CHRONO_CDP_ENDPOINT || "http://127.0.0.1:9222";
const log = (...a) => process.stderr.write(`[gitlab-mcp] ${a.join(" ")}\n`);
/** Step-by-step logging when GITLAB_DEBUG is set. */
const debug = (...a) => process.env.GITLAB_DEBUG && log(...a);
const isSignIn = (u) => /\/users\/sign_in|\/users\/auth\b|login\.microsoftonline\.com|\/saml\b|\/oauth/i.test(u);
const originOf = (u) => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

/**
 * Runs IN a GitLab tab: GET requests to GitLab's API (same origin, so the session goes along).
 * Self-contained — Playwright ships it to the page as source.
 */
async function readGitlab({ sinceIso, branchSinceIso }) {
  let requests = 0;
  const get = async (path) => {
    requests++;
    const r = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (r.status === 401) throw Object.assign(new Error("signin"), { signin: true });
    if (!r.ok) throw new Error(`GitLab answered ${r.status} for ${path.split("?")[0]}`);
    return { body: await r.json(), next: r.headers.get("x-next-page") };
  };
  /** All pages (up to `max`) of a list. */
  const list = async (path, max = 3) => {
    const out = [];
    let page = "1";
    for (let i = 0; i < max && page; i++) {
      const r = await get(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (Array.isArray(r.body)) out.push(...r.body);
      page = r.next || "";
    }
    return out;
  };

  try {
    const me = (await get("/api/v4/user")).body;
    const mine = new Set([me.email, me.commit_email, me.public_email].filter(Boolean).map((e) => String(e).toLowerCase()));
    const since = encodeURIComponent(sinceIso);
    const mrLists = await Promise.all([
      list(`/api/v4/merge_requests?scope=all&state=all&author_id=${me.id}&updated_after=${since}`),
      list(`/api/v4/merge_requests?scope=assigned_to_me&state=all&updated_after=${since}`),
      list(`/api/v4/merge_requests?scope=all&state=all&reviewer_id=${me.id}&updated_after=${since}`),
    ]);
    const mrs = new Map();
    for (const mr of mrLists.flat()) mrs.set(mr.id, mr);

    const items = [];
    const projectOf = (mr) => ({
      project: (mr.references?.full || "").replace(/!\d+$/, "") || String(mr.project_id),
      projectUrl: String(mr.web_url).split("/-/")[0],
    });
    for (const mr of mrs.values()) {
      const p = projectOf(mr);
      // An open merge request's approval (shown in its state: "opened · approved").
      let approved = false;
      if (mr.state === "opened") {
        try {
          const a = (await get(`/api/v4/projects/${mr.project_id}/merge_requests/${mr.iid}/approvals`)).body || {};
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
      });
      // Its comments, thread by thread — yours too (no system notes like "approved", "added 1 commit").
      // A thread with anything new comes whole (its earlier comments too), each comment with its thread.
      const discussions = await list(`/api/v4/projects/${mr.project_id}/merge_requests/${mr.iid}/discussions`, 3);
      for (const d of discussions) {
        const notes = (d.notes || []).filter((n) => !n.system);
        if (!notes.some((n) => n.created_at >= sinceIso || n.updated_at >= sinceIso)) continue;
        for (const n of notes)
        items.push({
          thread: String(d.id),
          key: `note:${n.id}`,
          kind: "comment",
          ...p,
          ref: `!${mr.iid}`,
          title: mr.title,
          body: n.body || "",
          author: n.author?.name ?? null,
          state: n.resolvable ? (n.resolved ? "resolved" : "unresolved") : null,
          createdAt: n.created_at,
          updatedAt: n.updated_at,
          url: `${mr.web_url}#note_${n.id}`,
          branch: mr.source_branch,
          parent: `mr:${p.project}!${mr.iid}`,
        });
      }
    }

    // Your branches in those projects: the last commit is yours, and recent.
    const projects = new Map();
    for (const mr of mrs.values()) projects.set(mr.project_id, projectOf(mr));
    for (const [pid, p] of projects) {
      const branches = await list(`/api/v4/projects/${pid}/repository/branches`, 3);
      for (const b of branches) {
        const c = b.commit || {};
        const ours = mine.has(String(c.author_email || "").toLowerCase()) || (c.author_name && c.author_name === me.name);
        if (!ours || !(String(c.committed_date || c.created_at || "") >= branchSinceIso)) continue;
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
        });
      }
    }
    return { user: { username: me.username, name: me.name }, items, requests };
  } catch (e) {
    return e && e.signin ? { signin: true, requests } : { error: String((e && e.message) || e), requests };
  }
}

/**
 * Runs IN a GitLab tab: reply in the thread of a merge request comment, through the API — the
 * note's discussion found, then a note posted into it (the page's CSRF token goes along with the
 * session). dryRun: only find it.
 */
async function replyViaApi({ project, iid, noteId, body, dryRun }) {
  const base = `/api/v4/projects/${encodeURIComponent(project)}/merge_requests/${iid}`;
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  const get = async (path) => {
    const r = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`GitLab answered ${r.status} for ${path.split("?")[0]}`);
    return { body: await r.json(), next: r.headers.get("x-next-page") };
  };
  try {
    let discussion = null;
    for (let page = "1"; page && !discussion; ) {
      const r = await get(`${base}/discussions?per_page=100&page=${page}`);
      discussion = (r.body || []).find((d) => (d.notes || []).some((n) => String(n.id) === String(noteId))) || null;
      page = r.next || "";
    }
    if (!discussion) return { error: `No thread with comment ${noteId} on !${iid}.` };
    if (dryRun) return { via: "api", dryRun: true, discussion: discussion.id, notes: discussion.notes.length, csrf: !!csrf };
    const r = await fetch(`${base}/discussions/${discussion.id}/notes`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ body }),
    });
    if (!r.ok) return { apiFailed: `GitLab answered ${r.status} to the reply` };
    const note = await r.json();
    return { via: "api", id: note.id };
  } catch (e) {
    return { apiFailed: String(e?.message || e) };
  }
}

/**
 * The fallback: the comment's page itself — open its thread's reply box, type, send — and
 * check the reply is there.
 */
async function replyViaPage(page, noteUrl, noteId, body) {
  await page.goto(noteUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  const note = page.locator(`#note_${noteId}`);
  await note.waitFor({ timeout: 30000 });
  const thread = note.locator("xpath=ancestor::*[contains(@class,'discussion')][1]");
  const open = thread.locator('[data-testid="discussion-reply-tab"], button:has-text("Reply…"), button:has-text("Reply")').first();
  await open.click({ timeout: 15000 });
  const box = thread.locator('textarea[data-testid="reply-field"], textarea.js-gfm-input, textarea').last();
  await box.fill(body, { timeout: 15000 });
  const before = await thread.locator("[id^=note_]").count();
  const sendBtn = thread.locator('[data-testid="reply-comment-button"], button:has-text("Reply"), button:has-text("Comment")').last();
  await sendBtn.click({ timeout: 15000 });
  await page.waitForFunction(
    ([sel, n]) => document.querySelector(sel)?.closest(".discussion")?.querySelectorAll("[id^=note_]").length > n,
    [`#note_${noteId}`, before],
    { timeout: 30000 },
  );
  return { via: "page" };
}

async function gitlabReply({ baseUrl, noteUrl, body, dryRun = false } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const m = /^(https?:\/\/[^/]+)\/(.+?)\/-\/merge_requests\/(\d+)[^#]*#note_(\d+)$/.exec(String(noteUrl || ""));
  if (!m) throw new Error("noteUrl must be a merge request comment's link (…/-/merge_requests/<n>#note_<id>).");
  if (!String(body || "").trim()) throw new Error("Nothing to post (the draft is empty).");
  const [, origin, project, iid, noteId] = m;
  if (originOf(base) !== origin) throw new Error(`The comment isn't on ${base}.`);
  const browser = await connectToChrome(CDP, { launchUrls: [`${base}/`] });
  try {
    const { page, signIn } = await gitlabPage(browser, base, true);
    const r = await page.evaluate(replyViaApi, { project: decodeURIComponent(project), iid, noteId, body, dryRun: !!dryRun });
    if (r.error) throw new Error(r.error);
    if (!r.apiFailed) return JSON.stringify({ ...r, url: noteUrl });
    if (dryRun) throw new Error(r.apiFailed);
    debug(`API reply failed (${r.apiFailed}) — through the page`);
    if (isSignIn(page.url())) throw new Error(signIn);
    const p = await replyViaPage(page, noteUrl, noteId, body);
    return JSON.stringify({ ...p, url: noteUrl, apiFailed: r.apiFailed });
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Runs IN a GitLab tab: merge an open merge request through the API. */
async function mergeViaApi({ project, iid, dryRun }) {
  const base = `/api/v4/projects/${encodeURIComponent(project)}/merge_requests/${iid}`;
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  try {
    const r0 = await fetch(base, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!r0.ok) return { error: `GitLab answered ${r0.status} for !${iid}.` };
    const mr = await r0.json();
    if (mr.state === "merged") return { url: mr.web_url, state: "merged", already: true };
    if (mr.state !== "opened") return { error: `!${iid} is ${mr.state}.` };
    if (mr.draft || mr.work_in_progress) return { error: `!${iid} is a draft — mark it ready first.` };
    if (dryRun) return { dryRun: true, url: mr.web_url, status: mr.detailed_merge_status || mr.merge_status };
    const r = await fetch(`${base}/merge`, { method: "PUT", credentials: "same-origin", headers: { accept: "application/json", "x-csrf-token": csrf } });
    if (!r.ok) return { error: `GitLab refused to merge !${iid} (${r.status}): ${(await r.text()).slice(0, 300)}` };
    const done = await r.json();
    return { url: done.web_url, state: done.state };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

async function gitlabMergeMr({ baseUrl, project, iid, dryRun = false } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!project || !Number(iid)) throw new Error("project and iid are needed.");
  const browser = await connectToChrome(CDP, { launchUrls: [`${base}/`] });
  try {
    const { page, signIn } = await gitlabPage(browser, base, true);
    const r = await page.evaluate(mergeViaApi, { project, iid: Number(iid), dryRun: !!dryRun });
    if (isSignIn(page.url())) throw new Error(signIn);
    if (r.error) throw new Error(r.error);
    return JSON.stringify(r);
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Runs IN a GitLab tab: a merge request closed through the API (a comment first, when given). */
async function closeViaApi({ project, iid, comment, dryRun }) {
  const base = `/api/v4/projects/${encodeURIComponent(project)}/merge_requests/${iid}`;
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  const send = (url, method, body) =>
    fetch(url, { method, credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
  try {
    const got = await fetch(base, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!got.ok) return { error: `GitLab answered ${got.status} for !${iid} in ${project}.` };
    const mr = await got.json();
    if (mr.state !== "opened") return { url: mr.web_url, state: mr.state, already: true };
    if (dryRun) return { dryRun: true, url: mr.web_url, state: mr.state, title: mr.title, source: mr.source_branch, csrf: !!csrf };
    if (comment) {
      const c = await send(`${base}/notes`, "POST", { body: comment });
      if (!c.ok) return { error: `GitLab answered ${c.status} to the comment on !${iid}.` };
    }
    const r = await send(base, "PUT", { state_event: "close" });
    if (!r.ok) return { error: `GitLab answered ${r.status} to closing !${iid}.` };
    const done = await r.json();
    return { url: done.web_url, state: done.state };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

async function gitlabCloseMr({ baseUrl, project, iid, comment = "", dryRun = false } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!project || !Number(iid)) throw new Error("project and iid are needed.");
  const browser = await connectToChrome(CDP, { launchUrls: [`${base}/`] });
  try {
    const { page, signIn } = await gitlabPage(browser, base, true);
    const r = await page.evaluate(closeViaApi, { project, iid: Number(iid), comment: String(comment || "").trim(), dryRun: !!dryRun });
    if (isSignIn(page.url())) throw new Error(signIn);
    if (r.error) throw new Error(r.error);
    return JSON.stringify(r);
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Runs IN a GitLab tab: a new comment on a merge request through the API. */
async function commentViaApi({ project, iid, body, dryRun }) {
  const base = `/api/v4/projects/${encodeURIComponent(project)}/merge_requests/${iid}`;
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  try {
    const mr = await fetch(base, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!mr.ok) return { error: `GitLab answered ${mr.status} for !${iid} in ${project}.` };
    const webUrl = (await mr.json()).web_url;
    if (dryRun) return { dryRun: true, url: webUrl, csrf: !!csrf };
    const r = await fetch(`${base}/notes`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ body }),
    });
    if (!r.ok) return { error: `GitLab answered ${r.status} to the comment.` };
    const note = await r.json();
    return { url: `${webUrl}#note_${note.id}` };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

async function gitlabComment({ baseUrl, project, iid, body, dryRun = false } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!project || !Number(iid) || !String(body || "").trim()) throw new Error("project, iid and body are needed.");
  const browser = await connectToChrome(CDP, { launchUrls: [`${base}/`] });
  try {
    const { page, signIn } = await gitlabPage(browser, base, true);
    const r = await page.evaluate(commentViaApi, { project, iid: Number(iid), body, dryRun: !!dryRun });
    if (isSignIn(page.url())) throw new Error(signIn);
    if (r.error) throw new Error(r.error);
    return JSON.stringify(r);
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Runs IN a GitLab tab: a comment's thread resolved (or opened again) through the API. */
async function resolveViaApi({ project, iid, noteId, resolved, dryRun }) {
  const base = `/api/v4/projects/${encodeURIComponent(project)}/merge_requests/${iid}`;
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  try {
    let discussion = null;
    for (let page = "1"; page && !discussion; ) {
      const r = await fetch(`${base}/discussions?per_page=100&page=${page}`, { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!r.ok) return { error: `GitLab answered ${r.status} for the threads of !${iid}` };
      discussion = ((await r.json()) || []).find((d) => (d.notes || []).some((n) => String(n.id) === String(noteId))) || null;
      page = r.headers.get("x-next-page") || "";
    }
    if (!discussion) return { error: `No thread with comment ${noteId} on !${iid}.` };
    const resolvable = (discussion.notes || []).some((n) => n.resolvable);
    if (!resolvable) return { resolvable: false };
    if (dryRun) return { resolvable: true, dryRun: true, resolved: (discussion.notes || []).every((n) => !n.resolvable || n.resolved) };
    const r = await fetch(`${base}/discussions/${discussion.id}?resolved=${resolved ? "true" : "false"}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { accept: "application/json", "x-csrf-token": csrf },
    });
    if (!r.ok) return { error: `GitLab answered ${r.status} to ${resolved ? "resolving" : "reopening"} the thread.` };
    return { resolvable: true, resolved: !!resolved };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

async function gitlabResolve({ baseUrl, noteUrl, resolved = true, dryRun = false } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const m = /^(https?:\/\/[^/]+)\/(.+?)\/-\/merge_requests\/(\d+)[^#]*#note_(\d+)$/.exec(String(noteUrl || ""));
  if (!m) throw new Error("noteUrl must be a merge request comment's link (…/-/merge_requests/<n>#note_<id>).");
  const [, origin, project, iid, noteId] = m;
  if (originOf(base) !== origin) throw new Error(`The comment isn't on ${base}.`);
  const browser = await connectToChrome(CDP, { launchUrls: [`${base}/`] });
  try {
    const { page, signIn } = await gitlabPage(browser, base, true);
    const r = await page.evaluate(resolveViaApi, { project: decodeURIComponent(project), iid, noteId, resolved: !!resolved, dryRun: !!dryRun });
    if (isSignIn(page.url())) throw new Error(signIn);
    if (r.error) throw new Error(r.error);
    return JSON.stringify(r);
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Runs IN a GitLab tab: a merge request through the API (or the open one the branch has). */
async function openMrViaApi({ project, sourceBranch, targetBranch, title, description, dryRun }) {
  const base = `/api/v4/projects/${encodeURIComponent(project)}`;
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  const get = async (path) => {
    const r = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
    return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null };
  };
  try {
    const proj = await get(base);
    if (!proj.ok) return { error: `GitLab answered ${proj.status} for the project ${project}.` };
    for (const b of [sourceBranch, targetBranch]) {
      const r = await get(`${base}/repository/branches/${encodeURIComponent(b)}`);
      if (!r.ok) return { error: `The branch ${b} isn't on GitLab (${r.status}).` };
    }
    const open = await get(`${base}/merge_requests?state=opened&source_branch=${encodeURIComponent(sourceBranch)}`);
    const existing = (open.body || [])[0];
    if (existing) return { url: existing.web_url, iid: existing.iid, existed: true };
    if (dryRun) return { dryRun: true, project: proj.body.path_with_namespace, csrf: !!csrf };
    const r = await fetch(`${base}/merge_requests`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ source_branch: sourceBranch, target_branch: targetBranch, title, description, remove_source_branch: true }),
    });
    if (!r.ok) return { error: `GitLab answered ${r.status} to the merge request: ${(await r.text()).slice(0, 300)}` };
    const mr = await r.json();
    return { url: mr.web_url, iid: mr.iid };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

async function gitlabOpenMr({ baseUrl, project, sourceBranch, targetBranch, title, description = "", dryRun = false } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!project || !sourceBranch || !targetBranch || !String(title || "").trim()) throw new Error("project, sourceBranch, targetBranch and title are needed.");
  const browser = await connectToChrome(CDP, { launchUrls: [`${base}/`] });
  try {
    const { page, signIn } = await gitlabPage(browser, base, true);
    const r = await page.evaluate(openMrViaApi, { project, sourceBranch, targetBranch, title, description, dryRun: !!dryRun });
    if (isSignIn(page.url())) throw new Error(signIn);
    if (r.error) throw new Error(r.error);
    return JSON.stringify(r);
  } finally {
    await browser.close().catch(() => {});
  }
}

/** A tab on GitLab (not on its sign-in page), opening one when asked and there is none. */
async function gitlabPage(browser, base, openIfMissing) {
  const context = browser.contexts()[0];
  if (!context) throw new ChromeConnectError("The automation Chrome has no window open.");
  const origin = originOf(base);
  const host = new URL(base).host;
  const signIn = `Sign in to ${host} in the automation Chrome${openIfMissing ? " (a tab is open there)" : ""}, then sync again.`;
  const onSite = context.pages().filter((p) => originOf(p.url()) === origin);
  let page = onSite.find((p) => !isSignIn(p.url()));
  if (!page && onSite.length) throw new Error(signIn);
  if (!page) {
    if (!openIfMissing) throw new Error(`GitLab isn't open in the automation Chrome — open ${base} there (or press Sync now on Zeff's GitLab page).`);
    page = await context.newPage();
    const failed = await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 }).then(() => null, (e) => String(e?.message || e));
    // Not there at all (no VPN, offline): that's not a sign-in to ask for.
    if (failed && !isSignIn(page.url())) throw new Error(`${host} isn't reachable from the automation Chrome (VPN?): ${failed.split("\n")[0].slice(0, 160)}`);
  }
  if (isSignIn(page.url())) throw new Error(signIn);
  if (originOf(page.url()) !== origin) throw new Error(`${host} didn't open in the automation Chrome (it's at ${page.url().slice(0, 80)}).`);
  return { page, signIn };
}

async function gitlabItems({ baseUrl, sinceIso, days = 90, openIfMissing = false, launch = openIfMissing } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("baseUrl (your GitLab, e.g. https://git.example.com) is required.");
  const d = Math.max(1, Math.min(3650, Number(days) || 90));
  const fallback = new Date(Date.now() - d * 864e5).toISOString();
  const since = sinceIso && !Number.isNaN(Date.parse(sinceIso)) ? new Date(sinceIso).toISOString() : fallback;
  const browser = await connectToChrome(CDP, { launchUrls: launch ? [`${base}/`] : [] });
  try {
    const { page, signIn } = await gitlabPage(browser, base, !!openIfMissing);
    const r = await page.evaluate(readGitlab, { sinceIso: since, branchSinceIso: fallback });
    if (r.signin) throw new Error(signIn);
    if (r.error) throw new Error(r.error);
    debug(`${r.items.length} items in ${r.requests} requests`);
    return JSON.stringify(r);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio server (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "gitlab_items",
    description:
      "Read your GitLab merge requests (written, assigned, reviewing), their comments (yours too), and your recent branches in their projects — read-only GET requests to GitLab's API from a GitLab tab in the automation Chrome. Returns JSON { user, items: [{ key, kind: 'mr'|'comment'|'branch', project, ref, title, body (Markdown), author, state, createdAt, updatedAt, url, ... }] }.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string", description: "Your GitLab, e.g. https://git.example.com" },
        sinceIso: { type: "string", description: "Merge requests updated (and comments written) since this time; default: `days` ago." },
        days: { type: "number", description: "How far back branches (and, without sinceIso, everything) go — default 90." },
        openIfMissing: { type: "boolean", description: "Open GitLab in the automation Chrome when it isn't (default false)." },
        launch: { type: "boolean", description: "Start the automation Chrome when it isn't running (default: as openIfMissing)." },
      },
      required: ["baseUrl"],
    },
  },
  {
    name: "gitlab_reply",
    description:
      "Reply in the thread of a merge request comment — through GitLab's API from a GitLab tab in the automation Chrome (your session, the page's CSRF token), else through the page itself. dryRun finds the thread and posts nothing. Returns JSON { via: 'api'|'page', url }.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string", description: "Your GitLab, e.g. https://git.example.com" },
        noteUrl: { type: "string", description: "The comment's link: …/-/merge_requests/<n>#note_<id>" },
        body: { type: "string", description: "The reply (Markdown)." },
        dryRun: { type: "boolean", description: "Only find the thread; post nothing." },
      },
      required: ["baseUrl", "noteUrl", "body"],
    },
  },
  {
    name: "gitlab_merge_mr",
    description: "Merge an open merge request through GitLab's API from a GitLab tab in the automation Chrome. dryRun: only check. Returns JSON { url, state }.",
    inputSchema: {
      type: "object",
      properties: { baseUrl: { type: "string" }, project: { type: "string" }, iid: { type: "number" }, dryRun: { type: "boolean" } },
      required: ["baseUrl", "project", "iid"],
    },
  },
  {
    name: "gitlab_close_mr",
    description: "Close an open merge request (a comment on it first, when given) — through GitLab's API in the automation Chrome, signed in as you. dryRun: only read it. Returns JSON { url, state, already? }.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string" },
        project: { type: "string", description: "group/project" },
        iid: { type: "number" },
        comment: { type: "string", description: "Why it's closed (Markdown), posted before closing." },
        dryRun: { type: "boolean" },
      },
      required: ["baseUrl", "project", "iid"],
    },
  },
  {
    name: "gitlab_comment",
    description: "A new comment on a merge request through GitLab's API from a GitLab tab in the automation Chrome. dryRun: check, post nothing. Returns JSON { url }.",
    inputSchema: {
      type: "object",
      properties: { baseUrl: { type: "string" }, project: { type: "string" }, iid: { type: "number" }, body: { type: "string" }, dryRun: { type: "boolean" } },
      required: ["baseUrl", "project", "iid", "body"],
    },
  },
  {
    name: "gitlab_resolve",
    description:
      "Resolve (or, with resolved false, reopen) the thread of a merge request comment through GitLab's API from a GitLab tab in the automation Chrome. A comment that isn't a resolvable thread: { resolvable: false }. dryRun: only look.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string" },
        noteUrl: { type: "string", description: "The comment's link: …/-/merge_requests/<n>#note_<id>" },
        resolved: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      required: ["baseUrl", "noteUrl"],
    },
  },
  {
    name: "gitlab_open_mr",
    description:
      "Open a merge request (source → target branch) through GitLab's API from a GitLab tab in the automation Chrome; an open one for the source branch is returned instead. dryRun checks project and branches, creates nothing. Returns JSON { url, iid }.",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string" },
        project: { type: "string", description: "group/sub/project" },
        sourceBranch: { type: "string" },
        targetBranch: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        dryRun: { type: "boolean" },
      },
      required: ["baseUrl", "project", "sourceBranch", "targetBranch", "title"],
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function ok(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "gitlab", version: "0.1.0" } });
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      if (name === "gitlab_items") return ok(id, textResult(await withTabLock("GitLab", name, () => gitlabItems(args), debug)));
      if (name === "gitlab_reply") return ok(id, textResult(await withTabLock("GitLab", name, () => gitlabReply(args), debug)));
      if (name === "gitlab_merge_mr") return ok(id, textResult(await withTabLock("GitLab", name, () => gitlabMergeMr(args), debug)));
      if (name === "gitlab_close_mr") return ok(id, textResult(await withTabLock("GitLab", name, () => gitlabCloseMr(args), debug)));
      if (name === "gitlab_comment") return ok(id, textResult(await withTabLock("GitLab", name, () => gitlabComment(args), debug)));
      if (name === "gitlab_resolve") return ok(id, textResult(await withTabLock("GitLab", name, () => gitlabResolve(args), debug)));
      if (name === "gitlab_open_mr") return ok(id, textResult(await withTabLock("GitLab", name, () => gitlabOpenMr(args), debug)));
      return ok(id, textResult(`Unknown tool "${name}".`, true));
    } catch (e) {
      log("tool error:", String(e));
      return ok(id, textResult(`Error: ${String(e?.message || e).slice(0, 300)}`, true));
    }
  }
  if (id !== undefined) ok(id, {});
}

let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    Promise.resolve(handle(msg)).catch((e) => log("handler error:", String(e)));
  }
});
process.stdin.on("end", () => process.exit(0));
log(`ready (CDP ${CDP})`);
