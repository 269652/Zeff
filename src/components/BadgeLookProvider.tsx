"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LOOK, type BadgeLook, type LookId } from "@/lib/badges/look";
import { BADGE_DOTS } from "@/lib/badges/palette";

/** The small marks' look (lib/badges/look.ts — Settings → Badges), for every page: given once by the root layout. */
const Ctx = createContext<BadgeLook>(DEFAULT_LOOK);

export function BadgeLookProvider({ look, children }: { look: BadgeLook; children: React.ReactNode }) {
  return <Ctx.Provider value={look}>{children}</Ctx.Provider>;
}

export const useBadgeLook = (): BadgeLook => useContext(Ctx);

/** One of the header's dots in its colour — nothing when it is switched off. `className`: its size and place. */
export function LookDot({ id, className, ...rest }: { id: LookId; className: string } & Omit<React.HTMLAttributes<HTMLSpanElement>, "className">) {
  const look = useBadgeLook()[id];
  if (!look.on) return null;
  return <span className={`${className} ${BADGE_DOTS[look.color]}`} {...rest} />;
}
