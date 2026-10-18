import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import { PROVIDERS } from "@/lib/connectors/providers";
import { apiConnected, clientOf, driverOf, extraOf, getConnector } from "@/lib/connectors/store";
import { isInstalled } from "@/plugins/state";
import type { PluginId } from "@/plugins/catalog";
import { ProviderConnection, type ProviderView } from "./ProviderConnection";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Connections") };
}

/** Connections: for each service, whether Zeff reads it through the automation Chrome or through its API — and the OAuth sign-ins the APIs need. */
export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string; provider?: string }> }) {
  await connection();
  const sp = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? "http";
  const view = (id: "google" | "microsoft"): ProviderView => {
    const row = getConnector(id);
    const client = clientOf(id);
    return {
      provider: id,
      label: PROVIDERS[id].label,
      clientId: client.clientId,
      hasSecret: !!client.clientSecret,
      tenant: id === "microsoft" ? (extraOf("microsoft").tenant ?? "") : "",
      gmailWrite: id === "google" && extraOf("google").gmailWrite === "1",
      granted: {
        gmailRead: row.scope.includes("gmail.readonly") || row.scope.includes("gmail.modify"),
        gmailModify: row.scope.includes("gmail.modify"),
        calendar: row.scope.includes("calendar"),
      },
      connected: apiConnected(row),
      account: row.account,
      redirectUri: `${proto}://${host}/api/connectors/${id}/callback`,
      services: PROVIDERS[id].services.map((s) => ({ service: s.service, label: s.label, driver: driverOf(s.service), installed: isInstalled(s.plugin as PluginId) })),
    };
  };
  // (The sign-in's answer comes back with ?provider=… — the error or the "connected" belongs to that card.)
  const forMicrosoft = sp.provider === "microsoft";
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Connections")}</h1>
        <p className="text-sm text-zinc-500">
          {t("How Zeff reaches each service. The automation Chrome needs nothing set up but has to run, and a service can change its web page at any time. An API with your own OAuth sign-in is the stable way: it syncs in the background whenever you like, and Zeff only asks to read.")}
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          {rich(t("Signing in to a site in the automation Chrome is a different thing: see <link>Browser sign-ins</link>."), {
            link: (s) => (
              <Link href="/logins" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
          })}
        </p>
        <p className="mt-2 text-sm">
          {t("GitLab has its own connection on")}{" "}
          <Link href="/gitlab" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("its page")}
          </Link>
          .
        </p>
      </div>
      <ProviderConnection v={view("google")} error={forMicrosoft ? null : (sp.error === "client" ? t("Set your OAuth client first.") : (sp.error ?? null))} justConnected={sp.connected === "1" && !forMicrosoft} />
      <ProviderConnection v={view("microsoft")} error={forMicrosoft ? (sp.error === "client" ? t("Set your OAuth client first.") : (sp.error ?? null)) : null} justConnected={sp.connected === "1" && forMicrosoft} />
    </div>
  );
}
