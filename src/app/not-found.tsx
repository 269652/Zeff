import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not found" };

/** A page that isn't there (a wrong address, a todo or board that's gone): say so, and the way back to Today. */
export default function NotFound() {
  return (
    <div className="flex h-[calc(100dvh-7rem)] items-center justify-center p-4">
      <section className="card w-full max-w-md space-y-3 p-6 text-center">
        <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">404</p>
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-zinc-500">This page doesn&apos;t exist — the address may be wrong, or what it showed was removed.</p>
        <Link href="/heute" className="btn btn-primary btn-sm">
          Back to Today
        </Link>
      </section>
    </div>
  );
}
