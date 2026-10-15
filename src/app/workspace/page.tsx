import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { recent } from "@/plugins/workspace/store";
import { templateMetas } from "@/plugins/workspace/templates";
import { Home } from "@/plugins/workspace/ui/Home";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Workspace") };
}

/** The Workspace's start: what you opened lately, ready-made pages, an AI that answers from your pages. */
export default async function WorkspaceHome() {
  await connection();
  if (!isInstalled("workspace")) return null;
  return <Home recent={recent(10)} templates={templateMetas()} llm={isInstalled("llm")} />;
}
