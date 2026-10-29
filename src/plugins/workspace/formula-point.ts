import { extensionPoint } from "@/lib/plugin-kit/extension-point";
import type { FormulaValue } from "./formula";

/**
 * Formula functions plugins give the Workspace: =Schulden(@Chris), =SUMME(Schulden(@Freunde)), =Personen(@Familie) — a
 * function a plugin knows how to work out, usable in every formula (a table's cell, a page's table, a column's formula, a
 * Kennzahl's). It gets its arguments worked out: numbers, texts, dates, lists (a range, another function's list) and what @
 * names (formula.ts EntityRef: a person, a page, a todo, a ticket — or a name nothing else had, @Freunde, for the plugin to
 * resolve: a person by name, a circle). A list it returns is one value per thing (a circle's people), so SUMME, MITTELWERT
 * and ANZAHL work on it. Its unit goes into the result's (units.ts). Server only — a page's table asks the server for them.
 */
export type FormulaFunction = {
  /** How it is called ("Schulden") — case doesn't matter. */
  name: string;
  /** Other names (English: "Debts"). */
  aliases?: string[];
  /** What its numbers are in ("€", "€/Monat") — "" none. */
  unit?: string;
  /** How it is written, for the help: "Schulden(@Person oder @Kreis)". */
  signature: string;
  /** One line: what it gives. */
  what: string;
  /** Its value for these arguments (this account's). Throws with a message the cell shows. */
  call: (args: FormulaValue[]) => FormulaValue;
};

export const workspaceFormulaFunctions = extensionPoint<FormulaFunction[]>("workspace.formulaFunctions");
