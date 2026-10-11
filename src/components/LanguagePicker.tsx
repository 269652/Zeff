"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setLanguageAction } from "@/app/actions";
import { useLang, useT } from "@/components/I18nProvider";
import { LANGUAGES, type Lang } from "@/lib/i18n/shared";

/** Settings → Language: the installed language bundles to choose from (each in its own name). */
export function LanguagePicker({ available }: { available: Lang[] }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        className="input w-auto"
        value={lang}
        disabled={pending}
        aria-label={t("Language")}
        onChange={(e) =>
          start(async () => {
            setError(null);
            const r = await setLanguageAction(e.target.value);
            if (r && !r.ok) setError(r.error ?? t("Couldn't change the language."));
            router.refresh();
          })
        }
      >
        {available.map((l) => (
          <option key={l} value={l}>
            {LANGUAGES[l].native}
          </option>
        ))}
      </select>
      {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
