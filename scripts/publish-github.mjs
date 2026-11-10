#!/usr/bin/env node
/**
 * Zeff's history onto GitHub, scrubbed: `npm run publish:github` (`--dry-run`: rewrite and check, push nothing;
 * `--force`: overwrite what is there, needed only when the rules changed).
 *
 * The checkout keeps its history as it is; GitHub gets a copy rewritten by git filter-repo with the rules in
 * integrations/booking/publish/scrub.txt (private, beside the booking systems: the rules name what they remove).
 * Each rule (`regex:<python regex>==><replacement>`) rewrites file contents, commit messages and file paths. filter-repo
 * is deterministic, so the same history gives the same commits: after the first push each run is a fast-forward.
 * Before pushing, every blob, commit message and path of the copy is checked against the rules — one match, no push.
 *
 * Pushed: master and the v* tags, to GITHUB_REPO (default 269652/Zeff).
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1")), "..");
const RULES = path.join(ROOT, "integrations", "booking", "publish", "scrub.txt");
const REPO = process.env.GITHUB_REPO || "269652/Zeff";
const dry = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 30 }).trim();

if (!fs.existsSync(RULES)) throw new Error(`No rules: ${RULES} (is integrations/booking mounted?)`);
const rules = fs
  .readFileSync(RULES, "utf8")
  .split(/\r?\n/)
  .filter((l) => l.startsWith("regex:"))
  .map((l) => {
    const [from, to] = l.slice(6).split("==>");
    return { from, to, re: new RegExp(from, "g") };
  });

// A fresh copy of master and the tags (filter-repo rewrites only a fresh clone).
const work = path.join(os.tmpdir(), "zeff-publish");
fs.rmSync(work, { recursive: true, force: true });
git(ROOT, "clone", "--no-local", "--quiet", "--single-branch", "--branch", "master", ROOT, work);
git(work, "fetch", "--quiet", "origin", "refs/tags/v*:refs/tags/v*");
git(work, "remote", "remove", "origin");

// Paths: the same rules, applied to each path.
const callback = [
  "import re",
  `rules = ${JSON.stringify(rules.map((r) => [r.from, r.to]))}`,
  "s = filename.decode('utf-8')",
  "for a, b in rules: s = re.sub(a, b, s)",
  "return s.encode('utf-8')",
].join("\n");
execFileSync("git", ["filter-repo", "--force", "--quiet", "--replace-text", RULES, "--replace-message", RULES, "--filename-callback", callback], {
  cwd: work,
  stdio: "inherit",
});

// The check: nothing a rule matches is left — in contents, messages or paths.
const hits = new Map();
const note = (what, where) => {
  if (!hits.has(what)) hits.set(what, new Set());
  if (hits.get(what).size < 5) hits.get(what).add(where);
};
const objects = git(work, "rev-list", "--objects", "--all").split("\n");
const pathOf = new Map();
for (const line of objects) {
  const [sha, ...rest] = line.split(" ");
  const p = rest.join(" ");
  if (!pathOf.has(sha)) pathOf.set(sha, p);
  for (const r of rules) if (p && new RegExp(r.from).test(p)) note(r.from, `path ${p}`);
}
await new Promise((resolve, reject) => {
  const cat = spawn("git", ["cat-file", "--batch"], { cwd: work, stdio: ["pipe", "pipe", "inherit"] });
  const shas = [...pathOf.keys()];
  let buf = Buffer.alloc(0);
  let i = 0;
  let want = null;
  cat.stdout.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (!want) {
        const nl = buf.indexOf(10);
        if (nl < 0) return;
        const [sha, type, size] = buf.subarray(0, nl).toString().split(" ");
        buf = buf.subarray(nl + 1);
        want = { sha, type, size: Number(size) };
      }
      if (buf.length < want.size + 1) return;
      const data = buf.subarray(0, want.size);
      buf = buf.subarray(want.size + 1);
      if (want.type === "blob" || want.type === "commit") {
        const text = data.toString("utf8");
        for (const r of rules) {
          r.re.lastIndex = 0;
          if (r.re.test(text)) note(r.from, want.type === "commit" ? `message of ${want.sha.slice(0, 8)}` : pathOf.get(want.sha) || want.sha);
        }
      }
      want = null;
      if (++i === shas.length) cat.stdin.end();
    }
  });
  cat.on("close", (code) => (code ? reject(new Error(`git cat-file: ${code}`)) : resolve()));
  for (const s of shas) cat.stdin.write(s + "\n");
});
if (hits.size) {
  for (const [what, where] of hits) console.error(`Still there: /${what}/ — ${[...where].join(", ")}`);
  throw new Error("The scrubbed copy still matches the rules; nothing pushed.");
}
console.log(`Scrubbed and checked: ${objects.length} objects, master ${git(work, "rev-parse", "--short", "master")}.`);
if (dry) {
  console.log(`Dry run — the copy is in ${work}`);
  process.exit(0);
}

const url = `git@github.com:${REPO}.git`;
execFileSync("git", ["push", ...(force ? ["--force"] : []), url, "master", "--tags"], { cwd: work, stdio: "inherit" });
console.log(`Pushed to https://github.com/${REPO}`);
