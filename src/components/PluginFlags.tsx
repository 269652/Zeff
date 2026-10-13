"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The installed plugins, for client components that offer what a plugin brings (a toggle, a button). */
const Ctx = createContext<ReadonlySet<string>>(new Set());
/** What a todo doesn't show (Settings → Todos): "area:context", "kind:mail" … */
const OffCtx = createContext<readonly string[]>([]);

export function PluginFlagsProvider({ installed, off = [], children }: { installed: string[]; off?: string[]; children: ReactNode }) {
  return (
    <Ctx.Provider value={new Set(installed)}>
      <OffCtx.Provider value={off}>{children}</OffCtx.Provider>
    </Ctx.Provider>
  );
}

export const useTodoDisplayOff = () => useContext(OffCtx);

export const usePluginOn = (id: string) => useContext(Ctx).has(id);
