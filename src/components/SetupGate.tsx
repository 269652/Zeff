"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * A Zeff (or account) not set up yet: nothing but a way into the setup assistant — except on the
 * pages the assistant itself leads to (its steps, the plugins' settings, the sign-ins …).
 */
export function SetupGate({ pending, allowed, account, children }: { pending: boolean; allowed: string[]; account?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  if (!pending || allowed.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return children;
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <section className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight">{account ? `„${account}“ ist neu` : "Willkommen bei Zeff"}</h1>
        <p className="text-sm text-zinc-500">Der Einrichtungs-Assistent führt durch Plugins, Einstellungen und Anmeldungen — und holt am Ende alle Daten und wertet sie zum ersten Mal aus.</p>
        <Link href="/setup" className="btn btn-primary">
          Einrichtung starten
        </Link>
      </section>
    </div>
  );
}
