import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { aboutMe } from "@/lib/about-me";
import { promptHref } from "@/lib/prompts";
import { AboutMeForm } from "@/components/AboutMeForm";
import { isInstalled } from "@/plugins/state";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("About me") };
}

/**
 * Settings → About me: what Zeff and its AI should know about you — one record (lib/about-me.ts), the same one the People
 * app shows beside your name, the AI settings' "Context about you" and its page in System → Prompts.
 */
export default async function AboutMePage() {
  await connection();
  const page = await promptHref("llm-context").catch(() => null);
  return (
    <div className="page">
      <div className="page-aside">
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← {t("All settings")}
        </Link>
        <h1 className="text-lg font-semibold">{t("About me")}</h1>
        <p className="max-w-[75ch] text-sm text-zinc-500">
          {t("What Zeff should know about you — your job, what matters to you, how you like things done. It goes in front of every AI task, every worker and agent.")}
        </p>
      </div>
      <section className="card space-y-3 p-4">
        <AboutMeForm initial={aboutMe()} />
        <p className="text-xs text-zinc-500">
          {t("The same text is in:")}{" "}
          {isInstalled("people") && (
            <>
              <Link href="/personen" className="text-indigo-600 hover:underline dark:text-indigo-400">
                {t("People (beside your name)")}
              </Link>
              {" · "}
            </>
          )}
          <Link href="/settings/ai" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("AI settings")}
          </Link>
          {page && (
            <>
              {" · "}
              <Link href={page} className="text-indigo-600 hover:underline dark:text-indigo-400">
                {t("System → Prompts → Context about you")}
              </Link>
            </>
          )}
          {" — "}
          {t("change it in any of them, all show the change.")}
        </p>
      </section>
    </div>
  );
}
