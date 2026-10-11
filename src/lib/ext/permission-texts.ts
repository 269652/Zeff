import { t } from "@/lib/i18n/server";
import type { PERMISSIONS } from "./manifest";

/** The permissions in words, translated (literal texts: the language bundles are found by them; tests/ext.test.ts keeps them equal to PERMISSIONS). */
export const permissionTexts = (): Record<keyof typeof PERMISSIONS, string> => ({
  "work.read": t("Read Work sessions, their logs and results"),
  "work.write": t("Start, continue and stop Work sessions"),
  "todos.read": t("Read your todos"),
  "todos.write": t("Add todos"),
  prompt: t("Add rules to what Work's workers are told"),
  exec: t("Run programs on this computer (event hooks, MCP servers) — with your rights"),
  network: t("Let its panels contact other websites (otherwise they can't)"),
});
