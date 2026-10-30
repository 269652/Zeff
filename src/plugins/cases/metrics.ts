import type { MetricProvider } from "@/plugins/workspace/metric-point";
import { openOf } from "./bank";
import type { Case } from "./shared";
import { listCases } from "./store";
import { localDay } from "@/lib/dates";

/**
 * The Cases plugin's Kennzahlen (metric-point.ts): the money and the deadlines of the running cases, by name —
 * @Fällig in 30 Tagen in a page, kennzahl("Offen in Vorgängen") in a formula, the figures widget. Read now. Server only.
 */

const DAYS = 30;
const inDays = (day: string) => Math.round((Date.parse(day) - Date.parse(localDay())) / 864e5);

/** The cases still running (not closed, not done by what the AI read). */
export const runningCases = (): Case[] => listCases().filter((c) => c.status === "open" && !c.compiled?.done);

/** The running cases with a payment due in the next 30 days (today included). */
const dueSoon = () => runningCases().filter((c) => c.compiled?.nextDue && inDays(c.compiled.nextDue) >= 0 && inDays(c.compiled.nextDue) <= DAYS);
const href = () => "/vorgaenge";

export const CASES_METRICS: MetricProvider[] = [
  { label: "Offen in Vorgängen", unit: "€", what: "What is still open in all your running cases", read: () => runningCases().reduce((sum, c) => sum + (openOf(c) ?? 0), 0), href },
  {
    label: "Fällig in 30 Tagen",
    unit: "€",
    what: "What your cases ask you to pay in the next 30 days (the next instalment, else what is open)",
    read: () => dueSoon().reduce((sum, c) => sum + (c.compiled?.installment ?? c.compiled?.open ?? 0), 0),
    href,
  },
  { label: "Zahlungen in 30 Tagen", unit: "", what: "How many of your cases have a payment due in the next 30 days", read: () => dueSoon().length, href },
  { label: "Laufende Vorgänge", unit: "", what: "Your cases still running (not closed, not done)", read: () => runningCases().length, href },
  {
    label: "Überfällige Vorgänge",
    unit: "",
    what: "Running cases whose next payment or deadline has passed",
    read: () => runningCases().filter((c) => c.compiled?.nextDue && inDays(c.compiled.nextDue) < 0).length,
    href,
    tone: (v) => (v > 0 ? "bad" : "good"),
  },
];
