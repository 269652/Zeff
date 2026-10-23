#!/usr/bin/env node
/**
 * The landing page (site/) onto GitHub Pages: `node scripts/site-deploy.mjs` (`--dry-run`: only where it would go).
 *
 * Zeff's own repo stays private (it holds personal data in its history) — the page goes to a public repo of its own that
 * holds nothing but site/: SITE_REPO (default 269652/zeff-site), served from its main branch at
 * https://<owner>.github.io/<repo>/. The repo and its Pages are made on the first run (the GitHub CLI, signed in); after that
 * each run commits site/ there (a .nojekyll so GitHub serves the files as they are) and pushes — no Actions needed in this repo.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const SITE = path.join(ROOT, "site");
const REPO = process.env.SITE_REPO || "269652/zeff-site";
const dry = process.argv.includes("--dry-run");

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const gh = (...args) => run("gh", args);
const tryGh = (...args) => {
  try {
    return gh(...args);
  } catch {
    return null;
  }
};

if (!fs.existsSync(path.join(SITE, "index.html"))) throw new Error("site/index.html is missing.");
const [owner, name] = REPO.split("/");
console.log(`Landing page → ${REPO} (https://${owner}.github.io/${name}/)`);
if (dry) process.exit(0);

// The public repo, made once.
if (!tryGh("repo", "view", REPO, "--json", "name")) {
  console.log(`Making the public repo ${REPO} …`);
  gh("repo", "create", REPO, "--public", "--description", "Zeff — the landing page", "--homepage", `https://${owner}.github.io/${name}/`);
}

// Its content: exactly site/ (plus .nojekyll), committed on main.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-site-"));
try {
  const url = `https://github.com/${REPO}.git`;
  const empty = !tryGh("api", `repos/${REPO}/branches/main`);
  if (empty) run("git", ["init", "-b", "main", tmp]);
  else run("git", ["clone", "--depth", "1", "--branch", "main", url, tmp]);
  for (const f of fs.readdirSync(tmp)) if (f !== ".git") fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
  fs.cpSync(SITE, tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, ".nojekyll"), "");
  run("git", ["-C", tmp, "add", "-A"]);
  const changed = run("git", ["-C", tmp, "status", "--porcelain"]);
  if (!changed) console.log("Nothing changed.");
  else {
    const head = run("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"]);
    run("git", ["-C", tmp, "-c", "user.name=Zeff site", "-c", "user.email=site@users.noreply.github.com", "commit", "-m", `Landing page from Zeff ${head}`]);
    if (empty) run("git", ["-C", tmp, "remote", "add", "origin", url]);
    run("git", ["-C", tmp, "push", "origin", "main"], { stdio: ["ignore", "pipe", "inherit"] });
    console.log("Pushed.");
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// Pages from main, made once.
if (!tryGh("api", `repos/${REPO}/pages`)) {
  console.log("Switching GitHub Pages on (main, /) …");
  gh("api", "-X", "POST", `repos/${REPO}/pages`, "-f", "source[branch]=main", "-f", "source[path]=/");
}
console.log(`Done: https://${owner}.github.io/${name}/ (GitHub takes a minute to build it).`);
