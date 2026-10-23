"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The installed plugins, for client components that offer what a plugin brings (a toggle, a button). */
const Ctx = createContext<ReadonlySet<string>>(new Set());
/** What a todo doesn't show (Settings → Todos): "area:context", "kind:mail" … */
const OffCtx = createContext<readonly string[]>([]);
/** What Zeff may write through an API now ("gmail-send", "gcal-write" — Google holds the right): the buttons that do it show then. */
const GrantsCtx = createContext<readonly string[]>([]);

export function PluginFlagsProvider({ installed, off = [], grants = [], children }: { installed: string[]; off?: string[]; grants?: string[]; children: ReactNode }) {
  return (
    <Ctx.Provider value={new Set(installed)}>
      <OffCtx.Provider value={off}>
        <GrantsCtx.Provider value={grants}>{children}</GrantsCtx.Provider>
      </OffCtx.Provider>
    </Ctx.Provider>
  );
}

/** Whether Zeff may write this through an API now (see src/lib/google/grants.ts). */
export const useGrant = (id: string) => useContext(GrantsCtx).includes(id);

export const useTodoDisplayOff = () => useContext(OffCtx);

export const usePluginOn = (id: string) => useContext(Ctx).has(id);
