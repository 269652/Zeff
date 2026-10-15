import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The lock's files and its session cookie — what the proxy (src/proxy.ts) needs on every request, so: no database, no
 * account, nothing but two small files in the data folder and node:crypto.
 *
 *   lock.json        {enabled, secret, vendor?}  written when the lock is switched on or off
 *   lock-state.json  {present, removedAt, beat}  written by the key watcher (detect.ts): is a security key plugged in, when
 *                    was it last seen going, when did the watcher last look
 *
 * A session is a cookie "<issued at>.<hmac>". It is good while the key is plugged in, was not pulled since it was issued
 * (`removedAt`), the watcher is alive (`beat`), and it is not older than twelve hours. Pulling the key therefore ends every
 * session at once, and putting it back does not bring one back — the PIN and a touch do.
 */

export type LockConfig = { enabled: boolean; secret: string; /** USB vendor id (hex) of the key; Yubico's 1050 by default. */ vendor?: string };
export type LockState = { present: boolean; removedAt: number; beat: number };

export const COOKIE = "zeff_lock";
export const SESSION_MS = 12 * 60 * 60 * 1000;
/** The watcher beats every few seconds; silent for longer than this, it is not trusted (locked until it speaks again). */
export const BEAT_MS = 20_000;
export const YUBICO = "1050";

const dataDir = () => path.dirname(process.env.DATABASE_PATH ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "zeff.db"));
const configFile = () => path.join(dataDir(), "lock.json");
const stateFile = () => path.join(dataDir(), "lock-state.json");

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

/** Read often (every request): a short cache. */
let cached: { at: number; cfg: LockConfig | null } | null = null;
export function readConfig(): LockConfig | null {
  const now = Date.now();
  if (cached && now - cached.at < 1000) return cached.cfg;
  const raw = readJson<LockConfig>(configFile());
  const cfg = raw && raw.enabled === true && typeof raw.secret === "string" && raw.secret.length >= 32 ? raw : null;
  cached = { at: now, cfg };
  return cfg;
}

export const lockEnabled = (): boolean => readConfig() !== null;

export function writeConfig(cfg: LockConfig): void {
  writeJson(configFile(), cfg);
  cached = null;
}

export const newSecret = (): string => randomBytes(32).toString("base64url");

export const readState = (): LockState | null => readJson<LockState>(stateFile());
export const writeState = (s: LockState): void => writeJson(stateFile(), s);

/** The cookie value for a session that starts `now`. */
export function sign(secret: string, iat: number): string {
  return `${iat}.${createHmac("sha256", secret).update(`zeff-lock.${iat}`).digest("base64url")}`;
}

/** Whether this cookie value is a live session. Pure: the clock and the two files are passed in. */
export function sessionValid(value: string | undefined | null, cfg: LockConfig, state: LockState | null, now: number): boolean {
  if (!value || !state) return false;
  const dot = value.indexOf(".");
  const iat = Number(value.slice(0, dot));
  if (dot < 1 || !Number.isFinite(iat)) return false;
  const want = Buffer.from(sign(cfg.secret, iat));
  const have = Buffer.from(value);
  if (want.length !== have.length || !timingSafeEqual(want, have)) return false;
  if (now - iat > SESSION_MS || iat > now + 60_000) return false;
  if (!state.present || iat <= state.removedAt) return false;
  return now - state.beat < BEAT_MS;
}

/** The lock for this request's cookie, from the files. */
export const sessionOk = (cookie: string | undefined | null): boolean => {
  const cfg = readConfig();
  return !cfg || sessionValid(cookie, cfg, readState(), Date.now());
};
