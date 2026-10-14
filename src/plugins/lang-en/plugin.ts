import { definePlugin } from "../define";

/** English: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "lang-en",
  order: 130,
  name: "English",
  description: "Zeff in English — the language its texts are written in.",
  category: "language",
  defaultInstalled: true,
  settings: { href: "/preferences#language", what: "The language Zeff speaks" },
});
