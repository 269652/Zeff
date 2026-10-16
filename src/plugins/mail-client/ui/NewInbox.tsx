"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "@/components/Toaster";
import { useT } from "@/components/I18nProvider";
import { createDerivedDatabaseAction } from "@/plugins/workspace/actions";
import { Dropdown, MenuItem } from "@/plugins/workspace/ui/kit";
import { createInboxAction, inboxTemplatesAction } from "../server-actions";

/** "+ Inbox": one of the plugin's templates (Inbox, Unread, From people, Important …) under this database — or one of your own. */
export function NewInbox({ dbId, dataType }: { dbId: number; dataType: string }) {
  const t = useT();
  const router = useRouter();
  const [list, setList] = useState<{ id: string; title: string; icon: string; description: string }[]>([]);
  useEffect(() => {
    void inboxTemplatesAction(dataType).then(setList);
  }, [dataType]);
  const go = (id: number) => (router.push(`/workspace/${id}`), router.refresh());
  return (
    <Dropdown label={`＋ ${t("New inbox")}`} className="rounded px-2 py-0.5 text-xs text-indigo-600 hover:bg-zinc-100 dark:text-indigo-400 dark:hover:bg-zinc-800" align="right">
      {(close) => (
        <>
          {list.map((x) => (
            <MenuItem
              key={x.id}
              onClick={async () => {
                close();
                const r = await createInboxAction(dbId, x.id);
                if (!r.ok) return void toast(r.error, { tone: "error" });
                go(r.id);
              }}
            >
              <span className="block">
                {x.icon} {x.title}
              </span>
              <span className="block text-xs text-zinc-500">{x.description}</span>
            </MenuItem>
          ))}
          <MenuItem
            onClick={async () => {
              close();
              const r = await createDerivedDatabaseAction(dbId);
              if (!r.ok) return void toast(r.error, { tone: "error" });
              router.push(`/workspace/${r.id}?steps=1`);
            }}
          >
            ⚙ {t("Your own (rules, AI) …")}
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}
