"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Weekly report" },
  { href: "/jobs", label: "Jobs" },
  { href: "/settings", label: "Schedule" },
  { href: "/tags", label: "Tags" },
  { href: "/mcp", label: "MCP" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition " +
              (active
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
