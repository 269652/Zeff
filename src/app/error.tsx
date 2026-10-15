"use client";

import { useEffect } from "react";
import { useT } from "@/components/I18nProvider";

/** A page that failed while rendering: what went wrong, and a way to try again (re-renders the page). */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-[calc(100dvh-7rem)] items-center justify-center p-4">
      <section className="card w-full max-w-md space-y-3 p-6 text-center" role="alert">
        <h1 className="text-lg font-semibold">{t("Something went wrong")}</h1>
        <p role="alert" className="alert-error text-left break-words">{error.message || t("An unexpected error occurred.")}</p>
        {error.digest && <p className="text-xs text-zinc-400">{t("Error ID: {id}", { id: error.digest })}</p>}
        <button type="button" onClick={() => retry()} className="btn btn-primary btn-sm">
          {t("Try again")}
        </button>
      </section>
    </div>
  );
}
