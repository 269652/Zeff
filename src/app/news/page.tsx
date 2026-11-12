import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { redirect } from "@/lib/redirect";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("News") };
}

/**
 * News lives in the Workspace: its page "News" shown by News' app view (src/plugins/news/view-template.meta.ts). This is the way in the links
 * have always used (/news?view=saved&source=3&category=Tech): it opens that page with the view, the source and the category set.
 */
export default async function NewsPage({ searchParams }: { searchParams: Promise<{ view?: string; source?: string; category?: string }> }) {
  await connection();
  if (!isInstalled("news")) return <PluginNotInstalled id="news" />;
  const id = await (await import("@/plugins/news/workspace-app")).newsApp();
  if (!id) return <PluginNotInstalled id="workspace" />;
  const sp = await searchParams;
  const link = new URLSearchParams(Object.entries({ view: sp.view, source: sp.source, category: sp.category }).flatMap(([k, v]) => (v ? [[`s.${k}`, v]] : []))).toString();
  return redirect(`/workspace/${id}${link ? `?${link}` : ""}`);
}
