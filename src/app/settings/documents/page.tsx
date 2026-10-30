import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { DocumentSettingsForm } from "@/plugins/documents/DocumentSettingsForm";
import { documentSettings } from "@/plugins/documents/settings";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Documents settings") };
}

/** Settings → Documents: how audio is read, and Poppler for PDFs. (Mail attachments → Documents is under Settings → Mail.) */
export default async function DocumentsSettingsPage() {
  await connection();
  if (!isInstalled("documents")) return <PluginNotInstalled id="documents" />;
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("All settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Documents settings")}</h1>
        <p className="text-sm text-zinc-500">
          {t("How audio and difficult PDFs are read.")} <Link href="/documents" className="text-indigo-600 hover:underline dark:text-indigo-400">{t("Open Documents")}</Link>
        </p>
      </div>
      <DocumentSettingsForm settings={documentSettings()} />
    </div>
  );
}
