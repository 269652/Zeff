"use client";

import { FormError } from "@/components/FormError";
import { useActionState } from "react";
import { deleteTagAction, renameTagAction } from "@/app/actions";
import type { ActionState } from "@/app/action-helpers";
import { SubmitButton } from "./SubmitButton";
import { useT } from "@/components/I18nProvider";

export function TagRow({ id, name, count }: { id: number; name: string; count: number }) {
  const t = useT();
  const [state, action] = useActionState<ActionState, FormData>(renameTagAction, null);
  return (
    <tr>
      <td>
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <span className="text-zinc-400">#</span>
          <input name="name" defaultValue={name} className="input w-44" />
          <SubmitButton className="btn btn-sm" pendingText="…">{t("Save")}</SubmitButton>
          {state?.error && <FormError className="text-xs">{state.error}</FormError>}
        </form>
      </td>
      <td className="num">{count}</td>
      <td className="text-right">
        <form action={deleteTagAction}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton
            className="btn btn-sm btn-danger"
            pendingText="…"
            confirm={
              count === 1
                ? t("Delete tag #{name}? It will be removed from 1 entry.", { name })
                : t("Delete tag #{name}? It will be removed from {n} entries.", { name, n: count })
            }
          >
            {t("Delete")}
          </SubmitButton>
        </form>
      </td>
    </tr>
  );
}
