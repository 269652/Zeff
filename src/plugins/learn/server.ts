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

/**
 * A finished exercise told to its lesson's teacher — by the server, with its result kept (not left to the page after it:
 * a slow moment lost it, and the teacher never knew the exercise was done). Into the lesson's running session, or the
 * conversation goes on in a new run. Whether it went; why not, logged.
 */
export async function tellTeacher(widgetId: number, r: Extract<import("@/lib/widgets/sandbox").WidgetMessage, { type: "result" }>): Promise<boolean> {
  try {
    const store = await import("./store");
    const w = store.getWidget(widgetId);
    if (!w?.nodeKey) return false;
    const node = store.getNode(w.courseId, w.nodeKey);
    if (!node?.lessonTodoId) return false;
    const { runsForTodos } = await import("@/lib/work/store");
    const last = runsForTodos([node.lessonTodoId]).get(node.lessonTodoId)?.[0];
    if (!last) return false;
    const { resultMessage } = await import("./result-message");
    const { chatSendAction } = await import("@/app/chat/actions");
    const sent = await chatSendAction({ text: resultMessage(w.title, r), runId: last.id });
    if (!sent.ok) console.error(`[learn] the result of widget ${widgetId} didn't reach the teacher: ${sent.error}`);
    return sent.ok;
  } catch (e) {
    console.error(`[learn] the result of widget ${widgetId} didn't reach the teacher`, e);
    return false;
  }
}
