import { definePlugin } from "../define";

/** Weekly report: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "weekly-report",
  order: 20,
  name: "Weekly report",
  description: "Booking with the week in view: hours per job and day, breaks, flex time, the week's report, suggestions and “Done today” to take over.",
  category: "app",
  defaultInstalled: true,
  dependsOn: ["zeiterfassung"],
  tabs: [
    { href: "/", label: "Weekly report", short: "Weekly", also: ["/entries", "/export"] },
  ],
  routes: ["/"],
});
