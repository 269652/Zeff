import { redirect } from "next/navigation";

/** The data sources are a tab of the Workspace's settings now. */
export default function SourcesPage() {
  redirect("/workspace/settings/sources");
}
