/**
 * The contracts database's fields a source fills (the Finances plugin's recurring payments): fixed ids, so the template's
 * columns and the source's records meet. Client-safe.
 */
export const CONTRACT = {
  monthly: "ctrmonthly",
  amount: "ctramount",
  rhythm: "ctrrhythm",
  last: "ctrlast",
  next: "ctrnext",
} as const;
