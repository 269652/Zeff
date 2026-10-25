import assert from "node:assert/strict";
import test from "node:test";
import { setupTempData } from "./helpers";
import { cashflowFlows, forecast, matchContracts, recurringFlows, type ContractRow, type InBooking } from "@/plugins/finances/insights";

setupTempData();

const TODAY = "2026-10-22";
/** A booking every month back from October 2026 on about that day (`jitter`: a few days off now and then, as weekends move them). */
const monthly = (name: string, amount: number, day: number, months: number, opts: { endBack?: number; jitter?: number[]; reference?: string } = {}): InBooking[] =>
  Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9 - (opts.endBack ?? 0) - i, day + (opts.jitter?.[i % opts.jitter.length] ?? 0)));
    return { date: d.toISOString().slice(0, 10), amount, text: name, counterparty: name, reference: opts.reference ?? "" };
  });
const row = (id: number, title: string, monthly: number | null, more: Partial<ContractRow> = {}): ContractRow => ({ id, dbId: 1, title, monthly, srcref: "", customer: "", running: true, ...more });

test("money insights: a monthly subscription (weekends moving it a few days) and a yearly one are found; shopping, a bill all over, a stopped one, a gap too wide, two only, a pocket of your own are not", () => {
  const bookings: InBooking[] = [
    ...monthly("Streamingdienst", -13.99, 5, 8, { jitter: [0, 2, -1, 1] }),
    ...["2024-11-10", "2025-11-11"].map((date) => ({ date, amount: -120, text: "Haftpflicht AG", counterparty: "Haftpflicht AG" })),
    ...Array.from({ length: 8 }, (_, i) => ({ date: `2026-${String(3 + i).padStart(2, "0")}-03`, amount: -(20 + i * 17), text: "Supermarkt", counterparty: "Supermarkt" })),
    // About a month — but ±10 % it isn't (a phone bill that moves).
    ...monthly("O2 Online", -100, 21, 4).map((b, i) => ({ ...b, amount: [-96.17, -124.96, -124.96, -250][i] })),
    ...monthly("Fitnessstudio", -29, 15, 6, { endBack: 6 }),
    // Every 38 days: no month (±4 days).
    ...[0, 38, 76, 114].map((n) => ({ date: new Date(Date.UTC(2026, 9, 15) - n * 864e5).toISOString().slice(0, 10), amount: -4.99, text: "Netflix", counterparty: "Netflix" })),
    ...monthly("Zeitung", -9.9, 2, 2),
    // A pocket: in and out each month — money moved, not spent.
    ...monthly("EUR Ersparnisse", -50, 23, 6),
    ...monthly("EUR Ersparnisse", 50, 25, 4),
    ...monthly("DIGITAS GMBH", 3552.43, 15, 6, { jitter: [0, 1, -1] }),
  ];
  const f = recurringFlows(bookings, TODAY);
  assert.deepEqual(
    f.out.map((r) => [r.key, r.rhythm, r.amount]),
    [
      ["streamingdienst", "monthly", 13.99],
      ["haftpflicht ag", "yearly", 120],
    ],
  );
  assert.equal(f.out.find((r) => r.rhythm === "yearly")!.monthly, 10, "a twelfth a month");
  assert.equal(f.out.find((r) => r.rhythm === "yearly")!.next, "2026-11-11");
  assert.deepEqual(
    f.in.map((r) => [r.key, r.rhythm, r.amount]),
    [["digitas gmbh", "monthly", 3552.43]],
    "the salary comes in; the pocket's money back is no income",
  );
});

