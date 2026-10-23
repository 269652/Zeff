/**
 * What Zeff wrote to Google, on the timeline (when it's installed): a mail sent or drafted, an event made, changed or answered —
 * with the entities it concerns. Never fails the write it notes. Server only.
 */
import { isInstalled } from "@/plugins/state";

export function journalGoogleWrite(v: { kind: string; source: "gmail" | "gcalendar"; sourceRef: string; title: string; summary?: string; url?: string; refs?: string[] }): void {
  try {
    if (!isInstalled("timeline")) return;
    void import("@/plugins/timeline/store")
      .then(({ recordEvent }) => recordEvent({ at: new Date().toISOString(), ...v }))
      .catch(() => {});
  } catch {
    // (no timeline: nothing to note)
  }
}
