import type { Metadata } from "next";
import type { ComponentType, ReactNode } from "react";
import type { T } from "@/lib/i18n/shared";
import type { WeekInfo } from "@/lib/week";
import type { MonthInfo } from "@/lib/month";
import type { EntryWithJob } from "@/lib/entries";
import type { JobWithStats } from "@/lib/jobs";
import type { CloseItem } from "@/lib/week-close";
import type { PluginId, PluginManifest } from "@/plugins/catalog";
import type { PluginSyncSettings } from "@/plugins/sync-settings";
import type { SyncStep } from "@/lib/sync/registry";

/**
 * Integrations: plugins that live in a repository of their own (the booking systems Chrono and Punch are the
 * first) and are MOUNTED into Zeff under integrations/<name>/ (a git submodule). Zeff builds and runs
 * without them: `npm run integrations` (scripts/integrations.mjs, run by dev, build, test and deploy) looks at
 * what is mounted and generates src/lib/integrations/mounted-*.ts — three small files, so that the catalog
 * (client-safe), the server and the browser each load only their own part. An integration has three
 * entry modules at its root, each optional:
 *   meta.ts    data only: its catalog entries (what the Plugins page, the menus and the routes know of it)
 *   server.ts  what it does on the server: its sync settings and step, its driver, its pages, what it
 *              adds to the week, the month, the jobs and the week's close
 *   client.ts  its components for the places in Zeff's pages that show a little of it (marks in the week table …)
 * See docs/integrations.md.
 */

/** A plugin of an integration, as the catalog and the menus see it (data only: client-safe). */
export type IntegrationMeta = {
  id: PluginId;
  manifest: PluginManifest;
  /** The texts of its catalog entry as literals (t("…")), so that npm run i18n finds them. */
  texts?: (t: T) => string[];
};

/** A Next.js page of an integration, as its module: the page and its metadata (it renders at /export/<id> or /settings/<id>). */
export type IntegrationPage = {
  default: (props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) => ReactNode | Promise<ReactNode>;
  generateMetadata?: () => Metadata | Promise<Metadata>;
};

/** What a plugin adds to the week's page (the home page). `entries` and `days` are handed to its client marks. */
export type WeekSlot = {
  /** Cards beside the booked card (Chrono's approvals). */
  card?: ReactNode;
  /** Buttons in the head of "Hours per job and day" (the pull). */
  actions?: ReactNode;
  /** Links in the head of the report ("Export to Chrono →"). */
  exports?: ReactNode;
  /** Its data per entry id — for the week table's cells and the entries list. */
  entries?: Record<number, unknown>;
  /** Its data per day of the week (Monday first) — for the week table's booked row. */
  days?: unknown[];
};
/** What the week's tables get of the integrations: each plugin's data per entry and per day (WeekSlot.entries / days), by its id. */
export type IntegrationMarks = Record<string, Pick<WeekSlot, "entries" | "days">>;
export type WeekContext = { week: WeekInfo; entries: EntryWithJob[]; by?: string };

/** What a plugin adds to the month's page: the approvals it knows per day (the calendar colours them), a pull button. */
export type MonthSlot = {
  /** The system's name ("Chrono") and, per day of the month, the hours it has approved (null: not pulled yet). */
  approvals?: { system: string; days: ({ approved: number } | null)[] };
  /** Buttons for the head of the month (the pull). */
  actions?: ReactNode;
  /** The oldest pull among the month's weeks (what "status from …" vouches for). */
  oldestPull?: string | null;
  /** Its data per entry id, for the month's entries list (set once pulled). */
  entries?: Record<number, unknown>;
};
export type MonthContext = { month: MonthInfo; entries: EntryWithJob[] };

/** What a plugin adds to the jobs page: buttons above the table and a column of its own. */
export type JobsSlot = {
  toolbar?: (jobs: JobWithStats[]) => ReactNode;
  column?: { title: string; cell: (job: JobWithStats) => ReactNode };
};

/** The checks of the week's close (what is left to do before the week is done) a plugin brings. */
export type WeekCloseContext = { week: WeekInfo; now: Date; over: boolean; entries: EntryWithJob[]; query: string; ago: (iso: string) => string };

/** What a plugin of an integration does on the server. */
export type IntegrationServer = {
  /** Its sync settings (the Sync settings page) — the plugin's sync-settings module. */
  syncSettings?: PluginSyncSettings;
  /** Its step of the Sync menu and the scheduler (the key is the plugin's `syncSteps` entry). */
  syncStep?: { key: string; step: SyncStep };
  /** Its browser driver (an MCP server over stdio), as a path inside the mount: "chrono/driver.mjs". */
  driver?: string;
  /** Its sign-in: where the page is ("Sign in" opens it), its driver's status check, what its driver needs in the environment. */
  service?: { loginUrl: string; status: () => Promise<string>; env?: () => Record<string, string> | Promise<Record<string, string>> };
  /** Its pages: /export/<id> and /settings/<id> (the plugin's routes in the manifest). */
  pages?: { export?: IntegrationPage; settings?: IntegrationPage };
  week?: (ctx: WeekContext) => WeekSlot | Promise<WeekSlot>;
  month?: (ctx: MonthContext) => MonthSlot | Promise<MonthSlot>;
  jobs?: JobsSlot;
  weekClose?: (ctx: WeekCloseContext) => CloseItem[] | Promise<CloseItem[]>;
};

/**
 * What a plugin shows in Zeff's own client components (the week table, the entries list): marks for the data
 * its server part handed over (WeekSlot.entries / days). The data is typed `unknown` here — its owner knows it.
 */
export type IntegrationClient = {
  /** A cell of the week table (a row on a day): the marks of the entries in it. */
  CellMark?: ComponentType<{ items: unknown[] }>;
  /** Whether everything in the cell is approved (its hours read green), and the text class that does it. */
  cellApproved?: (items: unknown[]) => boolean;
  approvedClass?: string;
  /** An entry of the entries list. */
  EntryMark?: ComponentType<{ item: unknown }>;
  entryApproved?: (item: unknown) => boolean;
  /** A day's mark in the week table's booked row. */
  DayMark?: ComponentType<{ item: unknown }>;
};

/** An integration's modules as the generator mounts them. */
export type MountedMeta = { dir: string; meta: IntegrationMeta[] };
export type MountedServer = { dir: string; server: Record<string, IntegrationServer> };
export type MountedClient = { dir: string; client: Record<string, IntegrationClient> };
