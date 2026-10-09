import { git } from "./git";

const tryGit = (cwd: string, args: string[]) => {
  try {
    return git(cwd, args, 20000);
  } catch {
    return "";
  }
};

/** A repo's web address, from its origin (https://host/group/repo — from an https or ssh remote). */
export function repoWebUrl(repo: string): string | null {
  const origin = tryGit(repo, ["remote", "get-url", "origin"]);
  if (!origin) return null;
  const ssh = /^(?:ssh:\/\/)?[^@\s]+@([^:/\s]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(origin);
  if (ssh && !/^https?:/i.test(origin)) return `https://${ssh[1]}/${ssh[2]}`;
  const https = /^(https?:\/\/)(?:[^@/]+@)?(.+?)(?:\.git)?\/?$/i.exec(origin);
  return https ? `${https[1]}${https[2]}` : null;
}

/** Where a pushed branch is on GitLab: its last commit there (as fetched), with a label. Null: not on origin. */
export function pushedLink(repo: string, branch: string): { url: string; label: string } | null {
  const name = branch.replace(/^origin\//, "");
  const sha = tryGit(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`]);
  const web = repoWebUrl(repo);
  if (!sha || !web) return null;
  return { url: `${web}/-/commit/${sha}`, label: `${name} @ ${sha.slice(0, 8)}` };
}
