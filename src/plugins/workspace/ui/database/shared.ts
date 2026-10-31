"use client";

import type { DbSchema, Labels, Property, Row, View } from "../../model";
import type { CellCtx } from "../cells";
import type { Api } from "./use-database";

/** The fields that hold where a row came from (keep:…, a source's key, when it was edited there). */
export const INTERNAL_REFS = new Set(["noteref", "srcref", "srcedited"]);

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const countRules = (f: View["filter"]): number => f.rules.reduce((n, r) => n + ("rules" in r ? countRules(r) : 1), 0);
/** The table's first column: a row's handle (to drag it), its checkbox and its menu (w-18). */
export const SELECT_COLUMN = 72;
/** The last column's room for its + (a new property). */
export const ADD_COLUMN = 44;

/** The rows ticked in a table: asked and told by the table's checkboxes. */
export type Selection = { has: (id: number) => boolean; any: boolean; toggle: (id: number, range: boolean, order: number[]) => void; all: (ids: number[]) => void };

export type ViewProps = { view: View; rows: Row[]; visible: Property[]; schema: DbSchema; ctx: CellCtx; api: Api; labels: Labels; openRow: (id: number) => void };
