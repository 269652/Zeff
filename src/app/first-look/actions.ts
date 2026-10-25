"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n/server";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const run = async <T extends object>(fn: () => Promise<T> | T): Promise<Result<T>> => {
  try {
    const v = await fn();
    revalidatePath("/first-look");
    return { ok: true, ...v };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
};

/** The first look: a todo for a promise (yours, or one to remind them of) — once. */
export async function promiseTodoAction(claimId: number) {
  return run(async () => {
    const { claimById } = await import("@/plugins/people/graph");
    const c = claimById(Number(claimId));
    if (!c) throw new Error(t("This promise is gone."));
    const id = (await import("@/plugins/people/promise-todos")).todoForPromise(c);
    if (!id) throw new Error(t("No todo made."));
    return { todoId: id };
  });
}

/** The first look: a promise kept already (you say so). */
export async function promiseDoneAction(claimId: number) {
  return run(async () => {
    (await import("@/plugins/people/graph")).reviewClaim(Number(claimId), "done");
    return {};
  });
}

/** The first look: a todo for a case's next step — linked to the case (its payment settles it). */
export async function caseTodoAction(caseId: number) {
  return run(async () => {
    const { getCase, addSource } = await import("@/plugins/cases/store");
    const { caseTitle } = await import("@/plugins/cases/shared");
    const c = getCase(Number(caseId));
    if (!c) throw new Error(t("This case is gone."));
    const { addManualTodo, setTodoDue } = await import("@/lib/boards/store");
    const next = c.compiled?.nextWhat?.trim();
    const todo = addManualTodo({ ticket: "", text: `${next || t("Next step")} (Az. ${c.label}, ${caseTitle(c)})` });
    addSource(c.id, { ref: `todo:${todo.id}`, kind: "todo", at: new Date().toISOString(), title: todo.text });
    if (c.compiled?.nextDue) setTodoDue(todo.id, c.compiled.nextDue);
    return { todoId: todo.id };
  });
}

/** The first look seen: Today stops pointing at it. */
export async function firstLookSeenAction() {
  return run(async () => {
    (await import("@/lib/prefs")).setPref("firstLook.seenAt", new Date().toISOString());
    return {};
  });
}
