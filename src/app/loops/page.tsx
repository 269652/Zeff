import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";

/** The open loops are a part of Today now: the old address (and its view) leads there. */
export default async function LoopsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await connection();
  if (!isInstalled("loops")) return <PluginNotInstalled id="loops" />;
  const { view } = await searchParams;
  redirect(view ? `/heute?loops=${encodeURIComponent(view)}#loops` : "/heute#loops");
}
