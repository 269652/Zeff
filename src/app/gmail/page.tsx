import { moved } from "@/lib/moved";

/** Gmail's settings (its accounts) are a part of Connections now (/settings/connections#gmail-accounts). */
export default async function GmailSettingsPage() {
  return moved("/settings/connections", undefined, "gmail-accounts");
}
