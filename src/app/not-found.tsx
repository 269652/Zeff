import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Not found") };
}

/** A page that isn't there (a wrong address, a todo or board that's gone): say so, and the way back to Today. */
export default function NotFound() {
  return (
    <div className="flex h-[calc(100dvh-7rem)] items-center justify-center p-4">
      <section className="card w-full max-w-md space-y-3 p-6 text-center">
        <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">404</p>
        <h1 className="text-lg font-semibold">{t("Page not found")}</h1>
        <p className="text-sm text-zinc-500">{t("This page doesn't exist — the address may be wrong, or what it showed was removed.")}</p>
        <Link href="/heute" className="btn btn-primary btn-sm">
          {t("Back to Today")}
        </Link>
      </section>
    </div>
  );
}