test("money insights: matched against Verträge — the row the source brought, a customer number in the reference, a shared name, else the amount (one row one payment); what nothing covers is missing", () => {
  const bookings: InBooking[] = [
    ...monthly("Streamingdienst", -13.99, 5, 4),
    ...monthly("Stadtwerke Musterstadt", -80, 1, 4, { reference: "Abschlag Kd-Nr. 4711-0815" }),
    ...monthly("Max Vermieter", -650, 1, 4),
    ...monthly("Fitness First GmbH", -29.9, 10, 4),
    ...monthly("Cloudspeicher", -2.99, 12, 4),
    ...monthly("Vereinsbeitrag", -22, 14, 4),
  ];
  const { out } = recurringFlows(bookings, TODAY);
  const rows = [
    row(1, "Streaming (Streamingdienst)", 13.99),
    row(2, "Strom", 85, { customer: "4711 0815" }),
    row(3, "Miete", 650),
    row(4, "Fitness", 30),
    row(5, "Handy", 15),
    row(6, "Cloud", 3, { srcref: "recurring:cloudspeicher" }),
  ];
  const m = matchContracts(out, rows);
  assert.deepEqual(
    Object.fromEntries([...m].map(([k, v]) => [k, [v.by, v.title]])),
    {
      streamingdienst: ["name", "Streaming (Streamingdienst)"],
      "stadtwerke musterstadt": ["number", "Strom"],
      "max vermieter": ["amount", "Miete"],
      "fitness first gmbh": ["name", "Fitness"],
      cloudspeicher: ["source", "Cloud"],
    },
  );
  assert.ok(!m.has("vereinsbeitrag"), "22 € a month: no row of that name or amount (the Handy row's 15 € is too far off)");
});

test("money insights: the cashflow ahead — salary, subscriptions, the contracts no booking shows (once), a debt's instalments; the first day below zero and below a buffer", () => {
  const bookings: InBooking[] = [...monthly("Arbeitgeber GmbH", 2000, 20, 4), ...monthly("Max Vermieter", -1500, 1, 4), ...monthly("Streamingdienst", -10, 5, 4), ...monthly("Inkasso Nord", -100, 15, 4)];
  const { in: incomes, out: outgoings } = recurringFlows(bookings, TODAY);
  const flows = cashflowFlows(
    {
      incomes,
      outgoings,
      // Miete is the landlord's payment (by its amount): not counted twice. Strom no booking shows: 120 on each 1st.
      contracts: [row(1, "Miete", 1500), row(2, "Strom", 120), row(3, "Gekündigt", 50, { running: false })],
      // The collector's instalment is the plan's: the bank's rhythm of it doesn't count as well.
      payments: [
        { date: "2026-11-15", amount: 100, label: "Inkasso Nord", dir: "owe" },
        { date: "2026-12-15", amount: 100, label: "Inkasso Nord", dir: "owe" },
        { date: "2026-10-30", amount: 400, label: "Lea", dir: "owed" },
      ],
    },
    TODAY,
  );
  const of = (label: string) => flows.filter((f) => f.label === label).map((f) => [f.date, f.amount]);
  assert.deepEqual(of("Max Vermieter"), [["2026-11-01", -1500], ["2026-12-01", -1500], ["2027-01-01", -1500]]);
  assert.deepEqual(of("Miete"), [], "covered by the landlord's bookings");
  assert.deepEqual(of("Strom"), [["2026-11-01", -120], ["2026-12-01", -120], ["2027-01-01", -120]]);
  assert.deepEqual(of("Gekündigt"), [], "cancelled");
  assert.deepEqual(of("Inkasso Nord"), [["2026-11-15", -100], ["2026-12-15", -100]], "the plan's, once");
  assert.deepEqual(of("Lea"), [["2026-10-30", 400]]);
  assert.deepEqual(of("Arbeitgeber GmbH"), [["2026-11-20", 2000], ["2026-12-20", 2000], ["2027-01-20", 2000]]);

  // 1000 now, +400 on Oct 30th → 1400, Nov 1st −1620 → −220.
  const short = forecast(flows, { today: TODAY, start: 1000 });
  assert.deepEqual(short.firstNegative, { date: "2026-11-01", balance: -220 });
  assert.deepEqual(short.lowest, { date: "2026-11-15", balance: -330 }, "the streaming and the instalment before the salary");
  // 2000: Nov 1st 780, 5th 770, 15th 670, 20th 2670, Dec 1st 1050 … — never below zero, below a buffer of 1000 from Nov 1st.
  const fine = forecast(flows, { today: TODAY, start: 2000, buffer: 1000 });
  assert.equal(fine.firstNegative, null);
  assert.deepEqual(fine.firstBelowBuffer, { date: "2026-11-01", balance: 780 });
  assert.deepEqual(fine.lowest, { date: "2026-11-15", balance: 670 });
  assert.equal(fine.weeks.length, 13, "a week each, 90 days");
  assert.deepEqual([fine.weeks[0].from, fine.weeks[0].to, fine.weeks[0].balance], [TODAY, "2026-10-28", 2000]);
  assert.equal(fine.weeks.at(-1)!.to, "2027-01-20");
  assert.equal(fine.end, 3310);
  // Without a balance: the net a month only.
  const net = forecast(flows, { today: TODAY, start: null });
  assert.equal(net.firstNegative, null);
  assert.equal(net.weeks[0].balance, null);
  assert.deepEqual(net.months.find((m) => m.month === "2026-11"), { month: "2026-11", in: 2000, out: 1730, net: 270 });
});

