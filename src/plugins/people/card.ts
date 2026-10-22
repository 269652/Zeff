import { absenceIn } from "./absence";
import { detailsOf, syncDetails, type DetailKey } from "./details";
import { claimsOf, openCommitments } from "./graph";

/**
 * What a person's hover card shows at the top (the People plugin): their role, a few details to reach or
 * pay them, the open commitments with them and whether they are away — read off the claims and details.
 * Server only; `today` is "YYYY-MM-DD".
 */

export type CardExtras = {
  /** A role read about them (a confirmed one first). */
  role: string | null;
  /** Phone, address, IBAN — one each, in that order. */
  details: { key: DetailKey; value: string }[];
  /** Open commitments with them — the ones I owe first. */
  owed: { direction: "mine" | "theirs"; text: string; due: string }[];
  /** A claim says they are away until a day not passed yet (the latest such day). */
  away: { until: string; text: string } | null;
};

const CARD_DETAILS: DetailKey[] = ["phone", "address", "iban", "revtag"];

export function personCardExtras(personId: number, today: string): CardExtras {
  const claims = claimsOf(personId);
  syncDetails(personId);
  const details = detailsOf(personId);
  let away: CardExtras["away"] = null;
  for (const c of claims) {
    const a = c.kind === "commitment" ? null : absenceIn(c.text, today);
    if (a && (!away || a.until > away.until)) away = { until: a.until, text: c.text };
  }
  return {
    role: claims.find((c) => c.kind === "role")?.text ?? null,
    details: CARD_DETAILS.flatMap((key) => details.filter((d) => d.key === key).slice(0, 1).map((d) => ({ key, value: d.value }))),
    owed: openCommitments()
      .filter((c) => c.personId === personId && (c.direction === "mine" || c.direction === "theirs"))
      .slice(0, 3)
      .map((c) => ({ direction: c.direction as "mine" | "theirs", text: c.text, due: c.due })),
    away,
  };
}
