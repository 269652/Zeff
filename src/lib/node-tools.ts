import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { zeffUserDir } from "../../scripts/browser-find.mjs";

/**
 * Programs that come with npm (Codex, for ChatGPT) on a PC that has no Node: Zeff downloads the official
 * portable Node (it has npm) into its own folder and installs them there with `--prefix`. No admin, no
 * installer, nothing on the PATH — Zeff finds them where they are. Server only.
 */
export const toolsDir = () => path.join(zeffUserDir(), "tools");
/** npm's `--prefix` for the programs Zeff installs: Windows puts them in its root, the others in bin/ and lib/. */
export const npmPrefix = () => path.join(toolsDir(), "npm");
/** The folders such a program can be found in (Windows: the root; else bin/ and lib/ — lib/node_modules/…). */
export const npmToolDirs = () => [npmPrefix(), path.join(npmPrefix(), "bin"), path.join(npmPrefix(), "lib")];

export type NodeRelease = { version: string; lts: string | false; files: string[] };
export type NodeDist = { version: string; file: string; url: string; folder: string };

/** Which download of Node's index.json fits this system: the newest LTS release with a portable archive. */
export function pickNodeDist(index: NodeRelease[], platform: string, arch: string): NodeDist | null {
  const a = arch === "arm64" ? "arm64" : "x64";
  const key = platform === "win32" ? `win-${a}-zip` : platform === "darwin" ? `osx-${a}-tar` : `linux-${a}`;
  const rel = index.find((r) => r.lts && r.files.includes(key));
  if (!rel) return null;
  const folder = `node-${rel.version}-${platform === "win32" ? "win" : platform === "darwin" ? "darwin" : "linux"}-${a}`;
  const file = `${folder}.${platform === "win32" ? "zip" : "tar.gz"}`;
  return { version: rel.version, file, url: `https://nodejs.org/dist/${rel.version}/${file}`, folder };
}

/** Node's program and npm's entry inside an unpacked release. */
export const nodeLayout = (home: string, platform: string = process.platform) =>
  platform === "win32"
    ? { node: path.join(home, "node.exe"), npm: path.join(home, "node_modules", "npm", "bin", "npm-cli.js") }
    : { node: path.join(home, "bin", "node"), npm: path.join(home, "lib", "node_modules", "npm", "bin", "npm-cli.js") };

type Run = (command: string, args: string[], env?: Record<string, string>) => Promise<{ ok: boolean; out: string }>;
const run: Run = (command, args, env) =>
  new Promise((resolve) => execFile(command, args, { timeout: 15 * 60000, windowsHide: true, maxBuffer: 8_000_000, env: { ...process.env, ...env } }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}\n${stderr}`.trim().slice(-400) })));

export type NodeDeps = {
  fetchJson?: (url: string) => Promise<unknown>;
  download?: (url: string, to: string) => Promise<void>;
  run?: Run;
  platform?: string;
  arch?: string;
  dir?: string;
};

const defaultFetchJson = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};
const defaultDownload = async (url: string, to: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.writeFileSync(/*turbopackIgnore: true*/ to, Buffer.from(await r.arrayBuffer()));
};

/** The portable Node in Zeff's tools folder — downloaded and unpacked when it isn't there yet. Returns its program and npm entry. */
export async function ensurePortableNode(deps: NodeDeps = {}): Promise<{ node: string; npm: string }> {
  const platform = deps.platform ?? process.platform;
  const dir = deps.dir ?? toolsDir();
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const have = fs.readdirSync(/*turbopackIgnore: true*/ dir).find((d) => /^node-v[\d.]+-/.test(d) && fs.existsSync(/*turbopackIgnore: true*/ nodeLayout(path.join(dir, d), platform).npm));
  if (have) return nodeLayout(path.join(dir, have), platform);
  const dist = pickNodeDist((await (deps.fetchJson ?? defaultFetchJson)("https://nodejs.org/dist/index.json")) as NodeRelease[], platform, deps.arch ?? process.arch);
  if (!dist) throw new Error("nodejs.org has no portable Node for this system.");
  const archive = path.join(dir, dist.file);
  await (deps.download ?? defaultDownload)(dist.url, archive);
  const r = await (deps.run ?? run)(
    ...((platform === "win32"
      ? ["powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${dir}' -Force`]]
      : ["tar", ["-xzf", archive, "-C", dir]]) as [string, string[]]),
  );
  fs.rmSync(/*turbopackIgnore: true*/ archive, { force: true });
  const layout = nodeLayout(path.join(dir, dist.folder), platform);
  if (!fs.existsSync(/*turbopackIgnore: true*/ layout.npm)) throw new Error(`Node couldn't be unpacked: ${r.out.replace(/\s+/g, " ").slice(-160)}`);
  return layout;
}

/** Installs an npm package (globally, into Zeff's own prefix) with the portable Node. */
export async function npmInstall(pkg: string, deps: NodeDeps = {}): Promise<{ ok: boolean; out: string }> {
  try {
    const { node, npm } = await ensurePortableNode(deps);
    const prefix = path.join(deps.dir ?? toolsDir(), "npm");
    fs.mkdirSync(/*turbopackIgnore: true*/ prefix, { recursive: true });
    return await (deps.run ?? run)(node, [npm, "install", "-g", pkg, "--prefix", prefix, "--no-audit", "--no-fund"], { PATH: `${path.dirname(node)}${path.delimiter}${process.env.PATH ?? ""}` });
  } catch (err) {
    return { ok: false, out: err instanceof Error ? err.message : String(err) };
  }
}

export const installCodex = (deps: NodeDeps = {}) => npmInstall("@openai/codex", deps);
