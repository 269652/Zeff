import { definePlugin } from "../define";

/** Backups: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "backup",
  order: 110,
  name: "Backups",
  description: "Backs up Zeff's data (database, calendar inbox, logs) as a ZIP, AES-256 encrypted with a password — daily, keeping daily, weekly and monthly copies; restore in one click.",
  category: "system",
  defaultInstalled: true,
  settings: { href: "/preferences#backups", what: "Where, how many, password" },
  nav: [
    { href: "/preferences#backups", label: "Backups", hint: "Encrypted backups & restore" },
  ],
});
