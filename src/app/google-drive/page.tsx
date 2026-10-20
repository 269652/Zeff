import type { Metadata } from "next";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getDb, schema } from "@/db";
import { t } from "@/lib/i18n/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { GoogleDriveSettings, type DriveStepView } from "@/plugins/google-drive/GoogleDriveSettings";
import { defaultFolderName, driveRow, hasFullAccess, isConnected } from "@/plugins/google-drive/config";
import { driveCounts } from "@/plugins/google-drive/sync";
import { isInstalled, stepAvailable } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Google Drive") };
}

/** Google Drive: your OAuth client, signing in, what syncs — and how the last syncs went. */
export default async function GoogleDrivePage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  await connection();
  if (!isInstalled("google-drive")) return <PluginNotInstalled id="google-drive" />;
  const sp = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? "http";
  const row = driveRow();
  const records = getDb()
    .select()
    .from(schema.syncState)
    .where(inArray(schema.syncState.key, ["drivebackup", "drivedocs"]))
    .all();
  const stepView = (key: "drivebackup" | "drivedocs", name: string): DriveStepView => {
    const r = records.find((x) => x.key === key);
    return { key, name, on: stepAvailable(key), lastAt: r?.lastAt ?? null, lastOk: r?.lastOk ?? null, lastMessage: r?.lastMessage ?? null };
  };
  const counts = driveCounts();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Google Drive")}</h1>
        <p className="text-sm text-zinc-500">{t("A copy of your documents (and, if you turn it on, your backups) in your own Google Drive — and, if you want, what you add there comes into Zeff.")}</p>
        <p className="mt-2 text-sm">
          <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Turn each sync on or off under Plugins")}
          </Link>
        </p>
      </div>
      <GoogleDriveSettings
        error={sp.error === "client" ? t("Set your OAuth client first.") : (sp.error ?? null)}
        justConnected={sp.connected === "1"}
        redirectUri={`${proto}://${host}/api/google-drive/callback`}
        s={{
          clientId: row.clientId,
          hasSecret: !!row.clientSecret,
          connected: isConnected(row),
          email: row.email,
          connectedAt: row.connectedAt,
          fullAccess: hasFullAccess(row),
          folderName: row.folderName,
          defaultFolder: defaultFolderName(),
          pullFolders: (await import("@/plugins/google-drive/folders")).pullFolders(),
          mirrorBackupRetention: row.mirrorBackupRetention,
          uploadUnencrypted: row.uploadUnencrypted,
          pullDocuments: row.pullDocuments,
          backupsInDrive: counts.backups,
          documentsInDrive: counts.documents,
        }}
        steps={[stepView("drivedocs", t("Documents")), stepView("drivebackup", t("Backups"))]}
      />
    </div>
  );
}
