"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { LabelPicker } from "@/app/privacy/boundaries/LabelPicker";
import { setCollectionAction } from "../actions";

/**
 * What goes out of the Workspace's databases: into the Ticket-Lage (its notes and boards as context — what was "in the
 * briefing"); into the knowledge — picked on the knowledge server now (Plugins → Zeff → what to read), from every source
 * and database Zeff has.
 */
export function OutputsView({ databases, knowledgeOn }: { databases: { id: number; name: string; briefing: boolean; source: string | null; sensitivity?: "open" | "personal" | "secret"; own?: boolean }[]; knowledgeOn: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (id: number, briefing: boolean) =>
    start(async () => {
      const r = await setCollectionAction(id, { briefing });
      if (!r.ok) toast(r.error, { tone: "error" });
      router.refresh();
    });
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-medium">{t("Into the Ticket-Lage")}</h2>
        <p className="text-sm text-zinc-500">{t("The databases whose rows the Ticket-Lage reads as context (notes, boards) — its AI writes the briefing and the todos from them.")}</p>
        <p className="text-sm text-zinc-500">
          {t("Each database's sensitivity is switched in its line; where everything flows:")}{" "}
          <Link href="/privacy/boundaries" className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t("Data flows")} →
          </Link>
        </p>
        <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
          {databases.map((d) => (
            <li key={d.id} id={`db-${d.id}`} className="flex items-center gap-3 px-3 py-2 text-sm">
              {/* A secret database goes nowhere (Data boundaries): its switch can't put it in. */}
              <input type="checkbox" checked={d.briefing} disabled={pending || d.sensitivity === "secret"} aria-label={d.name} onChange={(e) => set(d.id, e.target.checked)} />
              <Link href={`/workspace/${d.id}`} className="min-w-0 flex-1 truncate hover:underline">
                {d.name}
              </Link>
              {d.source && <span className="text-xs text-zinc-400">{d.source}</span>}
              {/* Its sensitivity, switched here (open, personal, secret — or its default). */}
              <LabelPicker kind="database" rowKey={String(d.id)} label={d.sensitivity ?? "open"} own={!!d.own} name={d.name} />
            </li>
          ))}
        </ul>
      </section>
      {knowledgeOn && (
        <section className="space-y-1">
          <h2 className="font-medium">{t("Into the knowledge")}</h2>
          <p className="text-sm text-zinc-500">{t("The knowledge server picks what it reads — every source and every database of the Workspace: on the knowledge server, Plugins → Zeff → Choose what to read.")}</p>
        </section>
      )}
    </div>
  );
}
