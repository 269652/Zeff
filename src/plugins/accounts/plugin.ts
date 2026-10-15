import { definePlugin } from "../define";

/** Accounts: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "accounts",
  order: 200,
  name: "Accounts",
  description: "Several accounts — e.g. work and private — and switching between them. Each has its own data, settings, AI backends and installed plugins; a new one can take over another one's settings.",
  category: "system",
  defaultInstalled: false,
  settings: { href: "/accounts", what: "Create and switch accounts" },
  nav: [
    { href: "/accounts", label: "Accounts", hint: "Switch & manage accounts" },
  ],
  routes: ["/accounts"],
});
