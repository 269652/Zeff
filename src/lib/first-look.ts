import { getSqlite } from "@/db";
import { isInstalled } from "@/plugins/state";

/**
 * The first look: what Zeff finds in the last 30 days of what it read, on one page — the promises you made and forgot, the ones
 * made to you that are late, what falls due in the next 14 days (an instalment, a debt, a todo), the cases with no next step, the
 * work time not booked — each with what to do about it. What the plugins installed can tell; the rest is left out. Server only.
 */

const DAYS_BACK = 30;
const DAYS_AHEAD = 14;
const iso = (d: Date) => d.toLocaleDateString("sv-SE");
const today = () => iso(new Date());
const plusDays = (n: number) => iso(new Date(Date.now() + n * 864e5));

export type FirstLook = {
  /** Promises of yours, late (their day past) or old without a day — not kept. */
  promises: { id: number; person: string; text: string; due: string | null }[];
  /** Promises made to you, late. */
  owedToYou: { id: number; person: string; text: string; due: string | null }[];
  /** What falls due in the next 14 days (or is overdue): an instalment of a case, a debt of yours, a todo. */
  dueSoon: { ref: string; kind: "case" | "debt" | "todo"; title: string; due: string; amount: number | null; href: string | null }[];
  /** Cases running with no open todo — nothing to do next. */
  noNextStep: { caseId: number; title: string; next: string; href: string | null }[];
  /** Work days of the last 30 with fewer hours booked than the schedule's. */
  unbooked: { hours: number; days: { date: string; target: number; booked: number; missing: number }[] };
  /** How many things it found, for the headline. */
  count: number;
};

export async function firstLook(): Promise<FirstLook> {
  const out: FirstLook = { promises: [], owedToYou: [], dueSoon: [], noNextStep: [], unbooked: { hours: 0, days: [] }, count: 0 };
  const now = today();
  const ahead = plusDays(DAYS_AHEAD);
  const oldDay = plusDays(-7);

  if (isInstalled("people")) {
    const { openCommitments } = await import("@/plugins/people/graph");
    for (const c of openCommitments()) {
      const late = c.due ? c.due < now : c.createdAt.slice(0, 10) < oldDay;
      if (!late) continue;
      const line = { id: c.id, person: c.personName, text: c.text, due: c.due || null };
      if (c.direction === "mine") out.promises.push(line);
      else if (c.direction === "theirs") out.owedToYou.push(line);
    }
  }

  if (isInstalled("cases")) {
    const { listCases } = await import("@/plugins/cases/store");
    const { openOf } = await import("@/plugins/cases/bank");
    const { caseHref } = await import("@/plugins/cases/database");
    const { caseTitle } = await import("@/plugins/cases/shared");
    const { listTodos } = await import("@/lib/boards/store");
    const { linkedRefs } = await import("@/lib/boards/todo-settle");
    const open = isInstalled("todos") ? listTodos({ status: "open" }) : [];
    const withTodo = new Set(open.flatMap((t) => linkedRefs(t)).filter((r) => r.startsWith("case:")));
    for (const c of listCases().filter((x) => x.status === "open" && !x.compiled?.done)) {
      const s = c.compiled;
      const href = await caseHref(c.id);
      if (s?.nextDue && s.nextDue <= ahead) out.dueSoon.push({ ref: `case:${c.id}`, kind: "case", title: caseTitle(c), due: s.nextDue, amount: s.installment ?? openOf(c), href });
      if (s && !withTodo.has(`case:${c.id}`) && (s.nextWhat || s.nextDue)) out.noNextStep.push({ caseId: c.id, title: caseTitle(c), next: s.nextWhat || "", href });
    }
  }

  if (isInstalled("finances")) {
    const { debtPlans } = await import("@/plugins/finances/debts");
    for (const d of debtPlans(undefined, "owe").debts) {
      if (d.caseId || !d.nextDue || d.nextDue > ahead || d.open <= 0) continue;
      out.dueSoon.push({ ref: `debt:${d.id}`, kind: "debt", title: d.title, due: d.nextDue, amount: d.installment ?? d.open, href: `/workspace/${d.id}` });
    }
  }

  if (isInstalled("todos")) {
    const { listTodos } = await import("@/lib/boards/store");
    const taken = new Set(out.dueSoon.map((x) => x.ref));
    const { linkedRefs } = await import("@/lib/boards/todo-settle");
    for (const t of listTodos({ status: "open" })) {
      if (!t.due || t.due > ahead) continue;
      // (A todo for an instalment or a debt listed already: once, as that.)
      if (linkedRefs(t).some((r) => taken.has(r))) continue;
      out.dueSoon.push({ ref: `todo:${t.id}`, kind: "todo", title: t.text, due: t.due, amount: null, href: `/t/${t.id}` });
    }
  }
  out.dueSoon.sort((a, b) => a.due.localeCompare(b.due));

  if (isInstalled("zeiterfassung")) {
    const { getDayTargets } = await import("@/lib/schedule");
    const days = [...Array(DAYS_BACK).keys()].map((i) => new Date(Date.now() - (i + 1) * 864e5)).reverse();
    const booked = new Map(
      (getSqlite().prepare("select date, sum(hours) h from time_entries where date >= ? and date < ? group by date").all(iso(days[0]), now) as { date: string; h: number }[]).map((r) => [r.date, r.h]),
    );
    for (const d of getDayTargets(days)) {
      const b = booked.get(d.date) ?? 0;
      const missing = Math.round((d.target - b) * 100) / 100;
      if (d.target > 0 && missing >= 0.5) out.unbooked.days.push({ date: d.date, target: d.target, booked: b, missing });
    }
    out.unbooked.hours = Math.round(out.unbooked.days.reduce((s, d) => s + d.missing, 0) * 100) / 100;
  }

  out.count = out.promises.length + out.owedToYou.length + out.dueSoon.length + out.noNextStep.length + (out.unbooked.days.length ? 1 : 0);
  return out;
}
