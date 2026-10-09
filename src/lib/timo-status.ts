import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { formatHours, round2 } from "./format";
import { getReportSettings, getTimoConfig } from "./report";
import { getTimoExportPlan } from "./timo";
import { isoDate, type WeekInfo } from "./week";

const { timoDays } = schema;

/** What TimO has on a day: its attendance rows (first Kommt, last Geht, net "HH:MM") and absences. */
export type TimoRecord = { work: { start: string; end: string; net: string }[]; absence: string[] };

/** A day against TimO: it has what Zeff would record ("synced"), or something else ("differs"). */
export type TimoDayState = { state: "synced" | "differs"; title: string };

/** Keep what was just read from TimO, each day replacing what was read before. Returns the days stored. */
export function saveTimoDays(days: Record<string, TimoRecord>): number {
  const pulledAt = new Date().toISOString();
  const db = getDb();
  let n = 0;
  for (const [date, rec] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const work = JSON.stringify(Array.isArray(rec?.work) ? rec.work : []);
    const absence = JSON.stringify(Array.isArray(rec?.absence) ? rec.absence : []);
    db.insert(timoDays).values({ date, work, absence, pulledAt }).onConflictDoUpdate({ target: timoDays.date, set: { work, absence, pulledAt } }).run();
    n++;
  }
  return n;
}

/** "07:45" → 7.75 */
const hoursOf = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
};

function parse(row: { work: string; absence: string }): TimoRecord {
  try {
    return { work: JSON.parse(row.work) ?? [], absence: JSON.parse(row.absence) ?? [] };
  } catch {
    return { work: [], absence: [] };
  }
}

/**
 * Each day of the week against TimO, as last read: "synced" when TimO has what Zeff would
 * record — the same net working hours, an absence where Zeff has one — else "differs".
 * Undefined for days not read yet, or with nothing in TimO (not exported yet). Also when the
 * week was last read, and whether it's all in sync: every day Zeff would record is in TimO
 * as in Zeff, and no day differs.
 */
export function timoDayStates(week: WeekInfo): { states: (TimoDayState | undefined)[]; pulledAt: string | null; inSync: boolean } {
  const isos = week.days.map(isoDate);
  const rows = getDb().select().from(timoDays).where(inArray(timoDays.date, isos)).all();
  if (!rows.length) return { states: isos.map(() => undefined), pulledAt: null, inSync: false };
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const plan = getTimoExportPlan(week, getTimoConfig(getReportSettings()));
  const states = isos.map((iso): TimoDayState | undefined => {
    const row = byDate.get(iso);
    if (!row) return undefined;
    const timo = parse(row);
    if (!timo.work.length && !timo.absence.length) return undefined; // not in TimO (yet)
    const net = round2(timo.work.reduce((a, w) => a + hoursOf(w.net), 0));
    const has = [
      timo.work.length ? `${timo.work.map((w) => `${w.start}–${w.end}`).join(", ")} (${formatHours(net)} h)` : "",
      timo.absence.join(", "),
    ]
      .filter(Boolean)
      .join(" · ");
    const work = plan.days.find((d) => d.iso === iso && d.kind === "work");
    const absence = plan.days.find((d) => d.iso === iso && d.kind === "absence");
    if (!work && !absence) return { state: "differs", title: `TimO has ${has} — Zeff records nothing for this day` };
    // Within a minute: TimO keeps whole minutes.
    const workOk = work ? Math.abs(net - work.hours) < 1 / 60 : !timo.work.length;
    const absenceOk = !absence || timo.absence.length > 0;
    if (workOk && absenceOk) return { state: "synced", title: `In TimO: ${has}` };
    const want = [work ? `${formatHours(work.hours)} h working time` : "", absence ? (absence.absenceType ?? "an absence") : ""].filter(Boolean).join(" + ");
    return { state: "differs", title: `TimO has ${has}; Zeff would record ${want} — export the week to TimO again` };
  });
  const planned = new Set(plan.days.map((d) => d.iso));
  const inSync =
    planned.size > 0 && states.every((s, i) => (planned.has(isos[i]) ? s?.state === "synced" : s?.state !== "differs"));
  return { states, pulledAt: rows.reduce((a, r) => (r.pulledAt > a ? r.pulledAt : a), rows[0].pulledAt), inSync };
}
