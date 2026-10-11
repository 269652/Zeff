import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { t } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Plugin docs") };
}

/** The documents of docs/plugins/, in reading order (the file's name). */
const FILES = ["README", "manifest", "api", "panels", "hooks", "security"];

/** The docs read like on GitHub (relative .md links); here the nav links to the pages, so those links become plain text. */
const plainLinks = (md: string) => md.replace(/\[([^\]]+)\]\(([a-z-]+)\.(?:md|json)(?:#[^)]*)?\)/gi, "$1");

/**
 * /ext/docs — the documentation of external plugins (docs/plugins/*.md, shipped with Zeff), so the
 * packaged app has it too. /ext/docs/api, /ext/docs/panels …
 */
export default async function PluginDocsPage({ params }: { params: Promise<{ name?: string[] }> }) {
  const { name } = await params;
  const page = (name?.[0] ?? "README").replace(/\.md$/, "");
  const file = FILES.find((f) => f.toLowerCase() === page.toLowerCase());
  if (!file || (name?.length ?? 0) > 1) notFound();
  // (Literal texts: the language bundles are found by them.)
  const labels: Record<string, string> = { README: t("Overview"), manifest: t("Manifest"), api: t("API"), panels: t("Panels"), hooks: t("Hooks"), security: t("Security") };
  let text: string;
  try {
    text = fs.readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "docs", "plugins", `${file}.md`), "utf8");
  } catch {
    notFound();
  }
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <nav className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800" aria-label={t("Plugin docs")}>
        {FILES.map((f) => (
          <Link
            key={f}
            href={f === "README" ? "/ext/docs" : `/ext/docs/${f}`}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${f === file ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
          >
            {labels[f]}
          </Link>
        ))}
        <Link href="/plugins" className="ml-auto px-3 py-1.5 text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          {t("Plugins →")}
        </Link>
      </nav>
      <article className="docs">
        <Markdown text={plainLinks(text)} />
      </article>
    </div>
  );
}
