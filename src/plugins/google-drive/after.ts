/** Right after a backup is made: the Google Drive extension for Backups copies it at once (when it is on and connected). */
export async function afterBackup(): Promise<void> {
  const { stepAvailable } = await import("@/plugins/state");
  if (!stepAvailable("drivebackup")) return;
  (await import("@/lib/sync/registry")).startSync("drivebackup");
}
