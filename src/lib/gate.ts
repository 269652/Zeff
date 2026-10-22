import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The gate: Zeff on a server, reachable from the internet (ZEFF_GATE=1). The edge (Caddy, on 443) marks every request it passes
 * on with the header x-zeff-edge — and removes one a client sent. Every such request needs a session (the cookie, after the
 * password on the login page) or a token (Authorization: Bearer …, for the bridge, an MCP client, a script) — a browser, an
 * agent, anything. Requests that did not come through the edge (the sync host, the work host, the workers' MCP calls inside the
 * server: Zeff listens on 127.0.0.1 only) pass as ever.
 *
 *   data/gate.json  {secret, password, tokens: [{name, hash}], notBefore?}   — scripts/gate.mjs writes it
 *
 * No config, no way in from the edge (deny) — the server is closed until a password is set.
 */

export type GateConfig = {
  secret: string;
  /** "scrypt$<salt>$<hash>" (base64url). */
  password: string;
  tokens: { name: string; hash: string }[];
  /** Sessions issued before this (ms) are over — "sign out everywhere". */
  notBefore?: number;
};

export const GATE_COOKIE = "zeff_gate";
export const GATE_SESSION_MS = 30 * 86_400_000;
export const EDGE_HEADER = "x-zeff-edge";
export const gateOn = (): boolean => process.env.ZEFF_GATE === "1";

const dataDir = () => path.dirname(process.env.DATABASE_PATH ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "zeff.db"));
export const gateFile = () => path.join(dataDir(), "gate.json");

let cached: { at: number; cfg: GateConfig | null } | null = null;
export function readGate(): GateConfig | null {
  const now = Date.now();
  if (cached && now - cached.at < 2000) return cached.cfg;
  let cfg: GateConfig | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(gateFile(), "utf8")) as Partial<GateConfig>;
    if (typeof raw.secret === "string" && raw.secret.length >= 32 && typeof raw.password === "string") cfg = { secret: raw.secret, password: raw.password, tokens: Array.isArray(raw.tokens) ? raw.tokens : [], ...(typeof raw.notBefore === "number" ? { notBefore: raw.notBefore } : {}) };
  } catch {
    // none: closed
  }
  cached = { at: now, cfg };
  return cfg;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${scryptSync(pw, salt, 32).toString("base64url")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  return same(scryptSync(pw, Buffer.from(salt, "base64url"), 32).toString("base64url"), hash);
}

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("base64url");
export const newToken = (): string => `zg_${randomBytes(24).toString("base64url")}`;
export const newGateSecret = (): string => randomBytes(32).toString("base64url");

export function signGate(secret: string, iat: number): string {
  return `${iat}.${createHmac("sha256", secret).update(`zeff-gate.${iat}`).digest("base64url")}`;
}

function sessionLive(value: string | undefined, cfg: GateConfig, now: number): boolean {
  if (!value) return false;
  const iat = Number(value.slice(0, value.indexOf(".")));
  if (!Number.isFinite(iat) || iat <= 0) return false;
  if (!same(signGate(cfg.secret, iat), value)) return false;
  if (now - iat > GATE_SESSION_MS || iat > now + 60_000) return false;
  return !(cfg.notBefore && iat < cfg.notBefore);
}

/**
 * What to do with a request: pass, the login (page or 401), or deny (no config — closed). Pure: the request's parts, the config
 * and the clock are passed in.
 */
export function gateCheck(r: { edge: boolean; path: string; cookie: string | undefined; authorization: string | null }, cfg: GateConfig | null, now: number): "pass" | "login" | "deny" {
  if (!r.edge) return "pass";
  if (!cfg) return "deny";
  if (r.path === "/api/gate") return "pass";
  if (sessionLive(r.cookie, cfg, now)) return "pass";
  const bearer = /^Bearer (\S+)$/.exec(r.authorization ?? "")?.[1];
  if (bearer) {
    const h = hashToken(bearer);
    if (cfg.tokens.some((t) => same(t.hash, h))) return "pass";
  }
  return "login";
}
