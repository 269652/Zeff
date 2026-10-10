import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ACCOUNT_NAME } from "@k/db";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: { default: "Zeff Knowledge", template: "%s · Zeff Knowledge" } };

/** Zeff's look: its header (the name, the account it belongs to, the pages as pills), its width, its colours. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection(); // the account comes from the environment the server runs with, not the build
  return (
    <html lang="de" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight">Zeff</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Knowledge</span>
              {ACCOUNT_NAME && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{ACCOUNT_NAME}</span>}
            </Link>
            <nav className="flex flex-wrap items-center gap-0.5 sm:gap-1">
              <Link href="/" className="rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 transition sm:px-3 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Übersicht
              </Link>
              <Link href="/graph" className="rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 transition sm:px-3 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Graph
              </Link>
              <Link href="/eigenes" className="rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 transition sm:px-3 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Eigenes Wissen
              </Link>
              <Link href="/plugins" className="rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 transition sm:px-3 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Plugins
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
