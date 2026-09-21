"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Reads calendar events the bookmarklet placed in the URL fragment
 * (#zeffimport=…) and ingests them same-origin, then refreshes so the preview
 * shows them. The fragment is used (not a query string) so the event data never
 * hits the server log or history.
 */
export function HashIngest() {
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
        setMsg("Could not read the meetings from Outlook — try the copy & paste option.");
        return;
      }
      setMsg("Loading meetings from Outlook…");
      try {
        const res = await fetch("/api/calendar/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        setMsg(`Loaded ${j.accepted ?? 0} meetings from Outlook (${j.total ?? 0} in the inbox). Review and book below.`);
        router.refresh();
      } catch (e) {
        setError(true);
        setMsg(`Could not load the meetings: ${e}`);
      }
    })();
  }, [router]);

  if (!msg) return null;
  return <p className={error ? "alert-error" : "alert-ok"}>{msg}</p>;
}
