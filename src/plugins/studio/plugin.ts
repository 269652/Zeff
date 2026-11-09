import { definePlugin } from "../define";

/** Studio: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "studio",
  order: 129,
  name: "Studio",
  description:
    "Builds what your Zeff apps do: flows of nodes that fetch from the web, look things up, let the AI pick out fields, write rows, branch and loop, run JavaScript in a sandbox, wait for your approval or a time — drawn as a canvas, each node's input and output in the run console. Lifecycles make a status field a state machine with transitions, guards and required fields. Secrets keep API keys out of every log. A copilot builds and changes flows on request.",
  category: "app",
  defaultInstalled: false,
  dependsOn: ["workspace"],
  beta: "New and still changing. A flow only reaches what you grant it (web addresses, databases it writes, the AI, sending) — what the AI asks for waits for you. Scripts run in a sandbox without network or files, but check a flow before you let it run on a schedule.",
  apps: [{ href: "/studio", label: "Studio", short: "Studio", hint: "Flows, lifecycles and secrets of your apps" }],
  routes: ["/studio"],
});
