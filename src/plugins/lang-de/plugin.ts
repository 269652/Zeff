import { definePlugin } from "../define";

/** Deutsch: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "lang-de",
  order: 140,
  name: "Deutsch",
  description: "Zeff auf Deutsch: alle Texte der Oberfläche, Datum und Zahlen im deutschen Format.",
  category: "language",
  defaultInstalled: true,
  settings: { href: "/preferences#language", what: "The language Zeff speaks" },
});
