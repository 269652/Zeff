"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The installed plugins, for client components that offer what a plugin brings (a toggle, a button). */
const Ctx = createContext<ReadonlySet<string>>(new Set());

export function PluginFlagsProvider({ installed, children }: { installed: string[]; children: ReactNode }) {
  return <Ctx.Provider value={new Set(installed)}>{children}</Ctx.Provider>;
}

export const usePluginOn = (id: string) => useContext(Ctx).has(id);
