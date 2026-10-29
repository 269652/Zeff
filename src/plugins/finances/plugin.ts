import { definePlugin } from "../define";

/** Finances: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "finances",
  order: 178,
  name: "Finances",
  description: "Your debts and what you are owed in one database of the Workspace: the creditors overview (whom you owe what, the instalments a month, when you are debt-free) and the debtors overview (who owes you, what comes back when) — each debt with its payment plan, the months ahead as a chart, your income from the bank statements (read by the knowledge server). The debts the cases hold come by themselves; your own you write down, from a promise too.",
  category: "app",
  defaultInstalled: true,
  dependsOn: ["workspace", "cases"],
  settings: { href: "/settings/finances", what: "Your own accounts: transfers there are no spending" },
  routes: ["/settings/finances"],
});
