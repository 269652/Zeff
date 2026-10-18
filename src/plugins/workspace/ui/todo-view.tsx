"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmAction } from "@/components/confirm";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { convertTodoDatabaseAction, todoListSettingsAction } from "../actions";
import { dateRange, TITLE, todoColumns, type DbSchema, type Row } from "../model";
import { MenuItem } from "./kit";
import { TodoAddLine, TodoHeader, TodoList, type TodoItemData } from "./todo-ui";

/**
 * A database as a todo list - the same pieces as a list block and a list shown in another page (todo-ui.tsx): the head with the count and
 * the "…" menu (the Todo engine, turn into a list), a line to add one, the rows grouped by what is due.
 */

type Api = { set: (rowId: number, propId: string, value: unknown) => unknown; addRow: (cells?: Record<string, unknown>, title?: string) => unknown; reload: () => unknown };

export function TodoView({ dbId, rows, schema, api, openRow, locked, canAdd }: { dbId: number; rows: Row[]; schema: DbSchema; api: Api; openRow: (id: number) => void; locked: boolean; canAdd: boolean }) {
  const t = useT();
  const router = useRouter();
  const cols = todoColumns(schema);
  if (!cols)
    return <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">{t("A todo list needs a checkbox field that says done — add one in the properties.")}</p>;

  const items: TodoItemData[] = rows.map((r) => ({ id: r.id, text: r.title, done: r.cells[cols.done.id] === true, due: cols.due ? (dateRange(r.cells[cols.due.id])?.start.slice(0, 10) ?? null) : null }));

  const toggleEngine = async (on: boolean) => {
    const r = await todoListSettingsAction(dbId, { engine: on });
    if (!r.ok) return void toast(r.error, { tone: "error" });
    toast(on ? t("Its open rows are todos of the Todos tab now.") : t("It no longer feeds the Todos tab."), { tone: "ok" });
    await api.reload();
  };
  const toList = async () => {
    if (!confirmAction(t("Turn this database into a list in a page? Its rows become the items; the database goes to the trash."))) return;
    const r = await convertTodoDatabaseAction(dbId);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    toast(t("The database is a list now."), { tone: "ok" });
    router.push(`/workspace/${r.pageId}`);
  };

  return (
    <div className="space-y-2">
      <TodoHeader
        title={null}
        placeholder=""
        done={items.filter((i) => i.done).length}
        total={items.length}
        engine={cols.engine}
        disabled={locked}
        menu={(close) => (
          <>
            <MenuItem onClick={() => (close(), void toggleEngine(!cols.engine))}>
              {cols.engine ? "☑" : "☐"} {t("Open items are todos (Todo engine)")}
            </MenuItem>
            {cols.engine && (
              <Link href="/todos" className="block px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={close}>
                → {t("Open the Todos tab")}
              </Link>
            )}
            <MenuItem onClick={() => (close(), void toList())}>☑ {t("Turn into a list")}</MenuItem>
          </>
        )}
      />
      <TodoList
        grouped
        withDue={!!cols.due}
        disabled={locked}
        items={items}
        onCheck={(id, done) => void api.set(Number(id), cols.done.id, done)}
        onText={(id, text) => void api.set(Number(id), TITLE, text)}
        onDue={(id, due) => cols.due && void api.set(Number(id), cols.due.id, due)}
        onOpen={(id) => openRow(Number(id))}
      />
      {canAdd && <TodoAddLine disabled={locked} onAdd={(text) => void api.addRow({}, text)} />}
    </div>
  );
}
