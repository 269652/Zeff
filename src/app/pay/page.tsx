import type { Metadata } from "next";
import { t } from "@/lib/i18n/server";
import { PayView } from "./PayView";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Transfer") };
}

/**
 * A transfer as a GiroCode (a todo's or a case's "Transfer"): the code to scan with your banking app, every field to
 * copy, the amount yours to change. Nothing is sent from here — you send the money in your bank.
 */
export default async function PayPage({ searchParams }: { searchParams: Promise<{ name?: string; iban?: string; bic?: string; amount?: string; purpose?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-lg font-semibold">{sp.name ? t("Transfer to {name}", { name: sp.name }) : t("Transfer")}</h1>
      <PayView name={sp.name ?? ""} iban={sp.iban ?? ""} bic={sp.bic ?? ""} amount={sp.amount ?? ""} purpose={sp.purpose ?? ""} />
    </div>
  );
}
