#!/usr/bin/env node
/**
 * The phone companion (companion/app) onto GitHub Pages at https://app.getzeff.com:
 * `node scripts/companion-deploy.mjs` (`--dry-run`: only where it would go).
 *
 * Like the landing page (scripts/site-deploy.mjs): a public repo of its own that holds nothing but the app — COMPANION_REPO
 * (default 269652/zeff-app) — made on the first run with the GitHub CLI (signed in), with Pages from main and the custom
 * domain COMPANION_DOMAIN (default app.getzeff.com, written as CNAME). The domain also needs a DNS record at the registrar:
 * CNAME app → <owner>.github.io (GitHub then issues the HTTPS certificate; WebRTC and the service worker need HTTPS).
 * The app is static and has no secrets: a phone's pairing lives only in its own storage.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1")), "..");
const APP = path.join(ROOT, "companion", "app");
const REPO = process.env.COMPANION_REPO || "269652/zeff-app";
const DOMAIN = process.env.COMPANION_DOMAIN ?? "app.getzeff.com";
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

if (!fs.existsSync(path.join(APP, "index.html"))) throw new Error("companion/app/index.html is missing.");
// The offline part (companion/offline) bundled fresh into the app first.
execFileSync(process.execPath, [path.join(ROOT, "scripts", "companion-build.mjs")], { stdio: "inherit" });
const [owner, name] = REPO.split("/");
const home = DOMAIN ? `https://${DOMAIN}/` : `https://${owner}.github.io/${name}/`;
console.log(`Phone companion → ${REPO} (${home})`);
if (dry) process.exit(0);

if (!tryGh("repo", "view", REPO, "--json", "name")) {
  console.log(`Making the public repo ${REPO} …`);
  gh("repo", "create", REPO, "--public", "--description", "Zeff on your phone — your todos, synced with Zeff on your PC over WebRTC", "--homepage", home);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zeff-app-"));
try {
  const url = `https://github.com/${REPO}.git`;
  const empty = !tryGh("api", `repos/${REPO}/branches/main`);
  if (empty) run("git", ["init", "-b", "main", tmp]);
  else run("git", ["clone", "--depth", "1", "--branch", "main", url, tmp]);
  for (const f of fs.readdirSync(tmp)) if (f !== ".git") fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
  fs.cpSync(APP, tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, ".nojekyll"), "");
  // Any address (app.getzeff.com/todos, /chat …) is the app — on a first visit, before its service worker is there.
  fs.copyFileSync(path.join(APP, "index.html"), path.join(tmp, "404.html"));
  if (DOMAIN) fs.writeFileSync(path.join(tmp, "CNAME"), `${DOMAIN}\n`);
  for (const f of ["LICENSE"]) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, `${f}.txt`));
  run("git", ["-C", tmp, "add", "-A"]);
  if (!run("git", ["-C", tmp, "status", "--porcelain"])) console.log("Nothing changed.");
  else {
    const head = run("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"]);
    run("git", ["-C", tmp, "-c", "user.name=Zeff app", "-c", "user.email=app@users.noreply.github.com", "commit", "-m", `Phone companion from Zeff ${head}`]);
    if (empty) run("git", ["-C", tmp, "remote", "add", "origin", url]);
    run("git", ["-C", tmp, "push", "origin", "main"], { stdio: ["ignore", "pipe", "inherit"] });
    console.log("Pushed.");
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (!tryGh("api", `repos/${REPO}/pages`)) {
  console.log("Switching GitHub Pages on (main, /) …");
  gh("api", "-X", "POST", `repos/${REPO}/pages`, "-f", "source[branch]=main", "-f", "source[path]=/");
}
if (DOMAIN) {
  tryGh("api", "-X", "PUT", `repos/${REPO}/pages`, "-f", `cname=${DOMAIN}`);
  // HTTPS can only be enforced once GitHub has the certificate (after the DNS record is there): tried, quietly.
  if (tryGh("api", "-X", "PUT", `repos/${REPO}/pages`, "-F", "https_enforced=true") === null)
    console.log(`HTTPS not enforced yet — once the DNS record "CNAME ${DOMAIN.split(".")[0]} → ${owner}.github.io" is in place and GitHub issued the certificate, run this again.`);
}
console.log(`Done: ${home} (GitHub takes a minute to build it).`);
