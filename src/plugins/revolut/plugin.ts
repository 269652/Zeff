import { definePlugin } from "../define";

/** Revolut: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "revolut",
  order: 177,
  name: "Revolut",
  description: "Reads your Revolut statements (the CSV export, in German or English — other banks' CSV too): a file you import on the cases' overview, or one that comes in as a document (from your Drive folder) by itself. Its bookings go to the cases' bank, where payments settle their todos and cases. Among the documents a statement is kept as a note, not as its bookings.",
  category: "connector",
  defaultInstalled: false,
  dependsOn: ["cases"],
});
