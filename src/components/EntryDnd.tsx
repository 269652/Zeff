"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { linkEntryAction } from "@/app/entry-group-actions";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";

const TYPE = "application/x-zeff-entry";

/** A table row of an entry that can be dragged onto its day's collecting entry (it is grouped under it). */
export function DragEntryRow({ entryId, date, className = "", children }: { entryId: number; date: string; className?: string; children: ReactNode }) {
  return (
    <tr
      className={`${className} cursor-grab active:cursor-grabbing`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TYPE, JSON.stringify({ entryId, date }));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      {children}
    </tr>
  );
}

/** The row of a collecting entry (and its bar): a drop zone for the entries of its day. */
export function GroupDropRow({ spanId, date, className = "", children }: { spanId: string; date: string; className?: string; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [, start] = useTransition();
  const ok = (e: React.DragEvent) => e.dataTransfer.types.includes(TYPE);
  return (
    <tr
      className={`${className} ${over ? "bg-indigo-100/70 outline-2 -outline-offset-2 outline-indigo-500 outline-dashed dark:bg-indigo-950/50" : ""}`}
      onDragOver={(e) => {
        if (!ok(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!ok(e)) return;
        e.preventDefault();
        let d: { entryId?: number; date?: string } = {};
        try {
          d = JSON.parse(e.dataTransfer.getData(TYPE)) as typeof d;
        } catch {
          return;
        }
        if (!d.entryId) return;
        if (d.date !== date) return void toast(t("A group collects the work of its own day ({date}).", { date }), { tone: "error" });
        start(async () => {
          const r = await linkEntryAction(d.entryId!, spanId);
          toast(r?.ok ? (r.message ?? t("Done.")) : (r?.error ?? t("Didn't work.")), { tone: r?.ok ? "ok" : "error" });
          router.refresh();
        });
      }}
    >
      {children}
    </tr>
  );
}
