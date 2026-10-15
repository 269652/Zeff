import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import Link from "next/link";
import { connection } from "next/server";
import { CheckAllLoginsButton } from "@/components/LoginButtons";
import { LoginsList } from "@/components/LoginsList";
import { listLogins } from "@/lib/logins";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Browser sign-ins") };
}

/**
 * Logins: every service the installed plugins reach through the automation Chrome, and whether
 * you're signed in there — a check asks the plugin's driver (read-only); "Anmelden" brings the
 * service's page up in that Chrome, where you sign in yourself (Zeff never types credentials).
 */
export default async function LoginsPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  await connection();
  const setup = (await searchParams).setup === "1";
  const { chrome } = await listLogins();
  return (
    <div className="page">
      <div className="page-aside">
        <h1 className="text-lg font-semibold">{t("Browser sign-ins")}</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "Where the installed plugins read (and, on your click, write): each site in this account's automation Chrome. “Sign in” brings it to the front there — you sign in yourself, Zeff never types credentials. “Check” asks the plugin whether you're signed in, and opens nothing.",
          )}
        </p>
        <p className="text-sm text-zinc-500">
          {rich(t("These are the logins in the automation Chrome. Services that Zeff reads through an API (OAuth) are set up under <link>Connections</link>."), {
            link: (s) => (
              <Link href="/connections" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {s}
              </Link>
            ),
          })}
        </p>
        <p className="text-xs text-zinc-400">
          {chrome.running
            ? t("Automation Chrome: {endpoint} — running", { endpoint: chrome.endpoint })
            : t("Automation Chrome: {endpoint} — not running (“Sign in” starts it)", { endpoint: chrome.endpoint })}
        </p>
        <CheckAllLoginsButton />
      </div>

      {setup && (
        <section className="card border-indigo-200 bg-indigo-50 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
          <p className="font-medium">{t("Last step of the setup: sign in to each service.")}</p>
          <p className="text-zinc-600 dark:text-zinc-300">
            {rich(t("For each entry “Sign in”, sign in in the automation Chrome, then “Check”. Then <link>off you go</link>."), {
              link: (s) => (
                <Link href="/" className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {s}
                </Link>
              ),
            })}
          </p>
        </section>
      )}

      <LoginsList />
    </div>
  );
}
