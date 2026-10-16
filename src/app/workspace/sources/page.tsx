import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { sourcesOverview } from "@/plugins/workspace/sources";
import { SourcesView } from "@/plugins/workspace/ui/Sources";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Data sources") };
}

/** The Workspace's data sources: Jira, Google Keep, your todos — and the databases they keep. */
export default async function SourcesPage() {
  await connection();
  if (!isInstalled("workspace")) return null;
  return <SourcesView sources={sourcesOverview()} />;
}
