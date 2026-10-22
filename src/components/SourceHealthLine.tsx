"use client";

import Link from "next/link";
import { useTransition } from "react";
import { runSyncAction } from "@/app/actions";
import { toast } from "./Toaster";
import { useT } from "./I18nProvider";

/** A source that isn't well though its runs may say ok (silent, not running, its app changed). */
export type SourceIssue = { key: string; label: string; href: string; state: "stale" | "silent" | "drift"; word: string; reason: string };

/**
 * Heute's one line when a source isn't well — only then: which ones and why (the tooltip), "Sync now" for them, and
 * "Open self-test" (the sign-ins page, whose check looks at the app's contract) when an app changed.
 */
export function SourceHealthLine({ issues }: { issues: SourceIssue[] }) {
  const t = useT();
  const [pending, start] = useTransition();
  if (!issues.length) return null;
  const syncAll = () =>
    start(async () => {
      for (const i of issues.filter((x) => x.state !== "drift")) {
        const r = await runSyncAction(i.key);
        toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
      }
    });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status">
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t("Sources")}:</span>{" "}
        {issues.map((i, n) => (
          <span key={i.key}>
            {n > 0 && " · "}
            <Link href={i.href} className="hover:underline" title={i.reason}>
              {i.label} <span className="text-amber-700 dark:text-amber-300">{i.word}</span>
            </Link>
          </span>
        ))}
      </span>
      <span className="flex shrink-0 gap-1.5">
        {issues.some((i) => i.state !== "drift") && (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={syncAll} title={t("Run these syncs now")}>
            {pending ? t("Syncing…") : t("Sync now")}
          </button>
        )}
        {issues.some((i) => i.state === "drift") && (
          <Link href="/logins" className="btn btn-sm" title={t("Check the app against what its driver expects (Sign-ins → Check)")}>
            {t("Open self-test")}
          </Link>
        )}
        <Link href="/diagnostics#sources" className="btn btn-sm">
          {t("Details")}
        </Link>
      </span>
    </div>
  );
}
