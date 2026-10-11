import type { Metadata } from "next";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { listTodos } from "@/lib/boards/store";
import { t } from "@/lib/i18n/server";
import { documentSettings } from "@/plugins/documents/extract";
import { DocumentsApp } from "@/plugins/documents/DocumentsApp";
import { pollAbstracts, pullAbstracts, startProcessing } from "@/plugins/documents/process";
import { listDocuments, queuedDocuments, uncompiledDocuments } from "@/plugins/documents/store";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Documents") };
}

/**
 * Documents: the store — drop files, see what became of them, hover one for its abstract, attach one
 * to a todo. What waits (a restart interrupted its reading) is picked up here, and the abstracts the
 * knowledge server has by now are fetched.
 */
export default async function DocumentsPage() {
  await connection();
  if (!isInstalled("documents")) return <PluginNotInstalled id="documents" />;
  if (queuedDocuments().length) startProcessing();
  const knowledge = isInstalled("knowledge");
  if (knowledge && uncompiledDocuments().length) {
    await pullAbstracts();
    if (uncompiledDocuments().length) pollAbstracts();
  }
  const todos = listTodos({ status: "open" }).map((x) => ({ id: x.id, ref: x.ref, text: x.text }));
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Documents")}</h1>
        <p className="text-sm text-zinc-500">
          {t("Your documents, pictures and recordings: Zeff reads the text out of them{knowledge}. Hover one for its abstract; attach one to a todo to give it as context.", {
            knowledge: knowledge ? t(" and the knowledge server compiles them — searchable, and context for your todos") : "",
          })}
        </p>
      </div>
      <DocumentsApp docs={listDocuments()} todos={todos} transcriber={documentSettings().transcriber} knowledge={knowledge} />
    </div>
  );
}
