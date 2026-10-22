import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";

setupTempData();

/** Local times; 2026-10-19 is a Monday. */
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);

/** WhatsApp messages: several a day, every day, for four weeks up to Tuesday the 20th, 10:00 — then nothing. */
async function seedWhatsapp() {
  const { getDb, schema } = await import("@/db");
  const rows = [];
  for (let d = new Date(2026, 8, 22); d < at(20, 11); d.setDate(d.getDate() + 1))
    for (const h of [9, 10, 12, 15, 18]) {
      const when = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
      if (when > at(20, 10)) continue;
      rows.push({ key: `wa|${when.getTime()}`, convId: "c", folder: "WhatsApp", subject: "Anna", preview: "hi", receivedAt: when.toISOString(), syncedAt: when.toISOString() });
    }
  getDb().insert(schema.emails).values(rows).run();
}

test("a source's health from its own table: WhatsApp's runs say ok, but nothing came for two days — silent, told once", async () => {
  await seedWhatsapp();
  const { noteSyncResult } = await import("@/lib/sync/health");
  const { computeSourceHealth, sourceIncidents, arrivalsOf } = await import("@/lib/sync/source-health");
  assert.ok(arrivalsOf("whatsapp")!.length > 100, "read from the emails of the WhatsApp folder");
  assert.equal(arrivalsOf("drivebackup"), null, "a step without items of its own");

  noteSyncResult("whatsapp", true, "0 new", at(22, 11, 50).toISOString());
  const steps = [{ key: "whatsapp", label: "WhatsApp", href: "/apps/whatsapp", running: false, lastAt: at(22, 11, 50).toISOString(), lastOk: true, lastMessage: "0 new", everyMinutes: 15, workdays: false }];
  const r = computeSourceHealth(steps, { now: at(22, 12).getTime(), upSince: at(1, 0).getTime() });
  const wa = r.find((h) => h.key === "whatsapp")!;
  assert.equal(wa.state, "silent", JSON.stringify(wa.detail));
  assert.equal(wa.lastNewAt, at(20, 10).toISOString());

  const [inc] = sourceIncidents();
  assert.equal(inc.key, "whatsapp");
  assert.equal(inc.state, "silent");
  // Checked again: the same incident (the same id for the notification), not a new one.
  computeSourceHealth(steps, { now: at(22, 12, 5).getTime(), upSince: at(1, 0).getTime() });
  assert.equal(sourceIncidents()[0].openedAt, inc.openedAt);

  // A message comes again: closed.
  const { getDb, schema } = await import("@/db");
  getDb().insert(schema.emails).values({ key: "wa|new", convId: "c", folder: "WhatsApp", subject: "Anna", preview: "back", receivedAt: at(22, 12, 1).toISOString(), syncedAt: at(22, 12, 1).toISOString() }).run();
  computeSourceHealth([{ ...steps[0], lastAt: at(22, 12, 2).toISOString() }], { now: at(22, 12, 3).getTime(), upSince: at(1, 0).getTime() });
  assert.deepEqual(sourceIncidents(), []);
});

test("the app's contract check is kept: a drift shows until a clean check", async () => {
  const { noteDrift, computeSourceHealth } = await import("@/lib/sync/source-health");
  const steps = [{ key: "signal", label: "Signal", href: "/apps/signal", running: false, lastAt: at(22, 11).toISOString(), lastOk: true, lastMessage: "ok", everyMinutes: 0, workdays: false }];
  noteDrift("signal", { ok: true, summary: "found another way" }, at(22, 9).toISOString());
  assert.equal(computeSourceHealth(steps, { now: at(22, 12).getTime(), upSince: 0 })[0].state, "drift");
  noteDrift("signal", null);
  assert.equal(computeSourceHealth(steps, { now: at(22, 12).getTime(), upSince: 0 })[0].state, "ok");
});

test("Jira's own date format (local time with the zone's name) is read", async () => {
  const { parseItemTime } = await import("@/lib/sync/source-health");
  assert.equal(parseItemTime("2026-10-21 16:27:04 Mitteleuropäische Sommerzeit"), new Date(2026, 9, 21, 16, 27, 4).getTime());
  assert.equal(parseItemTime("2026-10-20T15:54:56.974+02:00"), Date.parse("2026-10-20T13:54:56.974Z"));
  assert.ok(Number.isNaN(parseItemTime("")));
});

test("stale counts only since the account syncs: a switch to it (or the server's start) is a fresh start", async () => {
  const { computeSourceHealth, noteSyncingSince } = await import("@/lib/sync/source-health");
  const uptime = process.uptime;
  process.uptime = () => 30 * 86400; // the server runs for a month
  try {
    const steps = [{ key: "news", label: "News", href: "/news", running: false, lastAt: new Date(Date.now() - 3 * 86400e3).toISOString(), lastOk: true, lastMessage: "ok", everyMinutes: 30, workdays: false }];
    noteSyncingSince(Date.now() - 5 * 60000);
    assert.equal(computeSourceHealth(steps)[0].state, "ok", "switched to this account five minutes ago");
    noteSyncingSince(Date.now() - 2 * 86400e3);
    assert.equal(computeSourceHealth(steps)[0].state, "stale", "synced for two days, but this step didn't run");
  } finally {
    process.uptime = uptime;
  }
});
