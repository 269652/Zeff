"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useT } from "@/components/I18nProvider";

/** While the compile run goes in the background, the page follows it: who's being compiled, how far. */
export function CompileProgress({ done, total, current }: { done: number; total: number; current: string }) {
  const t = useT();
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <p className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300" role="status">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-indigo-500" aria-hidden />
      {t("Compiling … {done} of {total}", { done, total })}
      {current && <span className="truncate text-zinc-400">· {current}</span>}
    </p>
  );
}
