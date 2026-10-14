import { definePlugin } from "../define";

/** Time tracking: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "zeiterfassung",
  order: 10,
  name: "Time tracking",
  description: "The foundation of booking: jobs and projects, working hours and absences, the analysis of your entries. The weekly and monthly reports and the time-sheet systems build on it.",
  category: "app",
  defaultInstalled: true,
  settings: { href: "/settings", what: "Working hours, absences, rules for meetings and reports" },
  nav: [
    { href: "/jobs", label: "Jobs", hint: "Job numbers to book on" },
    { href: "/projects", label: "Projects", hint: "Work grouped under a job" },
    { href: "/settings", label: "Schedule", hint: "Working hours & absences" },
    { href: "/analysis", label: "Analysis", hint: "Charts of your bookings" },
    { href: "/feierabend", label: "End of day", hint: "Book the day in one click" },
  ],
  routes: ["/jobs", "/projects", "/settings", "/analysis", "/feierabend"],
});
