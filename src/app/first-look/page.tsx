import type { Metadata } from "next";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { firstLook } from "@/lib/first-look";
import { FirstLookView } from "./FirstLookView";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Your first look") };
}

/** The first look (lib/first-look.ts): what Zeff found in the last 30 days — forgotten promises, what falls due, unbooked time. */
export default async function FirstLookPage() {
  await connection();
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <FirstLookView look={await firstLook()} />
    </div>
  );
}
