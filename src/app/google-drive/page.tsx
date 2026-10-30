import { moved } from "@/lib/moved";

/** Google Drive's settings are a part of Connections now (/settings/connections#google-drive) — a sign-in's answer with them (?provider=drive). */
export default async function GoogleDrivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return moved("/settings/connections", Promise.resolve(sp.error || sp.connected ? { ...sp, provider: "drive" } : {}), "google-drive");
}
