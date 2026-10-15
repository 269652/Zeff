import { definePlugin } from "../define";

/** Monthly report: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "monthly-report",
  order: 30,
  name: "Monthly report",
  description: "The month as a calendar and per job: what's booked, what's missing, what's approved.",
  category: "app",
  defaultInstalled: true,
  dependsOn: ["zeiterfassung"],
  tabs: [
    { href: "/month", label: "Monthly report", short: "Monthly" },
  ],
  routes: ["/month"],
});
