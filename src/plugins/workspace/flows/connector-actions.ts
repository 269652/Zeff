import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FlowAction } from "./actions";
import type { FieldSpec } from "./types";

/**
 * The kernel's connector actions for flows (docs/zeff-kernel.md, "The line": a connector's driver is the kernel's — the automation
 * Chrome, Google's API): a source read into Zeff. A connector's port brings its sync as a flow marked `sync` (a step of the Sync menu)
 * that calls one of these — allowed only with the flow's `sync` permission for that source. Server only.
 */

const f = (name: string, type: FieldSpec["type"], extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, type, ...extra });
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : "");

export const CONNECTOR_ACTIONS: FlowAction[] = [
  {
    name: "gcal.sync",
    group: "connectors",
    label: "Read Google Calendar",
    summary:
      "Your Google calendars read into Zeff's calendars — through Google's API or the automation Chrome, as the Connections page says; the weeks of the calendar settings (and, from–to, a range besides). Nothing changes in Google. Needs the flow's sync permission for gcalendar.",
    input: [f("from", "text", { help: "Also read this range: its first day, YYYY-MM-DD" }), f("to", "text", { help: "… and the day after its last" }), f("background", "boolean", { help: "By itself: not when the automation Chrome isn't running" }), f("by", "text", { help: "What started it (env.trigger.kind): \"schedule\" counts as by itself" })],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      if (!(ctx.perms.sync ?? []).includes("gcalendar")) throw new Error("This flow may not read Google Calendar into Zeff — grant “gcalendar” under the flow's permissions (sync).");
      if (ctx.dryRun) return { ok: true, message: "dry run: Google Calendar not read" };
      const from = day(i.from);
      const to = day(i.to);
      const { syncGoogleCalendar } = await import("@/lib/google/calendar-sync");
      return syncGoogleCalendar({ background: i.background === true || i.background === "true" || i.by === "schedule", ...(from && to ? { range: { from, to } } : {}) });
    },
  },
];

// The kernel's own: always there (read with the other flow actions — flows/actions.ts flowActions()).
extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:connectors", CONNECTOR_ACTIONS);

// The connectors whose reading is a kernel step (Teams, WhatsApp, Signal): one action for all — the source named, allowed by the flow's `sync`.
extensionPoint<FlowAction[]>("workspace.flowActions").contribute("core:connector-steps", [
  {
    name: "connector.sync",
    group: "connectors",
    label: "Read a connector",
    summary: "A connector's messages read into Zeff — teams (your mentions and 1:1 messages), whatsapp (WhatsApp Web's chat list), signal (Signal Desktop) — as its sync does. By itself (by: schedule) only while what it reads is running. Needs the flow's sync permission for that source.",
    input: [f("source", "text", { required: true, options: ["teams", "whatsapp", "signal"] }), f("background", "boolean", { help: "By itself: not when what it reads isn't running" }), f("by", "text", { help: "What started it (env.trigger.kind): \"schedule\" counts as by itself" })],
    output: "{ ok, message }",
    writes: true,
    run: async (i, ctx) => {
      const { CONNECTOR_STEPS, runConnectorSync } = await import("@/lib/sync/registry");
      const source = String(i.source ?? "").trim() as (typeof CONNECTOR_STEPS)[number];
      if (!(CONNECTOR_STEPS as readonly string[]).includes(source)) throw new Error(`connector.sync reads ${CONNECTOR_STEPS.join(", ")} — not “${source}”.`);
      if (!(ctx.perms.sync ?? []).includes(source)) throw new Error(`This flow may not read ${source} into Zeff — grant “${source}” under the flow's permissions (sync).`);
      if (ctx.dryRun) return { ok: true, message: `dry run: ${source} not read` };
      return runConnectorSync(source, i.background === true || i.background === "true" || i.by === "schedule");
    },
  },
]);
