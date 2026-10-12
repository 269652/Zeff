import { listLogins } from "@/lib/logins";
import { t } from "@/lib/i18n/server";

/** "3 of 7 signed in" over the list of sign-ins — what is still to do, at a glance. */
export async function LoginSummary() {
  const { logins } = await listLogins();
  if (!logins.length) return null;
  const ok = logins.filter((l) => l.state === "ok").length;
  const todo = logins.filter((l) => l.state !== "ok");
  return (
    <p className={`rounded-lg px-3 py-2 text-sm ${todo.length ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" : "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"}`}>
      {todo.length
        ? t("{ok} of {n} signed in — still to do: {names}", { ok, n: logins.length, names: todo.map((l) => l.label).join(", ") })
        : t("All {n} signed in — you can go on.", { n: logins.length })}
    </p>
  );
}
