"use client";

import { useTransition } from "react";
import { leaveDemoAction, startDemoAction } from "@/app/demo-actions";
import { toast } from "./Toaster";

/** Into the demo, or out of it: the other account's address, loaded as a page (its own data, its own header). */
export function DemoButton({ to, label, className }: { to: "demo" | "own"; label: string; className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await (to === "demo" ? startDemoAction() : leaveDemoAction());
          if (r.ok) window.location.assign(r.href);
          else toast(r.error, { tone: "error" });
        })
      }
    >
      {pending ? "…" : label}
    </button>
  );
}
