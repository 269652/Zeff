import { t } from "@/lib/i18n/server";
import type { ReviewAction, ReviewSource } from "@/lib/review/point";
import { dailyBatch } from "@/lib/trust/store";
import { proposedClaims, proposedLinks, staleClaims } from "./graph";
import { pendingSuggestions } from "./identity";
import { dateKindLabels, dateText } from "./shared";
import { listPeople, proposedDates } from "./store";
import { linkText, peopleTool, suggestionText, type PeopleTool } from "./tools";
import { localDay } from "@/lib/dates";
import { peopleHome, personHref } from "@/plugins/workspace/people-database";

/**
 * What People has you confirm, for the review queue: the names that may be one person, what the AI read about
 * people (claims, links), confirmed claims whose time is up ("still true?") and the dates found. A button does
 * what the People overview's does — through its tools, so an accepted name is read back like there.
 */

const verdict = (yes = t("Right"), no = t("Wrong")): ReviewAction[] => [{ id: "yes", label: yes, primary: true }, { id: "no", label: no }];
// (The person's page in the people database: /personen/<id> only redirects there.)
const profile = (personId: number) => personHref(personId);

/** The tool a button runs: yes or no, nothing else. */
function decide(action: string, yes: PeopleTool, no: PeopleTool): Promise<{ message?: string }> {
  if (action !== "yes" && action !== "no") throw new Error(t("Unknown action: {action}", { action }));
  return peopleTool(action === "yes" ? yes : no);
}
const said = async (r: Promise<{ message?: string }>) => (await r).message;

export const PEOPLE_REVIEW: ReviewSource[] = [
  {
    id: "people-identity",
    get label() {
      return t("Same person?");
    },
    list: () => {
      const names = new Map(listPeople().map((p) => [p.id, p.name]));
      return pendingSuggestions().map((s) => ({
        id: String(s.id),
        title: suggestionText(s, (id) => names.get(id)),
        detail: s.evidence,
        confidence: s.confidence,
        href: s.kind === "person" ? peopleHome() : profile(s.personId),
        actions: verdict(),
      }));
    },
    act: (id, action) => said(decide(action, { tool: "suggestion", id: Number(id), accept: true }, { tool: "suggestion", id: Number(id), accept: false })),
  },
  {
    id: "people-claim",
    get label() {
      return t("What the AI read about people");
    },
    list: () =>
      proposedClaims()
        .filter((c) => c.kind !== "commitment" || !c.doneAt)
        .map((c) => ({ id: String(c.id), title: `${c.personName}: ${c.text}`, detail: c.evidence || undefined, confidence: c.confidence, href: profile(c.personId), actions: verdict() })),
    act: (id, action) => said(decide(action, { tool: "claim", id: Number(id), action: "confirm" }, { tool: "claim", id: Number(id), action: "reject" })),
  },
  {
    id: "people-link",
    get label() {
      return t("Who is connected to what");
    },
    list: () => {
      const names = new Map(listPeople().map((p) => [p.id, p.name]));
      return proposedLinks().map((l) => ({
        id: String(l.id),
        title: `${l.personName} ${linkText(l, (id) => names.get(id) ?? "?")}`,
        detail: l.evidence || undefined,
        confidence: l.confidence,
        href: profile(l.personId),
        actions: verdict(),
      }));
    },
    act: (id, action) => said(decide(action, { tool: "link", id: Number(id), action: "confirm" }, { tool: "link", id: Number(id), action: "reject" })),
  },
  {
    id: "people-stale",
    get label() {
      return t("Still true?");
    },
    // A few a day (not all at once).
    list: () => dailyBatch("people-stale", staleClaims(), (c) => String(c.id)).map((c) => ({ id: String(c.id), title: `${c.personName}: ${c.text}`, detail: c.evidence || undefined, href: profile(c.personId), actions: verdict(t("Still true"), t("Outdated")) })),
    act: (id, action) => said(decide(action, { tool: "claim", id: Number(id), action: "recheck" }, { tool: "claim", id: Number(id), action: "reject" })),
  },
  {
    id: "people-date",
    get label() {
      return t("Dates found — are they right?");
    },
    list: () => {
      const kinds = dateKindLabels(t);
      return proposedDates().map((d) => ({
        id: String(d.id),
        title: `${d.personName} — ${d.kind === "other" ? d.label || t("Date") : kinds[d.kind]}: ${dateText(d)}`,
        detail: d.sourceText || undefined,
        href: profile(d.personId),
        actions: verdict(),
      }));
    },
    act: (id, action) => said(decide(action, { tool: "dateConfirm", id: Number(id) }, { tool: "dateDelete", id: Number(id) })),
  },
  {
    id: "people-followup",
    get label() {
      return t("Follow up?");
    },
    list: async () =>
      (await import("./away")).followUps(localDay()).map((c) => ({
        id: String(c.id),
        title: `${c.personName}: ${c.text}`,
        detail: c.due ? t("Due {date} — not kept yet", { date: c.due }) : t("Promised a week ago or more — not kept yet"),
        href: profile(c.personId),
        actions: verdict(t("Follow up"), t("Not needed")),
      })),
    act: async (id, action) => {
      if (action !== "yes" && action !== "no") throw new Error(t("Unknown action: {action}", { action }));
      return (await (await import("./away")).decideFollowUp(Number(id), action === "yes")).message;
    },
  },
];
