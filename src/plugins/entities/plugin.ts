import { definePlugin } from "../define";

/** Entities: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "entities",
  order: 173,
  name: "Organisations, projects & places",
  description: "The things besides people that your work hangs on, each known under every name the sources use: organisations (from mail domains — not freemail —, customers, company profiles, bank counterparties), projects (a job number with its Jira key and board, repos and Workspace databases) and places (where appointments are, people's addresses, the addresses in letters). Zeff proposes them and their other names, you confirm them in the review queue; each kind is a database of the Workspace whose rows gather the people, tickets, mails, money, hours and appointments that belong to it. Other parts of Zeff (and agents, over MCP) resolve a name, an address or a ticket to them.",
  category: "app",
  defaultInstalled: false,
  dependsOn: ["people", "workspace"],
});
