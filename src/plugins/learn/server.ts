/**
 * The Learn plugin on the server: the teacher's kind of chat registered (teacher.ts), and — while it's installed —
 * the reviews due and the study calendar kept up to date every hour (besides when you learn). Loaded with the other
 * plugins' server modules (contributions.ts).
 */
import "./teacher";
import { createElement } from "react";
import { t } from "@/lib/i18n/server";
import { isInstalled } from "@/plugins/state";
import { createLearnSpace, learnSpaceAt, spaceOfPage } from "./dbs";
import { workspacePageApps, workspaceTemplates } from "@/plugins/workspace/page-apps-point";

// A learning space (a page holding Learn's databases — told from them): Learn's courses on its page in the Workspace.
// A course's row, a topic's (a year, a phase, a skill) or a step's: Learn's own screen right there — the course with its skill
// map, the topic with its steps, the lesson with the teacher — and its links stay in the Workspace.
workspacePageApps.contribute("learn", {
  async app(pageId) {
    if (learnSpaceAt(pageId)) {
      const { LearnSpaceApp } = await import("./ui/LearnSpaceApp");
      return createElement(LearnSpaceApp, { pageId });
    }
    const space = spaceOfPage(pageId);
    if (!space || space.folder === pageId) return null;
    const { getPage } = await import("@/plugins/workspace/store");
    const dbId = getPage(pageId)?.dbId;
    if (dbId === space.courses) {
      const { CourseScreen } = await import("./ui/CourseScreen");
      return createElement(CourseScreen, { courseId: pageId, where: "workspace" });
    }
    if (dbId === space.steps) {
      const store = await import("./store");
      const at = store.nodeOfRow(pageId);
      const node = at ? store.getNode(at.courseId, at.key) : undefined;
      if (!at || !node) return null;
      if (node.kind === "step") {
        const { LessonScreen } = await import("./ui/LessonScreen");
        return createElement(LessonScreen, { courseId: at.courseId, stepKey: at.key, where: "workspace" });
      }
      const { TopicScreen } = await import("./ui/TopicScreen");
      return createElement(TopicScreen, { courseId: at.courseId, nodeKey: at.key });
    }
    return null;
  },
});

// "New → templates": a learning space of its own — its own courses, progress, cards.
workspaceTemplates.contribute("learn", [
  {
    key: "learning-space",
    get name() {
      return t("Learning space");
    },
    icon: "🎓",
    get description() {
      return t("Learn on a page of its own: its own courses, progress, streak and cards — Claude researches each topic and teaches it step by step.");
    },
    kind: "page",
    build: (parentId) => createLearnSpace(parentId),
  },
]);

const g = globalThis as { __zeffLearnTimer?: ReturnType<typeof setInterval> };
if (!g.__zeffLearnTimer && process.env.NODE_ENV !== "test" && !process.env.DATABASE_PATH?.includes("zeff-test-")) {
  g.__zeffLearnTimer = setInterval(() => {
    void (async () => {
      try {
        const { listAccounts, withAccount } = await import("@/db/accounts");
        for (const a of listAccounts()) {
          await withAccount(a.id, async () => {
            if (!isInstalled("learn")) return;
            // (Steps ticked mastered in the database — the phone, the AI, a routine: their xp given now, not only when Learn is opened.)
            const store = await import("./store");
            for (const c of store.listCourses()) store.courseTree(c.id);
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
