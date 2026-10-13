import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { t } from "@/lib/i18n/server";
import { zeffUserDir } from "../../scripts/browser-find.mjs";

/**
 * Accounts (the Accounts plugin): Zeff more than once — business and private, say. Each account is
 * a database of its own (its data, its settings, its installed plugins) in a folder of its own; the
 * first one is the database Zeff always had (data/zeff.db), the others live in data/accounts/<id>/.
 * Which one you're in is kept here (data/accounts.json) — one for the whole server; work done for
 * one account in the background (a backup, copying settings) runs inside `withAccount`.
 */

export type Account = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  /** Its automation Chrome's debug port (the first account: 9222) — each account its own browser, its own sign-ins. */
  chromePort?: number;
  /** Its knowledge server's port (the first account: 9555, KNOWLEDGE_URL) — each account its own knowledge base. */
  knowledgePort?: number;
  /** Another account whose automation Chrome (and so its sign-ins) it uses instead of its own — a copy of that account. */
  chromeFrom?: string;
};

/** The first account's automation Chrome (as it always was); the others' from 9231 up. */
export const DEFAULT_CHROME_PORT = 9222;
const freePort = (taken: (number | undefined)[], from = 9231) => {
  let p = from;
  while (taken.includes(p)) p++;
  return p;
};
/** The others' knowledge servers: from 9556 up. */
const KNOWLEDGE_PORT_FROM = 9556;
type Registry = { active: string; installed: boolean; accounts: Account[] };

export const DEFAULT_ACCOUNT = "default";
export const ACCOUNT_COLORS = ["indigo", "emerald", "amber", "rose", "sky", "violet"] as const;

const BASE_DB = process.env.DATABASE_PATH ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "zeff.db");
/** The data folder of the first account — the others' folders are in it (accounts/). */
export const BASE_DIR = path.dirname(BASE_DB);
const FILE = path.join(BASE_DIR, "accounts.json");
export const ACCOUNTS_DIR = path.join(BASE_DIR, "accounts");

const first = (): Account => ({ id: DEFAULT_ACCOUNT, name: "Default", color: "indigo", createdAt: new Date(0).toISOString() });

const state = globalThis as unknown as { __zeffAccounts?: Registry; __zeffAccountScope?: AsyncLocalStorage<string> };
const scope = (state.__zeffAccountScope ??= new AsyncLocalStorage<string>());

function read(): Registry {
  if (state.__zeffAccounts) return state.__zeffAccounts;
  let r: Registry = { active: DEFAULT_ACCOUNT, installed: false, accounts: [first()] };
  try {
    const v = JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<Registry>;
    const accounts = Array.isArray(v.accounts) ? v.accounts.filter((a) => a && typeof a.id === "string" && typeof a.name === "string") : [];
    if (!accounts.some((a) => a.id === DEFAULT_ACCOUNT)) accounts.unshift(first());
    r = { active: typeof v.active === "string" ? v.active : DEFAULT_ACCOUNT, installed: !!v.installed, accounts };
  } catch {
    // none yet: just the first account
  }
  if (!r.accounts.some((a) => a.id === r.active)) r.active = DEFAULT_ACCOUNT;
  // Each account (but the first) its own automation Chrome and knowledge server: a port each, kept.
  if (r.accounts.some((a) => a.id !== DEFAULT_ACCOUNT && (!a.chromePort || !a.knowledgePort))) {
    for (const a of r.accounts) {
      if (a.id === DEFAULT_ACCOUNT) continue;
      a.chromePort ||= freePort(r.accounts.map((x) => x.chromePort));
      a.knowledgePort ||= freePort(r.accounts.map((x) => x.knowledgePort), KNOWLEDGE_PORT_FROM);
    }
    try {
      write(r);
    } catch {
      // read-only: assigned again next time
    }
  }
  return (state.__zeffAccounts = r);
}

function write(r: Registry): void {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.writeFileSync(`${FILE}.part`, JSON.stringify(r, null, 2));
  fs.renameSync(`${FILE}.part`, FILE);
  state.__zeffAccounts = r;
}

export const listAccounts = (): Account[] => read().accounts;
/**
 * Read data/accounts.json again at the next question. The registry is kept in memory; a server that doesn't
 * write it (the sync host) calls this to see the account the web server switched to.
 */
export const reloadAccounts = (): void => {
  state.__zeffAccounts = undefined;
};

export const accountById = (id: string): Account | undefined => read().accounts.find((a) => a.id === id);

/** Whether the Accounts plugin is installed — kept here, for all accounts alike (not in one's database). */
export const accountsInstalled = () => read().installed;
export function setAccountsInstalled(installed: boolean): void {
  const r = read();
  if (!installed && r.accounts.length > 1) {
    throw new Error(
      t("Delete the other accounts first ({others}) — without the plugin there's only “{first}”.", {
        others: r.accounts.filter((a) => a.id !== DEFAULT_ACCOUNT).map((a) => a.name).join(", "),
        first: r.accounts[0].name,
      }),
    );
  }
  write({ ...r, installed, active: installed ? r.active : DEFAULT_ACCOUNT });
}

/** The account switched to (without the plugin: always the first). */
export const activeAccountId = () => {
  const r = read();
  return r.installed ? r.active : DEFAULT_ACCOUNT;
};

/** The account this code runs for: the one `withAccount` set, else the active one. */
export const currentAccountId = () => scope.getStore() ?? activeAccountId();
export const currentAccount = (): Account => accountById(currentAccountId()) ?? first();

