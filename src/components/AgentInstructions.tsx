"use client";

import { createContext, useContext, type ReactNode } from "react";
import { AGENT_INSTRUCTION_DEFAULTS } from "@/lib/todos/shared";

type Templates = { code: string; other: string };

const Ctx = createContext<Templates>(AGENT_INSTRUCTION_DEFAULTS);

/** The instructions a todo's label copies for an agent (Work → Settings), for every page below. */
export function AgentInstructionsProvider({ templates, children }: { templates: Templates; children: ReactNode }) {
  return <Ctx.Provider value={templates}>{children}</Ctx.Provider>;
}

/** The templates set in Work → Settings ($todo.id …). */
export const useAgentInstructions = () => useContext(Ctx);
