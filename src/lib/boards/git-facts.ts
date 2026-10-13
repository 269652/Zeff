import { gitText } from "@/lib/git";
import { listRepos, repoForTicket } from "@/lib/repos";

/** git in a folder, asynchronously: its output (trimmed), or "" when it fails. */
const git = (cwd: string, args: string[], timeout = 30000) => gitText(cwd, args, { timeout, maxBuffer: 4 * 1024 * 1024 });

const stat = (s: string) =>
  s
    .replace(/ changed| insertions?| deletions?/g, "")
    .replace(/\(\+\)|\(-\)/g, (m) => (m === "(+)" ? "+" : "-"))
    .trim();

/**
 * What git says about each ticket, as prompt lines — from the repo the ticket's work goes to
 * (fetched first; only reads otherwise): the commits naming it on the default branch (merged),
 * and the branches naming it — merged, or how far ahead and what they change. Tickets without
 * a repo aren't told.
 */
export async function gitFacts(keys: string[]): Promise<Record<string, string[]>> {
  const repos = listRepos();
  const byRepo = new Map<string, { name: string; keys: string[] }>();
  for (const key of new Set(keys)) {
    const m = repoForTicket(key, repos);
    if (!m) continue;
    const r = byRepo.get(m.repo.path) ?? { name: m.repo.name, keys: [] };
    r.keys.push(key);
    byRepo.set(m.repo.path, r);
  }
  const out: Record<string, string[]> = {};
  await Promise.all(
    [...byRepo.entries()].map(async ([dir, { name, keys: list }]) => {
      // What's on GitLab now (merges done there) — unreachable (VPN), what was fetched last.
      await git(dir, ["fetch", "origin", "--quiet"], 45000);
      const main = (await git(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])) || "origin/main";
      const refs = (await git(dir, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)|%(committerdate:short)|%(subject)", "refs/heads", "refs/remotes"]))
        .split("\n")
        .map((l) => l.split("|"))
        // Not the default branch itself (remote or local), only work branches.
        .filter(([r]) => r && r !== main && r !== main.replace(/^origin\//, "") && r !== "origin/HEAD" && r !== "origin");
      const merged = new Set((await git(dir, ["for-each-ref", "--merged", main, "--format=%(refname:short)", "refs/heads", "refs/remotes"])).split("\n").filter(Boolean));
      for (const key of list) {
        const named = new RegExp(`(^|[^A-Za-z0-9])${key}(?![0-9])`, "i");
        const lines: string[] = [];
        // Commits naming it on the default branch, newest first, with what they change.
        const log = await git(dir, ["log", main, "-i", `--grep=${key}`, "--since=180.days", "-n", "6", "--date=short", "--format=@@%h %ad %an: %s", "--shortstat"]);
        for (const chunk of log.split("@@").map((c) => c.trim()).filter(Boolean)) {
          const [head, ...rest] = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
          lines.push(`Auf ${main}: ${head}${rest.length ? ` (${stat(rest.join(" "))})` : ""}`);
        }
        // Branches naming it: merged, or ahead — and what they change.
        const own = refs.filter(([r, , subject]) => named.test(r) || named.test(subject ?? "")).slice(0, 6);
        for (const [ref, date, subject] of own) {
          if (merged.has(ref)) {
            lines.push(`Branch ${ref}: in ${main} gemergt (letzter Commit ${date}: ${subject})`);
            continue;
          }
          const ahead = await git(dir, ["rev-list", "--count", `${main}..${ref}`]);
          const diff = await git(dir, ["diff", "--shortstat", `${main}...${ref}`]);
          lines.push(`Branch ${ref}: ${ahead || "?"} Commit(s) vor ${main}, nicht gemergt — letzter ${date}: ${subject}${diff ? ` (${stat(diff)})` : ""}`);
        }
        out[key] = lines.length ? [`Git (${name}):`, ...lines.map((l) => `- ${l}`)] : [`Git (${name}): keine Commits auf ${main} und keine Branches, die ${key} nennen.`];
      }
    }),
  );
  return out;
}