/** Run something for one account — its database, its folder — whichever is active meanwhile. */
export const withAccount = <T>(id: string, fn: () => T): T => scope.run(id, fn);

/**
 * Work started now that goes on in the background (a click's sync, Lage, recap, a WhatsApp history):
 * kept in the account it was started in — else each later database read follows whatever account
 * is switched to meanwhile, and its results land in the other one.
 */
export const inThisAccount = <T>(fn: () => T): T => withAccount(currentAccountId(), fn);

export const accountDbPath = (id: string) => (id === DEFAULT_ACCOUNT ? BASE_DB : path.join(ACCOUNTS_DIR, id, "zeff.db"));
/** An account's data folder (its database, work logs, context files, backups by default). */
export const accountDir = (id: string) => path.dirname(accountDbPath(id));

export function setActiveAccount(id: string): void {
  const r = read();
  if (!r.accounts.some((a) => a.id === id)) throw new Error(t("Unknown account."));
  write({ ...r, active: id });
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/backup|config/g, (w) => w.slice(0, 3)) // backup files are named after it: zeff-konto-<id>-backup-…
    .slice(0, 32) || "konto";

export function addAccount(name: string, color: string, chromeFrom?: string): Account {
  const r = read();
  const n = name.trim().slice(0, 60);
  if (!n) throw new Error(t("A name, please."));
  if (r.accounts.some((a) => a.name.toLowerCase() === n.toLowerCase())) throw new Error(t("“{name}” already exists.", { name: n }));
  let id = slug(n);
  for (let i = 2; id === DEFAULT_ACCOUNT || r.accounts.some((a) => a.id === id) || fs.existsSync(path.join(ACCOUNTS_DIR, id)); i++) id = `${slug(n)}-${i}`;
  const a: Account = {
    id,
    name: n,
    color: (ACCOUNT_COLORS as readonly string[]).includes(color) ? color : "emerald",
    createdAt: new Date().toISOString(),
    chromePort: freePort(r.accounts.map((x) => x.chromePort)),
    knowledgePort: freePort(r.accounts.map((x) => x.knowledgePort), KNOWLEDGE_PORT_FROM),
    ...(chromeFrom && r.accounts.some((x) => x.id === chromeFrom) ? { chromeFrom } : {}),
  };
  fs.mkdirSync(accountDir(id), { recursive: true });
  write({ ...r, accounts: [...r.accounts, a] });
  return a;
}

export function updateAccount(id: string, patch: { name?: string; color?: string }): Account {
  const r = read();
  const a = r.accounts.find((x) => x.id === id);
  if (!a) throw new Error(t("Unknown account."));
  const name = patch.name?.trim().slice(0, 60);
  if (patch.name !== undefined && !name) throw new Error(t("A name, please."));
  if (name && r.accounts.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new Error(t("“{name}” already exists.", { name }));
  const next: Account = { ...a, ...(name ? { name } : {}), ...(patch.color && (ACCOUNT_COLORS as readonly string[]).includes(patch.color) ? { color: patch.color } : {}) };
  write({ ...r, accounts: r.accounts.map((x) => (x.id === id ? next : x)) });
  return next;
}

/**
 * An account off the list — its folder (database, files) set aside in data/accounts/.deleted/, not
 * gone. Not the first one, not the one you're in.
 */
export function removeAccount(id: string): string {
  const r = read();
  if (id === DEFAULT_ACCOUNT) throw new Error(t("The first account stays."));
  if (id === r.active) throw new Error(t("Switch to another account first."));
  if (!r.accounts.some((a) => a.id === id)) throw new Error(t("Unknown account."));
  const from = accountDir(id);
  const to = path.join(ACCOUNTS_DIR, ".deleted", `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  if (fs.existsSync(from)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }
  write({ ...r, accounts: r.accounts.filter((a) => a.id !== id) });
  return to;
}

/**
 * The automation Chrome of the account this runs for: its debug endpoint and its profile folder
 * (null: the first account's, as it always was — %LOCALAPPDATA%\Zeff\chrono-chrome-profile).
 */
export function accountChrome(id = currentAccountId()): { endpoint: string; profile: string | null; port: number } {
  const own = accountById(id);
  // A copy of another account: that one's Chrome, its sign-ins (one step — no chains).
  const a = own?.chromeFrom && own.chromeFrom !== own.id ? (accountById(own.chromeFrom) ?? own) : own;
  if (!a || a.id === DEFAULT_ACCOUNT || !a.chromePort) return { endpoint: `http://127.0.0.1:${DEFAULT_CHROME_PORT}`, profile: null, port: DEFAULT_CHROME_PORT };
  return { endpoint: `http://127.0.0.1:${a.chromePort}`, profile: path.join(zeffUserDir(), `chrome-${a.id}`), port: a.chromePort };
}

/**
 * The knowledge server of an account (Knowledge plugin): where it answers, and its data folder
 * (null: the first account's, knowledge/data — as it always was; the others' in their own folder).
 * The launcher runs one per account that has the plugin (data/knowledge-instances.json).
 */
export function accountKnowledge(id = currentAccountId()): { url: string; port: number; dataDir: string | null } {
  const a = accountById(id);
  if (!a || a.id === DEFAULT_ACCOUNT || !a.knowledgePort) {
    const url = (process.env.KNOWLEDGE_URL || "http://127.0.0.1:9555").replace(/\/+$/, "");
    return { url, port: Number(new URL(url).port) || 9555, dataDir: null };
  }
  return { url: `http://127.0.0.1:${a.knowledgePort}`, port: a.knowledgePort, dataDir: path.join(accountDir(a.id), "knowledge") };
}
