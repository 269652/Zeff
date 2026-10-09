"use client";

import { createContext, useContext } from "react";
import type { TicketSuggestionLite } from "./EntryForm";
import type { PersonOption } from "./PersonCombobox";

/** What context forms offer to pick from: colleagues ("Who") and Jira tickets. */
export type ContextFormOptions = { people: PersonOption[]; tickets: TicketSuggestionLite[] };

const Options = createContext<ContextFormOptions>({ people: [], tickets: [] });

/**
 * Hands the pickable people and tickets to every context form below it — once per page,
 * rather than with each card that might be edited.
 */
export function ContextFormOptionsProvider({ value, children }: { value: ContextFormOptions; children: React.ReactNode }) {
  return <Options.Provider value={value}>{children}</Options.Provider>;
}

export const useContextFormOptions = () => useContext(Options);
