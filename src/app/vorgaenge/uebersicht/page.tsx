import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { isInstalled } from "@/plugins/state";

/** The debt overview lives in the Workspace now — the Finances plugin's database "Debts and claims" (its overview view). */
export default async function DebtOverviewPage() {
  await connection();
  if (!isInstalled("finances")) return <PluginNotInstalled id="finances" />;
  const id = await (await import("@/plugins/finances/database")).ensureDebtsDatabase();
  redirect(id ? `/workspace/${id}` : "/workspace");
}
