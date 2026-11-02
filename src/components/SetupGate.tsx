"use client";

import Link from "next/link";
import { usePagePathname } from "@/lib/use-page-pathname";
import { useT } from "@/components/I18nProvider";

/**
 * A Zeff (or account) not set up yet: nothing but a way into the setup assistant — except on the
 * pages the assistant itself leads to (its steps, the plugins' settings, the sign-ins …).
 */
export function SetupGate({ pending, allowed, account, children }: { pending: boolean; allowed: string[]; account?: string; children: React.ReactNode }) {
  const t = useT();
  const pathname = usePagePathname();
  if (!pending || allowed.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return children;
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <section className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{account ? t("“{account}” is new", { account }) : t("Welcome to Zeff")}</h1>
        <p className="text-sm text-zinc-500">
          {t(
            "The setup assistant walks you through plugins, settings and sign-ins — and at the end fetches all data and runs the AI steps on it for the first time.",
          )}
        </p>
        <Link href="/setup" className="btn btn-primary">
          {t("Start setup")}
        </Link>
      </section>
    </div>
  );
}
