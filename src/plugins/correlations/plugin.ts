import { definePlugin } from "../define";

/** Correlations: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "correlations",
  order: 128,
  name: "Correlations",
  description:
    "What goes with what in your days: a journal's energy or mood against your meeting hours, booked hours, messages, todos, spending and the other fields of your Workspace databases — today and the day after. Computed in code (Spearman, Pearson, group comparisons, a permutation test), told only when it holds over enough days. A Workspace widget, a page to explore any pair, and a tool for agents.",
  category: "app",
  defaultInstalled: true,
  dependsOn: ["workspace"],
  nav: [{ href: "/correlations", label: "Correlations", hint: "What goes with what in your days" }],
  routes: ["/correlations"],
});
