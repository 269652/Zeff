"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { pressButtonAction, addRowAction, archivePageAction, restorePageAction, duplicateRowAction, loadDatabaseAction, placeRowAction, setCellAction, updateSchemaAction, type DatabaseData } from "../../actions";
import { isComputed, newId, TITLE, withCell, type DbSchema } from "../../model";

/** The views' state and the changes to the database: shared by the page and the blocks. */
export function useDatabase(initial: DatabaseData | null, dbId: number) {
  const t = useT();
  const [data, setData] = useState<DatabaseData | null>(initial);
  const [error, setError] = useState("");
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  });
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schemaSaving = useRef<Promise<unknown>>(Promise.resolve());
  const schemaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const r = await loadDatabaseAction(dbId);
    if (r.ok) {
      setData(r.data);
      setError("");
    } else setError(r.error);
  }, [dbId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the rows are fetched when the block appears
    if (!initial) void reload();
  }, [initial, reload]);

  // The assistant (the chat in the sidebar) changed the workspace: the rows and the schema are read again.
  useEffect(() => {
    const again = () => void reload();
    window.addEventListener("ws-changed", again);
    return () => window.removeEventListener("ws-changed", again);
  }, [reload]);

  // Changes from elsewhere (another tab, an agent through the MCP, the Lage, a todo ticked on the Todos tab): the data is
  // read again — this database only, not the page (an editor being typed in stays as it is). A burst is one read, at most
  // every 1.5 s; in a hidden tab it waits until the tab is shown.
  useEffect(() => {
    const topics = new Set(["workspace", "todos", "attention", "kanban", "work", "sync"]) /* a run that ends: a jobs database settles it as it reloads */;
    const source = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stale = false;
    const read = () => {
      timer = null;
      if (document.visibilityState === "hidden") return void (stale = true);
      stale = false;
      void reload();
    };
    const onChange = (e: Event) => {
      if (topics.has((e as MessageEvent<string>).data) && !timer) timer = setTimeout(read, 1500);
    };
    const shown = () => document.visibilityState === "visible" && stale && read();
    source.addEventListener("change", onChange);
    document.addEventListener("visibilitychange", shown);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
      source.close();
    };
  }, [reload]);

  const reloadSoon = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void reload(), 600);
  }, [reload]);

  /** Persist the schema now (waits for one in flight). Returns the error, or null. */
  const saveSchema = useCallback(
    async (schema: DbSchema): Promise<string | null> => {
      const run = schemaSaving.current.then(() => updateSchemaAction(dbId, schema));
      schemaSaving.current = run;
      const r = await run;
      if (!r.ok) return r.error;
      await reload();
      return null;
    },
    [dbId, reload],
  );

  /** A view's change: shown at once, saved a moment later. */
  const changeSchema = useCallback(
    (fn: (s: DbSchema) => DbSchema) => {
      const cur = dataRef.current;
      if (!cur) return;
      const next = fn(cur.schema);
      setData({ ...cur, schema: next });
      dataRef.current = { ...cur, schema: next };
      if (schemaTimer.current) clearTimeout(schemaTimer.current);
      schemaTimer.current = setTimeout(() => {
        schemaSaving.current = schemaSaving.current.then(() => updateSchemaAction(dbId, dataRef.current!.schema));
      }, 350);
    },
    [dbId],
  );

  /** The cells written but not yet confirmed ("<row>:<property>"): shown faded until the server answers. */
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  /** Each cell's latest edit: only that one's answer settles it (an earlier one still in flight doesn't). */
  const edits = useRef(new Map<string, number>());

  const set = useCallback(
    (rowId: number, propId: string, value: unknown) => {
      const cur = dataRef.current;
      if (!cur) return;
      const key = `${rowId}:${propId}`;
      const old = cur.rows.find((r) => r.id === rowId);
      const before = propId === TITLE ? old?.title : old?.cells[propId];
      const n = (edits.current.get(key) ?? 0) + 1;
      edits.current.set(key, n);
      // Shown at once, as it will be stored (typed "12,5" is the number 12.5) …
      const next = { ...cur, rows: withCell(cur.rows, cur.schema.properties, rowId, propId, value) };
      dataRef.current = next;
      setData(next);
      setPending((s) => new Set(s).add(key));
      // … saved after any schema change in flight (a new option must be there first); confirmed, or put back as it was.
      const settle = (r: { ok: boolean; error?: string }) => {
        if (edits.current.get(key) !== n) return r;
        edits.current.delete(key);
        setPending((s) => {
          const left = new Set(s);
          left.delete(key);
          return left;
        });
        if (!r.ok) {
          toast(r.error || t("Could not save."), { tone: "error" });
          const now = dataRef.current;
          if (now) setData({ ...now, rows: withCell(now.rows, now.schema.properties, rowId, propId, before ?? null) });
        } else if (cur.schema.properties.some(isComputed) || typeof value === "string" && value.trim().startsWith("=") || cur.rows.some((r) => Object.keys(r.cells).some((k) => k.endsWith("=")))) reloadSoon();
        return r;
      };
      schemaSaving.current = schemaSaving.current
        .then(() => setCellAction(rowId, propId, value))
        .then(
          (r) => settle(r as { ok: boolean; error?: string }),
          (e: unknown) => settle({ ok: false, error: e instanceof Error ? e.message : String(e) }),
        );
    },
    [reloadSoon, t],
  );
  const isPending = useCallback((rowId: number, propId: string) => pending.has(`${rowId}:${propId}`), [pending]);

  /** A button field pressed: its routine runs on the row, then the rows are read again (what it changed). */
  const press = useCallback(
    async (rowId: number, propId: string) => {
      const r = await pressButtonAction(rowId, propId);
      if (!r.ok) return void toast(r.error, { tone: "error" });
      if (r.status === "failed") toast(r.error || t("Failed."), { tone: "error" });
      else if (r.status === "started") toast(t("The agent is running — it shows in the Code tab."));
      await reload();
    },
    [reload, t],
  );

  const addOption = useCallback(
    (propId: string, name: string): string => {
      const id = newId("o");
      changeSchema((s) => ({
        ...s,
        properties: s.properties.map((p) => (p.id === propId ? { ...p, options: [...(p.options ?? []), { id, name, color: ["gray", "blue", "green", "orange", "purple", "pink", "red", "yellow", "brown"][(p.options?.length ?? 0) % 9], group: p.type === "status" ? ("todo" as const) : undefined }] } : p)),
      }));
      return id;
    },
    [changeSchema],
  );

  const addRow = useCallback(
    async (cells: Record<string, unknown> = {}, title = "", templateId?: number, params?: Record<string, string>): Promise<number | null> => {
      await schemaSaving.current;
      const r = await addRowAction(dbId, { title, cells, templateId, params });
      if (!r.ok) {
        toast(r.error, { tone: "error" });
        return null;
      }
      await reload();
      return r.id;
    },
    [dbId, reload],
  );

  const removeRow = useCallback(
    async (rowId: number) => {
      const r = await archivePageAction(rowId);
      if (!r.ok) toast(r.error, { tone: "error" });
      else
        toast(t("Moved to the trash."), {
          action: {
            label: t("Undo"),
            run: async () => {
              const back = await restorePageAction(rowId);
              if (!back.ok) toast(back.error, { tone: "error" });
              await reload();
            },
          },
        });
      await reload();
    },
    [reload, t],
  );

  const duplicateRow = useCallback(
    async (rowId: number) => {
      const r = await duplicateRowAction(rowId);
      if (!r.ok) toast(r.error, { tone: "error" });
      await reload();
    },
    [reload],
  );

  /** A row placed between two others (the board's manual order): shown at once, then saved. */
  const place = useCallback(
    (rowId: number, after: number | null, before: number | null) => {
      const cur = dataRef.current;
      if (!cur) return;
      const row = cur.rows.find((r) => r.id === rowId);
      if (!row) return;
      const rest = cur.rows.filter((r) => r.id !== rowId);
      const at = before !== null ? rest.findIndex((r) => r.id === before) : after !== null ? rest.findIndex((r) => r.id === after) + 1 : 0;
      rest.splice(at < 0 ? rest.length : at, 0, row);
      setData({ ...cur, rows: rest });
      schemaSaving.current = schemaSaving.current.then(() => placeRowAction(rowId, after, before)).then((r) => {
        if (!r.ok) {
          toast((r as { error: string }).error, { tone: "error" });
          void reload();
        }
        return r;
      });
    },
    [reload],
  );

  void t;
  return { data, error, reload, saveSchema, changeSchema, set, isPending, press, addOption, addRow, removeRow, duplicateRow, place };
}

// ---------------------------------------------------------------------------
// The view area
// ---------------------------------------------------------------------------

export type Api = ReturnType<typeof useDatabase>;
