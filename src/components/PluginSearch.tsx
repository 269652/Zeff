"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";

/**
 * The Plugins page's search: the cards whose text (name, description, id, what they need, their parts — data-plugin-text) has every
 * word typed stay, the rest and the groups left empty step aside. Escape clears it.
 */
export function PluginSearch() {
  const t = useT();
  const [q, setQ] = useState("");
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let n = 0;
    for (const card of document.querySelectorAll<HTMLElement>("[data-plugin-text]")) {
      const hit = words.every((w) => (card.dataset.pluginText ?? "").includes(w));
      card.hidden = !hit;
      if (hit) n++;
    }
    for (const group of document.querySelectorAll<HTMLElement>("[data-plugin-group]")) group.hidden = !group.querySelector("[data-plugin-text]:not([hidden])");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- how many the page shows is known only after it is filtered
    setShown(words.length ? n : null);
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="search"
        className="input max-w-md"
        placeholder={t("Search plugins …")}
        aria-label={t("Search plugins")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setQ("")}
      />
      {shown !== null && (
        <span className="text-sm text-zinc-500" aria-live="polite">
          {shown ? t("{n} found", { n: shown }) : t("No plugin matches.")}
        </span>
      )}
    </div>
  );
}
