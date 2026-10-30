import { moved } from "@/lib/moved";

/** The sync settings are a part of Connections now (/settings/connections#syncs; a sync's own anchor is its key there). */
export default async function SyncSettingsPage() {
  return moved("/settings/connections", undefined, "syncs");
}
