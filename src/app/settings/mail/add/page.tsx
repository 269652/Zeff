import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { chooseMailMethodAction } from "@/plugins/imap-mail/server-actions";
import { MAIL_PROVIDERS, providerById } from "@/plugins/imap-mail/presets";
import { methodHint, methodLabel } from "@/plugins/imap-mail/ui/labels";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Add account") };
}

const card = "card block p-3 text-left hover:border-indigo-300 dark:hover:border-indigo-700";

/** Settings → E-Mail → Add account: first the provider, then one of the ways it can be read (only those Zeff has for it). */
export default async function AddMailAccountPage({ searchParams }: { searchParams: Promise<{ provider?: string }> }) {
  await connection();
  const sp = await searchParams;
  const p = sp.provider ? providerById(sp.provider) : null;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={p ? "/settings/mail/add" : "/settings/mail"} className="text-sm text-zinc-500 hover:underline">
        ← {p ? t("Back") : t("E-Mail accounts")}
      </Link>
      <h1 className="text-xl font-semibold">{p ? t("Add account: {provider}", { provider: p.id === "other" ? t("Other provider") : p.name }) : t("Add account")}</h1>
      {!p ? (
        <>
          <p className="text-sm text-zinc-500">{t("Where is the mailbox?")}</p>
          <div className="grid gap-2 sm:grid-cols-2" data-mail-providers>
            {MAIL_PROVIDERS.map((x) => (
              <Link key={x.id} href={`/settings/mail/add?provider=${x.id}`} className={card}>
                <span className="font-medium">{x.id === "other" ? t("Other provider") : x.name}</span>
                <span className="block text-xs text-zinc-500">{x.methods.map((m) => methodLabel(t, m)).join(" · ")}</span>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-500">{t("How should Zeff read it?")}</p>
          <div className="space-y-2" data-mail-methods>
            {p.methods.map((m) =>
              m === "api" || m === "browser" ? (
                <form key={m} action={chooseMailMethodAction}>
                  <input type="hidden" name="provider" value={p.id} />
                  <input type="hidden" name="method" value={m} />
                  <button className={`${card} w-full`}>
                    <span className="font-medium">{methodLabel(t, m)}</span>
                    <span className="block text-xs text-zinc-500">{methodHint(t, m)}</span>
                  </button>
                </form>
              ) : (
                <Link key={m} href={`/settings/mail/account/new?provider=${p.id}&method=${m}`} className={card}>
                  <span className="font-medium">{methodLabel(t, m)}</span>
                  <span className="block text-xs text-zinc-500">{methodHint(t, m)}</span>
                </Link>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
