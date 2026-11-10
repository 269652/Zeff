import { definePlugin } from "../define";

/** Learn: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "learn",
  order: 272,
  name: "Learn",
  description:
    "A learning platform: pick a topic (differential geometry, French …) and Claude researches it — scholarly sources from OpenAlex, Semantic Scholar and arXiv, curricula on the web — and writes a plan over years, phases, skills and small steps. It becomes a skill tree you work through path by path, the way that interests you most, with experience, levels, a streak and badges. Each step is a lesson with Claude as your teacher in a chat, with interactive widgets it builds on the fly (quizzes, plots with sliders, 3D surfaces, formulas). Cards to review come back in good time as a todo; study times go into a calendar.",
  category: "app",
  defaultInstalled: false,
  apps: [{ href: "/learn", label: "Learn", short: "Learn", hint: "Courses, skill trees, lessons with Claude" }],
  routes: ["/learn"],
  // Workers just for the lessons (their todos' source: chatSource("learn") — teacher.ts), on top of the general ones.
  workerPools: [{ source: "Zeff-Chat:learn", label: "Learn" }],
  beta: "New: the research and the lessons use your Claude subscription (a plan's research takes a few minutes and some of your usage). Widgets run sandboxed — no network, no access to Zeff — and only report a score.",
});
