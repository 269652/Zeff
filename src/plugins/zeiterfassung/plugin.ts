import { definePlugin } from "../define";

/** Time tracking: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "zeiterfassung",
  order: 10,
  name: "Time tracking",
  description: "Booking your time: jobs and projects, working hours and absences, the analysis of your entries — with the weekly and the monthly report as its parts. The time-sheet systems build on it.",
  category: "app",
  defaultInstalled: true,
  settings: { href: "/settings/time", what: "Working hours, absences, rules for meetings and reports" },
  nav: [
    { href: "/jobs", label: "Jobs", hint: "Job numbers to book on" },
    { href: "/projects", label: "Projects", hint: "Work grouped under a job" },
    { href: "/settings/time", label: "Schedule", hint: "Working hours & absences" },
    { href: "/analysis", label: "Analysis", hint: "Charts of your bookings" },
    { href: "/feierabend", label: "End of day", hint: "Book the day in one click" },
  ],
  routes: ["/jobs", "/projects", "/settings/time", "/analysis", "/feierabend"],
  // The reports were plugins of their own: they keep their ids (and what you set for them).
  features: [
    {
      id: "weekly-report",
      order: 20,
      name: "Weekly report",
      description: "Booking with the week in view: hours per job and day, breaks, flex time, the week's report, suggestions and “Done today” to take over.",
      defaultInstalled: true,
      // One "Report" entry in the menu (not a tab): the week here, the month a toggle away (/month).
      apps: [{ href: "/", label: "Report", short: "Report", hint: "Week and month: hours, bookings, what's missing" }],
      routes: ["/"],
    },
    {
      id: "monthly-report",
      order: 30,
      name: "Monthly report",
      description: "The month as a calendar and per job: what's booked, what's missing, what's approved.",
      defaultInstalled: true,
      // The report's month view (the week/month toggle); its own menu entry only without the weekly report.
      apps: [{ href: "/month", label: "Report", short: "Report", hint: "Week and month: hours, bookings, what's missing", unless: "weekly-report" }],
      routes: ["/month"],
    },
  ],
});
