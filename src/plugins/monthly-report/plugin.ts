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
  // The report's month view (the week/month toggle); its own menu entry only without the weekly report.
  apps: [{ href: "/month", label: "Report", short: "Report", hint: "Week and month: hours, bookings, what's missing", unless: "weekly-report" }],
  routes: ["/month"],
});
