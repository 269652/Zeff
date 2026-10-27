/**
 * What runs right now, per account: the "a mail sync is running", "a briefing run", "the mail review" flags each account has
 * its own — two accounts run side by side (each syncs, briefs, reviews in the background), so one's running mail sync must
 * neither refuse nor be mistaken for the other's. Kept in one process field (globalThis.__zeffAccountFlags: flag → account →
 * value), which the sync host's mirror copies to the web server as it is (lib/host/mirror.ts). Server only.
 */
import { currentAccountId } from "@/db/accounts";

type Flags = Record<string, Record<string, unknown>>;
const g = globalThis as { __zeffAccountFlags?: Flags };
const all = (): Flags => (g.__zeffAccountFlags ??= {});

/** This account's value of a flag (undefined: not set). */
export const accountFlag = <T = unknown>(name: string, account = currentAccountId()): T | undefined => all()[name]?.[account] as T | undefined;

/** Set this account's flag — false, null or undefined clears it. */
export function setAccountFlag(name: string, value: unknown, account = currentAccountId()): void {
  const flags = all();
  const m = { ...(flags[name] ?? {}) };
  if (value === undefined || value === null || value === false) delete m[account];
  else m[account] = value;
  if (Object.keys(m).length) flags[name] = m;
  else delete flags[name];
}

/** The accounts a flag is set for, with their values (a deploy waits for all of them). */
export const accountFlagAll = <T = unknown>(name: string): [string, T][] => Object.entries(all()[name] ?? {}) as [string, T][];
