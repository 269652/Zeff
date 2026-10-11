import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BASE_DIR } from "@/db/accounts";

/**
 * What lets a program a plugin starts (an event hook, an MCP server) call Zeff's extension API as
 * that plugin: a token = "<plugin id>.<HMAC of the id>", the secret kept in <data>/ext-secret
 * (made on first use, owner-only). It's in that program's environment as ZEFF_EXT_TOKEN. A panel
 * needs none: its frame is sandboxed, and Zeff's own page speaks for it (see ExtFrame).
 */

const g = globalThis as { __zeffExtSecret?: string };

function secret(): string {
  if (g.__zeffExtSecret) return g.__zeffExtSecret;
  const file = path.join(/*turbopackIgnore: true*/ BASE_DIR, "ext-secret");
  try {
    g.__zeffExtSecret = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim();
  } catch {
    // first use
  }
  if (!g.__zeffExtSecret || g.__zeffExtSecret.length < 32) {
    g.__zeffExtSecret = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(/*turbopackIgnore: true*/ BASE_DIR, { recursive: true });
    fs.writeFileSync(/*turbopackIgnore: true*/ file, g.__zeffExtSecret, { mode: 0o600 });
  }
  return g.__zeffExtSecret;
}

const sign = (id: string) => crypto.createHmac("sha256", secret()).update(`zeff-ext:${id}`).digest("hex");

export const tokenFor = (id: string): string => `${id}.${sign(id)}`;

/** The plugin id a token is for, or null when it isn't a token Zeff made. */
export function pluginOfToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(id));
  return given.length === want.length && crypto.timingSafeEqual(given, want) ? id : null;
}
