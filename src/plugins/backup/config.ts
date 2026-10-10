import { getSqlite } from "@/db";
import { currentAccount } from "@/db/accounts";
import { ValidationError } from "@/lib/errors";

/**
 * Settings and configuration, apart from the data: the app settings (AI backends, LLM
 * instructions, work, backups), the work schedule, entry types, the syncs' settings, the report's
 * rules, the Jira boards, the repos, the installed plugins, the calendar connection. As one JSON —
 * in a config ZIP beside a backup (Backups → "Konfiguration extra"), imported into any account,
 * and copied over when an account is made from another.
 */

export const CONFIG_TABLES = [
  "app_settings",
  "work_schedule",
  "entry_types",
  "teams_settings",
  "gitlab_settings",
  "report_settings",
  "board_settings",
  "jira_boards",
  "repos",
  "plugins",
  "calendar_connections",
] as const;
export const CONFIG_FILE = "zeff-config.json";

/** How a sync or a backup went last time, the boards' counts: state, not configuration. */
const STATE_COLUMN = /^(last_|backup_last_)|^(synced_at|member_count)$/;

export type ConfigExport = {
  zeff: "config";
  version: 1;
  exportedAt: string;
  account: string;
  tables: Partial<Record<(typeof CONFIG_TABLES)[number], Record<string, unknown>[]>>;
};

export function exportConfig(): ConfigExport {
  const sqlite = getSqlite();
  const tables: ConfigExport["tables"] = {};
  for (const t of CONFIG_TABLES) tables[t] = sqlite.prepare(`select * from "${t}"`).all() as Record<string, unknown>[];
  return { zeff: "config", version: 1, exportedAt: new Date().toISOString(), account: currentAccount().name, tables };
}

export function parseConfig(raw: string | Buffer): ConfigExport {
  let v: ConfigExport;
  try {
    v = JSON.parse(raw.toString()) as ConfigExport;
  } catch {
    throw new ValidationError(`${CONFIG_FILE} isn't JSON.`);
  }
  if (v?.zeff !== "config" || typeof v.tables !== "object" || !v.tables) throw new ValidationError("Not a Zeff configuration.");
  return v;
}

/**
 * A configuration taken over into the account this runs for: each row set as it was (by its key) —
 * what isn't in it stays. Columns this Zeff doesn't know are left out; the state of syncs and
 * backups isn't touched. How many tables and rows.
 */
export function importConfig(c: ConfigExport): { tables: number; rows: number } {
  const sqlite = getSqlite();
  let tables = 0;
  let rows = 0;
  sqlite.transaction(() => {
    for (const t of CONFIG_TABLES) {
      const list = c.tables[t];
      if (!Array.isArray(list)) continue;
      const info = sqlite.prepare(`pragma table_info("${t}")`).all() as { name: string; pk: number }[];
      const known = new Set(info.map((i) => i.name));
      const pk = info.filter((i) => i.pk > 0).map((i) => i.name);
      if (!pk.length) continue;
      tables++;
      for (const row of list) {
        if (!row || typeof row !== "object") continue;
        const cols = Object.keys(row).filter((k) => known.has(k) && !STATE_COLUMN.test(k));
        if (!pk.every((k) => cols.includes(k))) continue;
        const values = cols.map((k) => {
          const x = row[k];
          return typeof x === "boolean" ? Number(x) : x === undefined ? null : x;
        });
        // One calendar connection per provider: the imported one takes its place.
        if (t === "calendar_connections" && row.provider !== undefined) sqlite.prepare(`delete from calendar_connections where provider = ? and id <> ?`).run(row.provider, row.id);
        const rest = cols.filter((k) => !pk.includes(k));
        const q = (k: string) => `"${k}"`;
        sqlite
          .prepare(
            `insert into "${t}" (${cols.map(q).join(", ")}) values (${cols.map(() => "?").join(", ")}) on conflict (${pk.map(q).join(", ")}) do ${
              rest.length ? `update set ${rest.map((k) => `${q(k)} = excluded.${q(k)}`).join(", ")}` : "nothing"
            }`,
          )
          .run(...values);
        rows++;
      }
    }
  })();
  return { tables, rows };
}
