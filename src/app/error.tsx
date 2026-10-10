"use client";

import { useEffect } from "react";

/** A page that failed while rendering: what went wrong, and a way to try again (re-renders the page). */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-[calc(100dvh-7rem)] items-center justify-center p-4">
      <section className="card w-full max-w-md space-y-3 p-6 text-center" role="alert">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="alert-error text-left break-words">{error.message || "An unexpected error occurred."}</p>
        {error.digest && <p className="text-xs text-zinc-400">Error ID: {error.digest}</p>}
        <button type="button" onClick={() => retry()} className="btn btn-primary btn-sm">
          Try again
        </button>
      </section>
    </div>
  );
}
