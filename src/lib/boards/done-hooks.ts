/**
 * Things that follow a todo being closed as done, brought by plugins (an agent's report becomes final when you tick its todo off).
 * The core knows none of them. Server only.
 */
type Hook = (todoId: number) => void;
const hooks: Hook[] = [];

export const onTodoDone = (h: Hook): void => void (hooks.includes(h) || hooks.push(h));

export function runTodoDoneHooks(todoId: number): void {
  for (const h of hooks) {
    try {
      h(todoId);
    } catch (e) {
      console.warn("[todo done hook]", e instanceof Error ? e.message : e);
    }
  }
}

/** Things that follow a done todo opened again (what its being done brought is taken back — todo-settle.ts). */
const reopenHooks: Hook[] = [];

export const onTodoReopened = (h: Hook): void => void (reopenHooks.includes(h) || reopenHooks.push(h));

export function runTodoReopenedHooks(todoId: number): void {
  for (const h of reopenHooks) {
    try {
      h(todoId);
    } catch (e) {
      console.warn("[todo reopened hook]", e instanceof Error ? e.message : e);
    }
  }
}
