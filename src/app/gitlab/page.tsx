import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { redirect } from "@/lib/redirect";
import { isInstalled } from "@/plugins/state";

export const metadata: Metadata = { title: "GitLab" };

/**
 * GitLab lives in the Workspace: its database "GitLab" (the synced items) shown by GitLab's app view (src/plugins/gitlab/view-template.meta.ts)
 * — yours and the AI's to change. This is the way in the links have always used (/gitlab?kind=mr&q=…).
 */
export default async function GitlabPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  await connection();
  if (!isInstalled("gitlab")) return <PluginNotInstalled id="gitlab" />;
  const id = await (await import("@/plugins/gitlab/workspace-app")).gitlabApp();
  if (!id) return <PluginNotInstalled id="workspace" />;
  const sp = await searchParams;
  const link = new URLSearchParams(Object.entries({ kind: sp.kind, q: sp.q }).flatMap(([k, v]) => (v ? [[`s.${k}`, v]] : []))).toString();
  return redirect(`/workspace/${id}${link ? `?${link}` : ""}`);
}
