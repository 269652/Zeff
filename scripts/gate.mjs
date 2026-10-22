#!/usr/bin/env node
/**
 * The gate's config (src/lib/gate.ts) — data/gate.json next to the database (DATABASE_PATH, else ./data):
 *
 *   node scripts/gate.mjs password        the password, read from stdin (a new secret: every session ends)
 *   node scripts/gate.mjs token <name>    a new token for a client (the bridge, an MCP client) — printed once, kept as a hash
 *   node scripts/gate.mjs revoke <name>   that token gone
 *   node scripts/gate.mjs logout-all      every session ends (the tokens stay)
 *   node scripts/gate.mjs list            the tokens' names
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const file = path.join(path.dirname(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "zeff.db")), "gate.json");
const read = () => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { tokens: [] };
  }
};
const write = (cfg) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.part`, file);
};
const secret = () => crypto.randomBytes(32).toString("base64url");
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("base64url");

async function stdin() {
  let s = "";
  for await (const c of process.stdin) s += c;
  return s.replace(/\r?\n$/, "");
}

const [cmd, name] = process.argv.slice(2);
const cfg = read();
cfg.tokens ??= [];
switch (cmd) {
  case "password": {
    const pw = await stdin();
    if (pw.length < 12) throw new Error("at least 12 characters, please");
    const salt = crypto.randomBytes(16);
    cfg.password = `scrypt$${salt.toString("base64url")}$${crypto.scryptSync(pw, salt, 32).toString("base64url")}`;
    cfg.secret = secret();
    write(cfg);
    console.log(`password set (${file}); every session has ended`);
    break;
  }
  case "token": {
    if (!name) throw new Error("a name, please");
    if (!cfg.secret) cfg.secret = secret();
    const token = `zg_${crypto.randomBytes(24).toString("base64url")}`;
    cfg.tokens = [...cfg.tokens.filter((t) => t.name !== name), { name, hash: hashToken(token) }];
    write(cfg);
    console.log(token);
    break;
  }
  case "revoke":
    cfg.tokens = cfg.tokens.filter((t) => t.name !== name);
    write(cfg);
    console.log(`${name} revoked`);
    break;
  case "logout-all":
    cfg.notBefore = Date.now();
    write(cfg);
    console.log("every session has ended");
    break;
  case "list":
    console.log(cfg.tokens.map((t) => t.name).join("\n") || "(no tokens)");
    break;
  default:
    console.error("usage: gate.mjs password | token <name> | revoke <name> | logout-all | list");
    process.exit(2);
}
