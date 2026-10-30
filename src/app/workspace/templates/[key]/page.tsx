import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { tree, type TreeItem } from "@/plugins/workspace/store";
import { previewTemplate } from "@/plugins/workspace/templates";
import { TemplatePreview } from "@/plugins/workspace/ui/TemplatePreview";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Templates") };
}

/** The pages a template can be made under: the tree in its order, each with its depth. */
function places(items: TreeItem[]): { id: number; title: string; depth: number }[] {
  const out: { id: number; title: string; depth: number }[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const i of items.filter((x) => x.parentId === parentId && x.kind === "page")) {
      out.push({ id: i.id, title: `${i.icon} ${i.title || t("Untitled")}`.trim(), depth });
      if (depth < 4) walk(i.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** A built-in template, read only: what it makes, as it would be made — to use it or to make it a template of yours. */
export default async function BuiltinTemplatePage({ params }: { params: Promise<{ key: string }> }) {
  await connection();
  if (!isInstalled("workspace")) return null;
  const key = decodeURIComponent((await params).key);
  let preview;
  try {
    preview = previewTemplate(key);
  } catch {
    notFound();
  }
  return <TemplatePreview key={key} preview={preview} places={places(tree())} />;
}
