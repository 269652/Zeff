import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReport, redact, tail } from "@/lib/diagnostics";

test("redact blacks out tokens, passwords, emails and the user folder — and leaves the rest readable", () => {
  const text = [
    "GET https://jira.example.com/rest?x=1 Authorization: Bearer abcdefghijklmnop1234567890",
    'login failed {"password":"hunter2hunter2","user":"mom@example.com"}',
    "opened C:\\Users\\moms\\AppData\\Local\\Zeff\\data and /home/moms/x",
    "key ghp_abcdefghijklmnopqrstuvwxyz0123456789 and a blob " + "A1b2".repeat(12),
    "Sync Jira failed: timeout after 30s",
  ].join("\n");
  const out = redact(text, "C:\\Users\\moms", "moms");
  assert.doesNotMatch(out, /abcdefghijklmnop1234567890|hunter2|mom@example|moms|ghp_|A1b2A1b2/);
  assert.match(out, /Sync Jira failed: timeout after 30s/);
  assert.match(out, /~\\AppData\\Local\\Zeff/);
});

test("tail returns the end of a log, and nothing for a missing file", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zeff-diag-")), "x.log");
  fs.writeFileSync(f, Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n"));
  const t = tail(f, 3);
  assert.equal(t, "line 497\nline 498\nline 499");
  assert.equal(tail(f + ".none"), "");
});

test("the report lists programs, plugins, sign-ins, syncs and the log ends — redacted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-diag-"));
  fs.writeFileSync(path.join(dir, "zeff.log"), "boot ok\nerror for mom@example.com token=abcdef123456");
  const r = buildReport({
    version: "1.2.3",
    data: dir,
    plugins: ["todos", "jira"],
    prerequisites: [{ label: "Git", found: "C:\git.exe" }, { label: "uv (uvx)", found: null }],
    syncs: [{ label: "Jira", lastAt: "2026-10-12T10:00:00Z", lastOk: false, lastMessage: "401 unauthorized" }],
    logins: [{ label: "Teams", state: "login" }],
    attention: ["Teams: sign-in needed"],
    logDir: dir,
    now: new Date("2026-10-12T12:00:00Z"),
  });
  for (const s of ["Zeff 1.2.3", "✓ Git", "✗ uv (uvx) — not found", "todos, jira", "Teams: login", "✗ Jira", "401 unauthorized", "Log: zeff.log", "boot ok"]) assert.ok(r.includes(s), s);
  assert.doesNotMatch(r, /mom@example|abcdef123456/);
});
