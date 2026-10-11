import { opPlugin } from "@/lib/boards/shared";
import { actionExtensionOk } from "./extension-state";
import { isInstalled } from "./state";

/**
 * An operation Zeff can do now: Jira's always, a Teams message or GitLab one while its plugin is
 * installed — and one an extension brings (Keep's "Notiz anlegen") only while that's on.
 */
export const opAvailable = (type: string) => {
  const p = opPlugin(type);
  return (!p || isInstalled(p)) && actionExtensionOk(type);
};
