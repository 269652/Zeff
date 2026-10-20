import { definePlugin } from "../define";

/** Cases: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "cases",
  order: 175,
  name: "Cases",
  description: "One place per matter: the case numbers (Aktenzeichen) in your mails, letters and todos hold together what belongs to one case — its sources in time order, the person on the other side, what is owed, the next instalment or deadline and where to pay (with a GiroCode). A database of the Workspace, one row per case; with the LLM plugin the AI sums each case up.",
  category: "app",
  defaultInstalled: true,
  dependsOn: ["workspace"],
  routes: ["/vorgaenge"],
});
