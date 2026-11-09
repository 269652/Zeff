import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { readGate } from "@/lib/gate";
import { t } from "@/lib/i18n/server";
import { tailscaleState } from "@/lib/tailscale";
import { MobileAccess } from "./MobileAccess";
import { PhoneConflicts } from "./PhoneConflicts";
import { replicaConflicts } from "@/lib/replica/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Mobile access") };
}

/** Settings → Mobile access: Zeff on your phone, the database staying here — through Tailscale, with a password. */
export default async function MobileAccessPage() {
  await connection();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Mobile access")}</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "Zeff stays on this computer — the database, the chats, the syncs. Your phone reaches it through Tailscale: a private network of your own devices, encrypted end to end, nothing open to the internet. This computer has to be on.",
          )}
        </p>
        <Link href="/settings" className="block text-sm text-zinc-500 hover:underline">
          {t("All settings")}
        </Link>
      </div>
      <div className="space-y-6">
        <MobileAccess state={await tailscaleState()} hasPassword={!!readGate()} />
        <PhoneConflicts conflicts={replicaConflicts().slice(-50)} />
      </div>
    </div>
  );
}
