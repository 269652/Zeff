import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { trash } from "@/plugins/workspace/store";
import { TrashList } from "@/plugins/workspace/ui/Trash";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Trash") };
}

export default async function TrashPage() {
  await connection();
  if (!isInstalled("workspace")) return null;
  return <TrashList items={trash()} />;
}
