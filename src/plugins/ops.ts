import { opPlugin } from "@/lib/boards/shared";
import { isInstalled } from "./state";

/** An operation Zeff can do now: Jira's always, a Teams message or GitLab one while its plugin is installed. */
export const opAvailable = (type: string) => {
  const p = opPlugin(type);
  return !p || isInstalled(p);
};
