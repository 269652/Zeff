/**
 * Each account's tokens: what an agent (or the knowledge server) shows to reach that account's door — its MCP endpoint, its
 * knowledge export. One account's token opens only that account's: an agent working on a private todo is given the private
 * token, and the work account's endpoint turns it away. Made from one secret of this computer's Zeff (data/account-secret,
 * created at the first need) — the same every time, nothing to keep per account. Server only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BASE_DIR } from "@/db/accounts";

const SECRET_FILE = path.join(BASE_DIR, "account-secret");
const state = globalThis as { __zeffAccountSecret?: { file: string; key: Buffer } };

function secret(): Buffer {
  if (state.__zeffAccountSecret?.file === SECRET_FILE) return state.__zeffAccountSecret.key;
  let hex = "";
  try {
    hex = fs.readFileSync(SECRET_FILE, "utf8").trim();
  } catch {
    // none yet
  }
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    hex = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(BASE_DIR, { recursive: true });
    // Another process may have made it meanwhile: theirs wins (wx), so both use the same.
    try {
      fs.writeFileSync(SECRET_FILE, hex, { mode: 0o600, flag: "wx" });
    } catch {
      hex = fs.readFileSync(SECRET_FILE, "utf8").trim();
    }
  }
  const key = Buffer.from(hex, "hex");
  state.__zeffAccountSecret = { file: SECRET_FILE, key };
  return key;
}

export type TokenPurpose = "mcp" | "knowledge";

/** The account's token for a door ("zm_…" for MCP, "zk_…" for the knowledge export). */
export function accountToken(purpose: TokenPurpose, account: string): string {
  const mac = crypto.createHmac("sha256", secret()).update(`${purpose}:${account}`).digest("base64url").slice(0, 40);
  return `${purpose === "mcp" ? "zm" : "zk"}_${mac}`;
}

/** Whether a request's "Authorization: Bearer …" is that account's token (in constant time). */
export function bearerIs(header: string | null, purpose: TokenPurpose, account: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length).trim());
  const want = Buffer.from(accountToken(purpose, account));
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}
