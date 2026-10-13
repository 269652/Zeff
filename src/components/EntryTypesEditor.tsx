"use client";

import { FormError } from "@/components/FormError";
import { useState, useTransition } from "react";
import { createEntryTypeAction, deleteEntryTypeAction, saveEntryTypesAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { typeColorStyle, type EntryTypeDef } from "@/lib/entry-types-shared";
import { useT } from "./I18nProvider";

/**
 * Rename and recolor entry types, add new ones, delete unused ones. Built-in types (the
 * ones imports and exports rely on) can't be deleted. Remount it (key) when types change.
 */
export function EntryTypesEditor({ types, usage }: { types: EntryTypeDef[]; usage: Record<string, number> }) {
  const t = useT();
  const [rows, setRows] = useState(types);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#14b8a6");
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  const changed = rows.filter((r) => {
    const orig = types.find((x) => x.key === r.key);
    return orig && (orig.label !== r.label || orig.color !== r.color);
  });
  const setRow = (key: string, patch: Partial<EntryTypeDef>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setState(null);
  };
  const run = (fn: () => Promise<ActionState>) => startTransition(async () => setState(await fn()));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t("Color")}</th>
              <th>{t("Name")}</th>
              <th>{t("Key")}</th>
              <th className="num">{t("Entries")}</th>
              <th>{t("Looks like")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const used = usage[r.key] ?? 0;
              return (
                <tr key={r.key}>
                  <td>
                    <input
                      type="color"
                      aria-label={t("Color of {type}", { type: r.label })}
                      className="h-8 w-10 cursor-pointer rounded border border-zinc-200 bg-transparent dark:border-zinc-700"
                      value={r.color}
                      onChange={(e) => setRow(r.key, { color: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="input py-1"
                      aria-label={t("Name of {type}", { type: r.key })}
                      value={r.label}
                      onChange={(e) => setRow(r.key, { label: e.target.value })}
                    />
                  </td>
                  <td className="font-mono text-xs whitespace-nowrap text-zinc-500">
                    {r.key}
                    {r.builtin && <span className="badge badge-web ml-2 font-sans" title={t("Used by imports and exports — rename and recolor only")}>{t("built-in")}</span>}
                  </td>
                  <td className="num">{used}</td>
                  <td>
                    <span className="badge badge-type" style={typeColorStyle(r.color)}>{r.label || r.key}</span>
                  </td>
                  <td className="text-right">
                    {!r.builtin && (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={pending || used > 0}
                        title={used > 0 ? t("{n} entries use it — change them first", { n: used }) : t("Delete this type")}
                        onClick={() => {
                          if (window.confirm(t("Delete the type {type}?", { type: r.label }))) run(() => deleteEntryTypeAction(r.key));
                        }}
                      >
                        {t("Delete")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || changed.length === 0}
          onClick={() => run(() => saveEntryTypesAction(changed.map(({ key, label, color }) => ({ key, label, color }))))}
        >
          {pending ? t("Saving…") : changed.length ? (changed.length === 1 ? t("Save 1 change") : t("Save {n} changes", { n: changed.length })) : t("Saved")}
        </button>
        {state?.error && <FormError>{state.error}</FormError>}
        {state?.ok && state.message && <span className="text-sm text-emerald-600 dark:text-emerald-400">{state.message}</span>}
      </div>

      <form
        className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createEntryTypeAction(newLabel, newColor));
        }}
      >
        <div>
          <label className="label" htmlFor="new-type-color">{t("Color")}</label>
          <input
            id="new-type-color"
            type="color"
            className="h-9 w-12 cursor-pointer rounded border border-zinc-200 bg-transparent dark:border-zinc-700"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="new-type-label">{t("New type")}</label>
          <input
            id="new-type-label"
            className="input"
            placeholder={t("e.g. Pairing")}
            value={newLabel}
            onChange={(e) => {
              setNewLabel(e.target.value);
              setState(null);
            }}
            required
          />
        </div>
        <button type="submit" className="btn" disabled={pending || !newLabel.trim()}>
          {t("Add type")}
        </button>
      </form>
    </div>
  );
}
