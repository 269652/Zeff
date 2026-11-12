import { definePlugin } from "../define";

/**
 * Learn: what it is and what it brings (its manifest). It is built with Zeff itself — an external plugin (./bundled) with a package of
 * databases, one app view, flows and server functions — and set up on one click on the /learn page (setup.ts).
 */
export default definePlugin({
  id: "learn",
  order: 272,
  name: "Learn",
  description:
    "A learning platform built with Zeff itself: pick a topic and the AI researches it on the web and plans it as a skill tree of small steps. Each step is a lesson with the AI as your teacher in a chat, who leaves cards, builds exercises and masters the step when you have shown the goal. Cards come back when you are about to forget them; experience, levels, a streak, study times in your calendar and a todo per lesson keep you going. It is a package of Workspace databases, an app view, flows and server functions (plugin “Learn (external)”) — you can open every part of it and change it.",
  category: "app",
  defaultInstalled: false,
  apps: [{ href: "/learn", label: "Learn", short: "Learn 2", hint: "Courses, skill trees, lessons with the AI" }],
  routes: ["/learn"],
  beta: "The lessons and the planning use your AI account. Learn's server functions run in the Notebook (code running must be on); the first visit sets it up with your OK.",
});
