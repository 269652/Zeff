import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SyncSettingsList } from "@/components/SyncSettingsList";

export const metadata: Metadata = { title: "Sync settings" };

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
        <h1 className="text-lg font-semibold">Sync settings</h1>
        <p className="text-sm text-zinc-500">
          How often each sync runs by itself — every installed plugin brings its part. Nothing runs by itself between 19:00 and 08:00; “Sync now” and the sync menu always work.
        </p>
        <p className="text-sm text-zinc-500">
          What a sync needs to read — the sign-in in the automation Chrome — is under{" "}
          <Link href="/logins" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Sign-ins
          </Link>
          .
        </p>
      </div>

      <SyncSettingsList />
    </div>
  );
}
