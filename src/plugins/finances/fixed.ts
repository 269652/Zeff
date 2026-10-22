import { isInstalled } from "@/plugins/state";
import { namedValue } from "@/plugins/workspace/values";

/**
 * Your monthly fixed costs (the Finances plugin): the value published as "Fixkosten" in the Workspace — a sum under a column
 * of a database of yours (rent, phone, insurance …), read live. The debt overview counts it in, if you want: what is left of
 * your income after the instalments and these. None published: none. Server only.
 */

export type FixedCosts = { amount: number | null; source: string | null };

export function fixedCosts(): FixedCosts {
  if (!isInstalled("workspace")) return { amount: null, source: null };
  const v = namedValue("fixkosten");
  return v ? { amount: v.value, source: v.source } : { amount: null, source: null };
}
