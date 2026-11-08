import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { Studio } from "@/plugins/studio/ui/Studio";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Studio") };
}

/** The Studio (its plugin): the flows, lifecycles and secrets of your apps. */
export default async function StudioPage() {
  await connection();
  if (!isInstalled("studio") || !isInstalled("workspace")) return <p className="text-sm text-zinc-500">{t("The Studio plugin is off (Menu → Plugins).")}</p>;
  return (
    <Suspense>
      <Studio />
    </Suspense>
  );
}
