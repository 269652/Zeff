"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";

/**
 * Reads calendar events the bookmarklet placed in the URL fragment
 * (#zeffimport=…) and ingests them same-origin, then refreshes so the preview
 * shows them. The fragment is used (not a query string) so the event data never
 * hits the server log or history.
 */
export function HashIngest() {
  const t = useT();
  const router = useRouter();
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState(false);

  useEffect(() => {
    const m = window.location.hash.match(/[#&]zeffimport=([^&]+)/);
    if (!m) return;

    // Clear the fragment immediately so a refresh doesn't re-import.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    const encoded = m[1];

    (async () => {
      // Defer past a microtask so state updates aren't synchronous within the effect.
      await Promise.resolve();
      let payload: unknown;
      try {
        payload = JSON.parse(decodeURIComponent(encoded));
      } catch {
        setError(true);
        setMsg(t("Could not read the meetings from Outlook — try the copy & paste option."));
        return;
      }
      setMsg(t("Loading meetings from Outlook…"));
      try {
        const res = await fetch("/api/calendar/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        setMsg(
          t("Loaded {n} meetings from Outlook ({total} in the inbox). Review and book below.", {
            n: j.accepted ?? 0,
            total: j.total ?? 0,
          }),
        );
        router.refresh();
      } catch (e) {
        setError(true);
        setMsg(t("Could not load the meetings: {error}", { error: String(e) }));
      }
    })();
  }, [router, t]);

  if (!msg) return null;
  return <p role={error ? "alert" : "status"} className={error ? "alert-error" : "alert-ok"}>{msg}</p>;
}
