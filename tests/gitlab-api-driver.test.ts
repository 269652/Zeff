import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

type Seen = { method: string; url: string; auth: string; body: string };

/** A GitLab of its own (REST v4 + the OAuth token endpoint): what it was asked, and what it answers. */
async function fakeGitlab() {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const u = new URL(req.url ?? "/", "http://x");
      seen.push({ method: req.method ?? "", url: `${u.pathname}${u.search}`, auth: String(req.headers.authorization ?? ""), body });
      const json = (code: number, v: unknown, h: Record<string, string> = {}) => (res.writeHead(code, { "content-type": "application/json", ...h }), res.end(JSON.stringify(v)));
      const p = u.pathname;
      if (p === "/oauth/token") return json(200, { access_token: "fresh", refresh_token: "rotated", expires_in: 7200 });
      if (req.headers.authorization === "Bearer stale") return json(401, { message: "401 Unauthorized" });
      if (p === "/api/v4/user") return json(200, { id: 7, username: "me", name: "Me Myself", email: "me@x.de" });
      if (p === "/api/v4/merge_requests") {
        const mr = { id: 1, iid: 5, project_id: 9, title: "PROJ-1 thing", description: "d", state: "opened", draft: false, source_branch: "feature/PROJ-1-thing", web_url: `http://${req.headers.host}/g/p/-/merge_requests/5`, references: { full: "g/p!5" }, author: { name: "Me Myself" }, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-13T00:00:00Z" };
        return json(200, u.searchParams.get("scope") === "all" && u.searchParams.get("author_id") ? [mr] : []);
      }
      if (p === "/api/v4/projects/9/merge_requests/5/approvals") return json(200, { approved: true });
      if (p === "/api/v4/projects/9/merge_requests/5/discussions") return json(200, [{ id: "d1", notes: [{ id: 11, body: "Why?", author: { name: "Rev" }, resolvable: true, resolved: false, created_at: "2026-10-13T00:00:00Z", updated_at: "2026-10-13T00:00:00Z" }] }]);
      if (p === "/api/v4/projects/9/repository/branches") return json(200, []);
      if (p === "/api/v4/projects/g%2Fp/merge_requests/5/discussions" && req.method === "GET") return json(200, [{ id: "d1", notes: [{ id: 11, resolvable: true, resolved: false }] }]);
      if (p === "/api/v4/projects/g%2Fp/merge_requests/5/discussions/d1/notes") return json(201, { id: 12 });
      if (p === "/api/v4/projects/g%2Fp/merge_requests/5/discussions/d1") return json(200, {});
      if (p === "/api/v4/projects/g%2Fp/merge_requests/5") return json(200, { state: "opened", draft: false, web_url: "http://gl/g/p/-/merge_requests/5" });
      if (p === "/api/v4/projects/g%2Fp/merge_requests/5/merge") return json(200, { state: "merged", web_url: "http://gl/g/p/-/merge_requests/5" });
      return json(404, { message: "404 Not Found" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { seen, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

test("with the API driver GitLab syncs and answers without the automation Chrome", async () => {
  const gl = await fakeGitlab();
  try {
    const { updateGitlabSettings, listGitlabItems } = await import("@/lib/gitlab/store");
    const { updateConnector, driverOf } = await import("@/lib/connectors/store");
    updateGitlabSettings({ baseUrl: gl.base });
    assert.equal(driverOf("gitlab"), "cdp", "the Chrome is the default");
    updateConnector("gitlab", { driver: "api", authKind: "token", token: "glpat-x" });
    assert.equal(driverOf("gitlab"), "api");

    const { syncGitlab } = await import("@/lib/gitlab/sync");
    const r = await syncGitlab({ background: true });
    assert.equal(r.ok, true, r.message);
    const items = listGitlabItems({ limit: 20 });
    assert.deepEqual(items.map((i) => i.key).sort(), ["mr:g/p!5", "note:11"]);
    assert.match(items.find((i) => i.kind === "mr")!.state ?? "", /opened · approved/);
    assert.ok(gl.seen.every((s) => s.auth === "Bearer glpat-x"), "every request carries the token");
    assert.ok(gl.seen.every((s) => s.method === "GET"), "a sync only reads");

    const { postGitlabReply, resolveGitlabThread, mergeGitlabMr } = await import("@/lib/gitlab/reply");
    const noteUrl = `${gl.base}/g/p/-/merge_requests/5#note_11`;
    const reply = await postGitlabReply(noteUrl, "Because.");
    assert.equal(reply.via, "api");
    assert.deepEqual(JSON.parse(gl.seen.find((s) => s.url.endsWith("/discussions/d1/notes"))!.body), { body: "Because." });
    assert.deepEqual(await resolveGitlabThread(noteUrl, true), { resolvable: true, resolved: true });
    assert.equal((await mergeGitlabMr("g/p", 5)).state, "merged");
    // A dry run posts nothing.
    const before = gl.seen.length;
    await postGitlabReply(noteUrl, "x", { dryRun: true });
    assert.ok(gl.seen.slice(before).every((s) => s.method === "GET"));
  } finally {
    gl.close();
  }
});

test("with OAuth an expired token is refreshed once (and the new refresh token kept)", async () => {
  const gl = await fakeGitlab();
  try {
    const { updateGitlabSettings } = await import("@/lib/gitlab/store");
    const { updateConnector, getConnector } = await import("@/lib/connectors/store");
    updateGitlabSettings({ baseUrl: gl.base });
    updateConnector("gitlab", { driver: "api", authKind: "oauth", clientId: "app", refreshToken: "old", accessToken: "stale", expiresAt: Date.now() + 3600e3 });
    const { whoAmI } = await import("@/lib/gitlab/api");
    assert.equal((await whoAmI()).username, "me");
    const c = getConnector("gitlab");
    assert.equal(c.accessToken, "fresh");
    assert.equal(c.refreshToken, "rotated");
    const tokenCalls = gl.seen.filter((s) => s.url === "/oauth/token");
    assert.equal(tokenCalls.length, 1);
    assert.match(tokenCalls[0].body, /grant_type=refresh_token/);
    assert.doesNotMatch(tokenCalls[0].body, /client_secret/, "a public client sends no secret");
  } finally {
    gl.close();
  }
});

test("an API sign-in that GitLab refuses says so (and does not ask for the Chrome's sign-in)", async () => {
  const gl = await fakeGitlab();
  try {
    const { updateGitlabSettings } = await import("@/lib/gitlab/store");
    const { updateConnector } = await import("@/lib/connectors/store");
    updateGitlabSettings({ baseUrl: gl.base });
    updateConnector("gitlab", { driver: "api", authKind: "token", token: "stale" });
    const { syncGitlab } = await import("@/lib/gitlab/sync");
    const r = await syncGitlab();
    assert.equal(r.ok, false);
    assert.match(r.message, /doesn't accept the token/);
    const { listAttention } = await import("@/lib/attention");
    assert.ok(!(await listAttention()).some((a) => a.key === "login:gitlab"));
  } finally {
    gl.close();
  }
});
