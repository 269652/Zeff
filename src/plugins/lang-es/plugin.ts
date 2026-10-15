import { definePlugin } from "../define";

/** Español: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "lang-es",
  order: 150,
  name: "Español",
  description: "Zeff en español: todos los textos de la interfaz, fechas y números en formato español.",
  category: "language",
  defaultInstalled: true,
  settings: { href: "/preferences#language", what: "The language Zeff speaks" },
});
