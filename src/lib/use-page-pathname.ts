"use client";

import { usePathname } from "next/navigation";
import { PREFIX_ATTR, stripPrefix } from "@/lib/account-routes";

/**
 * The page's path without its account route: "/todos" on "/privat/todos" too — what the server renders with (it sees the
 * rewritten path), so a tab is current alike on both sides. next/navigation's usePathname gives the browser's ("/privat/todos").
 */
export function usePagePathname(): string {
  const path = usePathname() ?? "/";
  if (typeof document === "undefined") return path;
  return stripPrefix(document.documentElement.getAttribute(PREFIX_ATTR) ?? "", path);
}