test("money insights in Zeff: the widget lists what Verträge misses, adds it as a row there (then it is covered); the cashflow widget with a balance and without", async () => {
  const { setInstalled } = await import("@/plugins/state");
  for (const p of ["workspace", "people", "cases", "finances"]) setInstalled(p, true);
  await import("@/plugins/contributions");
  const { addBookings } = await import("@/plugins/cases/bank");
  const back = (m: number, d: number) => {
    const x = new Date();
    x.setUTCDate(1);
    x.setUTCMonth(x.getUTCMonth() - m);
    x.setUTCDate(d);
    return x.toISOString().slice(0, 10);
  };
  const book = (name: string, amount: number, d: number) => [0, 1, 2, 3].map((m) => ({ date: back(m, d), amount, currency: "EUR", text: `To ${name}`, counterparty: name, iban: "", reference: "" }));
  // (Day 1: the latest of each surely past — a debit later this month isn't in yet.)
  addBookings([...book("Streamingdienst", -13.99, 1), ...book("Handyvertrag", -15, 1), ...book("Arbeitgeber GmbH", 2500, 1)], "Revolut");

  const { createPage, addRow, getDatabase, rawRows } = await import("@/plugins/workspace/store");
  const { newProperty, newView } = await import("@/plugins/workspace/model");
  const cost = newProperty("Pro Monat", "number");
  const db = createPage({ kind: "database", title: "Verträge", schema: { titleName: "Vertrag", properties: [cost], views: [newView("Laufend", "table")] } });
  addRow(db, { title: "Handyvertrag", cells: { [cost.id]: 15 } });
  const { publishValue } = await import("@/plugins/workspace/values");
  publishValue({ label: "Fixkosten", dbId: db, viewId: getDatabase(db)!.schema.views[0].id, propId: cost.id, fn: "sum" });

  const { widgetData, widgetAct } = await import("@/plugins/workspace/widgets");
  const subs = await widgetData("finances.subscriptions", {});
  assert.equal(subs.kind, "list");
  if (subs.kind !== "list") return;
  assert.deepEqual(subs.items.map((i) => i.id), ["streamingdienst"], "the phone contract is in Verträge");
  assert.equal(subs.items[0].actions?.[0].id, "add");
  const after = await widgetAct("finances.subscriptions", "add", { id: "streamingdienst" }, {});
  const added = rawRows(db).find((r) => r.title === "Streamingdienst")!;
  assert.equal(added.cells[cost.id], 13.99, "its cost a month in the published column");
  assert.ok(after.kind === "list" && after.items.length === 0, "covered now");

  const flow = await widgetData("finances.cashflow", { balance: "-3000" });
  assert.ok(flow.kind === "list");
  if (flow.kind !== "list") return;
  assert.equal(flow.items[0].id, "weeks");
  assert.equal(flow.items[0].tone, "bad", "below zero from the start");
  assert.equal(flow.items[0].mini?.bars.length, 13);
  const net = await widgetData("finances.cashflow", { balance: "" });
  assert.ok(net.kind === "list" && net.items[0].id === "hint" && net.items.length > 1, "the net a month only");
});
