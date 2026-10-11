import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";
import { connection } from "next/server";
import { SyncSettingsList } from "@/components/SyncSettingsList";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Sync settings") };
}

/**
 * Sync settings: how often each sync runs by itself — all in one place. Each installed plugin
 * brings its part (its settings module: src/plugins/<id>/sync-settings.ts); a sync two plugins
 * share (Mail) shows once.
 */
export default async function SyncSettingsPage() {
  await connection();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Sync settings")}</h1>
        <p className="text-sm text-zinc-500">
          {t("How often each sync runs by itself — every installed plugin brings its part. Nothing runs by itself between 19:00 and 08:00; “Sync now” and the sync menu always work.")}
        </p>
        <p className="text-sm text-zinc-500">
          {t("What a sync needs to read — the sign-in in the automation Chrome — is under")}{" "}
          <Link href="/logins" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Sign-ins")}
          </Link>
          .
        </p>
      </div>

      <SyncSettingsList />
    </div>
  );
}
