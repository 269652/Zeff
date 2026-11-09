import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PluginNotInstalled } from "@/components/PluginNotInstalled";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { localAiConfig } from "@/plugins/local-ai/config";
import { LocalAiSettings } from "@/plugins/local-ai/LocalAiSettings";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Local AI") };
}

/** Settings → Local AI: the model on this computer (Ollama, LM Studio …) — its server, its model, and what goes to it. */
export default async function LocalAiSettingsPage() {
  await connection();
  if (!isInstalled("local-ai")) return <PluginNotInstalled id="local-ai" />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
        ← {t("Settings")}
      </Link>
      <h1 className="text-xl font-semibold">{t("Local AI")}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t("An AI on this computer: what it reads never leaves it. Smaller than the cloud AIs — good for reading mail and chats and finding todos, slower on a computer without a strong graphics card.")}
      </p>
      <LocalAiSettings initial={localAiConfig()} />
    </div>
  );
}
