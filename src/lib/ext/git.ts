import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Plugins from any git repository — a folder on this computer (../zeff-plugins), file://, or a remote (https / ssh) — read with git
 * itself: a bare copy of the repository is kept beside the plugins (<plugins>/.sources/<hash>.git), fetched when asked, and files are
 * read from its commits. A token (a private https repository) goes along as a header for that one command, never into a config.
 * Server only.
 */

const MAX_BUFFER = 64 * 1024 * 1024;

export type GitFile = { path: string; size: number };

function run(args: string[], opts: { cwd?: string; token?: string } = {}): Promise<Buffer> {
  const pre = opts.token ? ["-c", `http.extraHeader=Authorization: Bearer ${opts.token}`] : [];
  return new Promise((resolve, reject) =>
    execFile("git", [...pre, ...args], { cwd: opts.cwd, encoding: "buffer", maxBuffer: MAX_BUFFER, windowsHide: true, timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]}: ${String(stderr || err.message).trim().split("\n").slice(-3).join(" ")}`));
      else resolve(stdout);
    }),
  );
}

/** Whether `url` is read with git (not GitHub's web API): a path on this computer, file://, ssh, or a non-GitHub https address. */
export const isGitUrl = (url: string): boolean => {
  const u = String(url).trim();
  if (/^https:\/\/github\.com\//i.test(u)) return false;
  return /^(file:\/\/|ssh:\/\/|git@|https?:\/\/)/i.test(u) || path.isAbsolute(u) || /^\.\.?[\\/]/.test(u) || /^[A-Za-z]:[\\/]/.test(u);
};

/** A local path as git takes it (relative paths: from where Zeff runs). */
export const gitTarget = (url: string): string => {
  const u = url.trim();
  if (/^(file:\/\/|ssh:\/\/|git@|https?:\/\/)/i.test(u)) return u;
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), u);
};

/** Where the bare copy of a repository is kept. */
export const mirrorDir = (root: string, url: string): string => path.join(root, ".sources", `${crypto.createHash("sha1").update(gitTarget(url).toLowerCase()).digest("hex").slice(0, 16)}.git`);

/** The repository fetched (cloned the first time): its branch's newest commit. No branch: the repository's own default. */
export async function fetchRepo(root: string, url: string, branch?: string, token?: string): Promise<{ dir: string; branch: string; sha: string }> {
  const dir = mirrorDir(root, url);
  if (!fs.existsSync(path.join(dir, "HEAD"))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await run(["clone", "--bare", "--quiet", gitTarget(url), dir], { token });
  } else {
    await run(["fetch", "--quiet", "--prune", "origin", "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"], { cwd: dir, token });
  }
  const b = branch || (await run(["symbolic-ref", "--short", "HEAD"], { cwd: dir })).toString("utf8").trim() || "main";
  if (!/^[\w./-]{1,100}$/.test(b)) throw new Error("That is no branch name.");
  const sha = (await run(["rev-parse", "--verify", `refs/heads/${b}^{commit}`], { cwd: dir }).catch(() => {
    throw new Error(`No branch “${b}”.`);
  }))
    .toString("utf8")
    .trim();
  return { dir, branch: b, sha };
}

/** Every file of a commit, with its size. */
export async function listFiles(dir: string, sha: string): Promise<GitFile[]> {
  const out = (await run(["ls-tree", "-r", "-l", "-z", sha], { cwd: dir })).toString("utf8");
  return out
    .split("\0")
    .filter(Boolean)
    .flatMap((line) => {
      // <mode> blob <sha> <size>\t<path>
      const tab = line.indexOf("\t");
      const meta = line.slice(0, tab).trim().split(/\s+/);
      return meta[1] === "blob" ? [{ path: line.slice(tab + 1), size: Number(meta[3]) || 0 }] : [];
    });
}

/** A file as it is in a commit (null: not there). */
export async function readFile(dir: string, sha: string, file: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("No commit.");
  return run(["show", `${sha}:${file}`], { cwd: dir }).catch(() => null);
}

/** Whether a commit is there (an older one may have gone with a force-push). */
export const hasCommit = async (dir: string, sha: string): Promise<boolean> => /^[0-9a-f]{7,40}$/i.test(sha) && !!(await run(["cat-file", "-e", `${sha}^{commit}`], { cwd: dir }).then(() => true, () => false));

/** The commits between two (newest first) that touched `under` — what an update brings, told as its notes. */
export async function commitsBetween(dir: string, from: string | null, to: string, under: string, max = 30): Promise<{ sha: string; subject: string; at: string; author: string }[]> {
  const range = from && (await hasCommit(dir, from)) ? `${from}..${to}` : to;
  const out = (await run(["log", `--max-count=${max}`, "--format=%H%x1f%s%x1f%aI%x1f%an%x1e", range, "--", under || "."], { cwd: dir }).catch(() => Buffer.from(""))).toString("utf8");
  return out
    .split("\x1e")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha, subject, at, author] = r.split("\x1f");
      return { sha, subject, at, author };
    });
}

/**
 * Git's own three-way merge of one text (git merge-file): what changed between `base` and each side, put together. `conflicts`: how many
 * places both changed differently — there the text holds both, between <<<<<<< mine / ======= / >>>>>>> theirs (with ||||||| base).
 */
export async function mergeText(base: string, mine: string, theirs: string, opts: { /** Where both changed: mine is kept (no markers; `conflicts` still counts them). */ favorMine?: boolean } = {}): Promise<{ text: string; conflicts: number }> {
  if (opts.favorMine) {
    const counted = await mergeText(base, mine, theirs);
    if (!counted.conflicts) return counted;
    return { text: (await mergeFile(base, mine, theirs, ["--ours"])).text, conflicts: counted.conflicts };
  }
  return mergeFile(base, mine, theirs, []);
}

async function mergeFile(base: string, mine: string, theirs: string, extra: string[]): Promise<{ text: string; conflicts: number }> {
  const tmp = fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "zeff-merge-"));
  try {
    const [m, b, t] = ["mine", "base", "theirs"].map((n) => path.join(tmp, n));
    fs.writeFileSync(m, mine);
    fs.writeFileSync(b, base);
    fs.writeFileSync(t, theirs);
    return await new Promise((resolve, reject) =>
      execFile("git", ["merge-file", "-p", ...(extra.length ? extra : ["--diff3"]), "-L", "mine", "-L", "base", "-L", "theirs", m, b, t], { encoding: "utf8", maxBuffer: MAX_BUFFER, windowsHide: true }, (err, stdout) => {
        // (its exit code is the number of conflicts; above 127 something went wrong)
        const code = err ? Number((err as { code?: number }).code) : 0;
        if (err && !(code > 0 && code < 128)) return reject(new Error(`git merge-file: ${err.message}`));
        resolve({ text: stdout, conflicts: code });
      }),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
