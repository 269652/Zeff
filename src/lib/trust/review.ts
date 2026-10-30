import { t } from "@/lib/i18n/server";
import type { ReviewAction, ReviewSource } from "@/lib/review/point";
import { decideVersion, disputes, getVersion, staleBatch, type Decision, type FactVersion } from "./store";
import { peopleHome, personHref } from "@/plugins/workspace/people-database";

/**
 * Trust in facts, in the review queue (server only): a value that contradicts what Zeff holds — "IBAN of
 * Wagner changed: old … → new …", each with its source and date — to take, to keep the old or to keep both;
 * and values past their time ("still true?"), a few a day. Your answer goes to the writer that recorded the
 * value (its module is loaded first, so it is listening — see onTrustDecision). Zeff's own sources: the queue
 * (@/lib/review) lists them after the plugins'.
 */

/** The writers' modules: loaded before a decision, so their store hears of it. */
const WRITERS: Record<string, () => Promise<unknown>> = {
  facts: () => import("@/lib/facts"),
  details: () => import("@/plugins/people/details"),
  repo: () => import("@/plugins/knowledge/repo-trust"),
};

/** An attribute as the queue names it. */
export function attributeLabel(attribute: string): string {
  const labels: Record<string, string> = {
    iban: t("IBAN"),
    bic: t("BIC"),
    bank: t("Bank"),
    revtag: t("RevTag"),
    address: t("Address"),
    phone: t("Phone"),
    hours: t("Office hours"),
    birthday: t("Birthday"),
    absence: t("Absence"),
    role: t("Role"),
    "prod-url": t("Prod address"),
    "test-url": t("Test address"),
    "dev-url": t("Dev address"),
    "other-url": t("System address"),
    text: t("Fact"),
  };
  return labels[attribute] ?? attribute;
}

/** Who or what a subject is, as the queue names it. */
const subjectName = (v: FactVersion) => v.subjectLabel || v.subject.replace(/^subject:/, "");

/** Where a subject lives in Zeff. */
export function subjectHref(subject: string): string | undefined {
  const [kind, id] = [subject.slice(0, subject.indexOf(":")), subject.slice(subject.indexOf(":") + 1)];
  if (kind === "person") return Number(id) > 0 ? personHref(Number(id)) : peopleHome();
  if (kind === "repo") return "/settings/todos";
  return undefined;
}

/** A version's source and date: "mail:abc, 2026-10-20". */
export const provenance = (v: FactVersion) => [v.sourceRef === "you" ? t("you") : v.sourceRef, v.confirmedAt.slice(0, 10)].filter(Boolean).join(", ");

async function decide(itemId: string, decision: Decision): Promise<string> {
  const v = getVersion(Number(itemId));
  if (!v) throw new Error(t("Unknown review item: {key}", { key: itemId }));
  await WRITERS[v.writer]?.().catch(() => undefined);
  decideVersion(v.id, decision);
  return decision === "new" ? t("Taken: {value}", { value: v.value }) : decision === "old" ? t("Kept the old one") : decision === "both" ? t("Both kept") : decision === "still" ? t("Confirmed") : t("Marked outdated");
}

const choices = (): ReviewAction[] => [
  { id: "yes", label: t("Take the new one"), primary: true },
  { id: "no", label: t("Keep the old") },
  { id: "both", label: t("Both valid") },
];

export const TRUST_REVIEW: ReviewSource[] = [
  {
    id: "trust-dispute",
    get label() {
      return t("Changed — which holds?");
    },
    list: () =>
      disputes().map(({ version: v, current }) => {
        const old = current.map((c) => c.value).join(" / ") || "—";
        const before = current.map((c) => t("Old: {value} ({source})", { value: c.value, source: provenance(c) }));
        return {
          id: String(v.id),
          title: t("{attribute} of {subject} changed: {old} → {new}", { attribute: attributeLabel(v.attribute), subject: subjectName(v), old, new: v.value }),
          detail: [...before, t("New: {value} ({source})", { value: v.value, source: provenance(v) }), v.quote ? `„${v.quote}“` : "", v.link].filter(Boolean).join(" · "),
          confidence: v.confidence,
          href: subjectHref(v.subject),
          actions: choices(),
        };
      }),
    act: (id, action) => {
      const decision: Record<string, Decision> = { yes: "new", no: "old", both: "both" };
      if (!decision[action]) throw new Error(t("Unknown action: {action}", { action }));
      return decide(id, decision[action]);
    },
  },
  {
    id: "trust-stale",
    get label() {
      return t("Still true?");
    },
    list: () =>
      staleBatch().map((v) => ({
        id: String(v.id),
        title: t("{attribute} of {subject}: {value} — still true?", { attribute: attributeLabel(v.attribute), subject: subjectName(v), value: v.value }),
        detail: [t("Confirmed {date}", { date: v.confirmedAt.slice(0, 10) }), v.sourceRef === "you" ? t("you") : v.sourceRef, v.quote ? `„${v.quote}“` : ""].filter(Boolean).join(" · "),
        href: subjectHref(v.subject),
        actions: [
          { id: "yes", label: t("Still true"), primary: true },
          { id: "no", label: t("Outdated") },
        ],
      })),
    act: (id, action) => {
      if (action !== "yes" && action !== "no") throw new Error(t("Unknown action: {action}", { action }));
      return decide(id, action === "yes" ? "still" : "outdated");
    },
  },
];
