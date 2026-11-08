/**
 * The Learn plugin on the server: the teacher's kind of chat registered (teacher.ts), and — while it's installed —
 * the reviews due and the study calendar kept up to date every hour (besides when you learn). Loaded with the other
 * plugins' server modules (contributions.ts).
 */
import "./teacher";
import { isInstalled } from "@/plugins/state";

const g = globalThis as { __zeffLearnTimer?: ReturnType<typeof setInterval> };
if (!g.__zeffLearnTimer && process.env.NODE_ENV !== "test" && !process.env.DATABASE_PATH?.includes("zeff-test-")) {
  g.__zeffLearnTimer = setInterval(() => {
    void (async () => {
      try {
        const { listAccounts, withAccount } = await import("@/db/accounts");
        for (const a of listAccounts()) {
          await withAccount(a.id, async () => {
            if (!isInstalled("learn")) return;
            const { syncReviewTodos, syncStudyCalendar } = await import("./schedule");
            syncReviewTodos();
            await syncStudyCalendar();
          });
        }
      } catch (e) {
        console.error("[learn] keeping reviews and the study calendar up to date failed", e);
      }
    })();
  }, 60 * 60_000);
  g.__zeffLearnTimer.unref?.();
}
