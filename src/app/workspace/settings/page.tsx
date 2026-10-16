import { redirect } from "next/navigation";

/** The Workspace's settings: their first tab. */
export default function WorkspaceSettings() {
  redirect("/workspace/settings/sources");
}
