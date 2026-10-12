import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DiagnosticsView } from "@/components/DiagnosticsView";
import { t } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Diagnostics") };
}

/** Diagnostics: something doesn't work — one report to read and send to whoever helps. */
export default async function DiagnosticsPage() {
  await connection();
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("Settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("Diagnostics")}</h1>
        <p className="text-sm text-zinc-500">
          {t("Something doesn't work? This collects what runs here — the programs found, the plugins, the sign-ins, how the last syncs went and the ends of the logs — into one text. Emails, tokens, passwords and your user folder are blacked out. Read it, then send it to whoever helps you. Zeff sends nothing by itself.")}
        </p>
        <Link href="/privacy" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          {t("What leaves this PC")}
        </Link>
      </div>
      <DiagnosticsView />
    </div>
  );
}
