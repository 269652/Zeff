/**
 * Signed plugin releases (src/lib/kernel/release.ts, docs/plugins/repository.md#signed-releases).
 *
 *   npm run release:keygen -- <name> [<folder>]   a new key pair: the private key written to <folder> (default: ~/.zeff-release),
 *                                                   never into a repository; the public key printed, for RELEASE_KEYS
 *   npm run release:sign -- <plugin folder> <private key file> <name>
 *                                                   zeff-release.json written into the folder: every file's SHA-256, signed
 *
 * Sign after the last change and raise the version first: a file changed after signing makes the release refused.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeReleaseKey, RELEASE_FILE, signRelease } from "../src/lib/kernel/release";

const [cmd, ...args] = process.argv.slice(2);

function files(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (d: string, rel: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile() && r !== RELEASE_FILE) out.set(r, fs.readFileSync(path.join(d, e.name)));
    }
  };
  walk(dir, "");
  return out;
}

if (cmd === "keygen") {
  const name = args[0];
  if (!name || !/^[a-z0-9-]{2,40}$/.test(name)) throw new Error("Give the key a name: lower-case letters, digits, dashes (zeff-2026).");
  const folder = path.resolve(args[1] ?? path.join(os.homedir(), ".zeff-release"));
  const file = path.join(folder, `${name}.pem`);
  if (fs.existsSync(file)) throw new Error(`${file} exists already — a key is never overwritten.`);
  const k = makeReleaseKey();
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, k.privateKeyPem, { mode: 0o600 });
  console.log(`Private key: ${file} — keep it there, never in a repository.\n`);
  console.log(`Put this into RELEASE_KEYS (src/lib/kernel/release.ts):\n\n  ${JSON.stringify(name)}: ${JSON.stringify(k.publicKeyPem)},\n`);
} else if (cmd === "sign") {
  const [dir, keyFile, name] = args;
  if (!dir || !keyFile || !name) throw new Error("release:sign -- <plugin folder> <private key file> <key name>");
  // A plugin (zeff-plugin.json) or a patch to Zeff itself (zeff-mod.json, lib/mods/feed.ts).
  const file = ["zeff-plugin.json", "zeff-mod.json"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!file) throw new Error(`${dir} has no zeff-plugin.json or zeff-mod.json.`);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as { id: string; version?: string };
  const release = signRelease(manifest.id, manifest.version ?? "0.0.0", files(dir), fs.readFileSync(keyFile, "utf8"), name);
  fs.writeFileSync(path.join(dir, RELEASE_FILE), JSON.stringify(release, null, 2) + "\n");
  console.log(`Signed ${manifest.id} ${release.version}: ${Object.keys(release.files).length} files, key “${name}”.`);
} else {
  console.log("npm run release:keygen -- <name> [<folder>]\nnpm run release:sign -- <plugin folder> <private key file> <name>");
}
