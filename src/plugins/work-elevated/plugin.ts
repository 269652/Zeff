import { definePlugin } from "../define";

/** Admin sessions: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "work-elevated",
  order: 90,
  name: "Admin sessions",
  description: "Live Claude sessions on the Code tab as administrator (Windows): installing software, services, system settings, anything that needs elevation. Each time Windows asks you (UAC) — or, set up once, a scheduled task starts them without asking.",
  category: "app",
  defaultInstalled: false,
  beta: "An administrator session can change anything on this computer — and in Bypass or Auto mode it does so without asking you first. Use Ask mode unless you know what it will do. Automatic start (the scheduled task) means no prompt at all: anything that can write to your user profile could get a process elevated through it. Set it up only on a computer you alone use.",
  requires: "Windows, and an administrator account (UAC).",
  dependsOn: ["work", "claude-cli"],
  settings: { href: "/work/admin", what: "Ask Windows each time (UAC), or start them without asking (a scheduled task, set up once)" },
  routes: ["/work/admin"],
});
