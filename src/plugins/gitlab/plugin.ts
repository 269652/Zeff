import { definePlugin } from "../define";

/** GitLab: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "gitlab",
  order: 360,
  actionsOrder: 20,
  name: "GitLab",
  description: "Reads merge requests, comments and branches — context, delivery (push, MR, merge) and replies to comments on a click.",
  category: "connector",
  defaultInstalled: true,
  requires: "The automation Chrome with GitLab, signed in (and git) — or GitLab's API with a token or your own sign-in.",
  settings: { href: "/gitlab", what: "Your GitLab's address" },
  nav: [
    { href: "/gitlab", label: "GitLab", hint: "Merge requests, comments & branches" },
  ],
  routes: ["/gitlab"],
  syncSteps: ["gitlab"],
  services: ["gitlab"],
});
