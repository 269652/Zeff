import Link from "next/link";
import { LoginButtons } from "@/components/LoginButtons";
import { listLogins, type LoginState } from "@/lib/logins";
import { formatAgo } from "@/lib/format";

const BADGE: Record<LoginState, [string, string]> = {
  ok: ["signed in", "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"],
  login: ["Sign-in needed", "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"],
  closed: ["not open", "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"],
  chrome: ["Chrome isn't running", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"],
  unknown: ["unknown", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"],
};
const SOURCE = { check: "checked", request: "sign-in prompt", sync: "last sync" } as const;

/** Every service the installed plugins sign in to, with its state and its buttons (Anmelden, Prüfen). */
export async function LoginsList() {
  const { logins } = await listLogins();
  return (
    <>
        {logins.length ? (
          <ul className="card divide-y divide-zinc-100 dark:divide-zinc-800">
            {logins.map((l) => {
              const [text, cls] = BADGE[l.state];
              return (
                <li key={l.service} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-80">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{l.label}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{text}</span>
                      <span className="text-xs text-zinc-400">{l.plugins.join(", ")}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-zinc-500">{l.detail}</p>
                    {l.at && l.source && (
                      <p className="text-xs text-zinc-400">
                        {SOURCE[l.source]} {formatAgo(l.at)}
                      </p>
                    )}
                  </div>
                  <LoginButtons service={l.service} label={l.label} checkable={l.checkable} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-zinc-500">
            None of the installed plugins needs a sign-in —{" "}
            <Link href="/plugins" className="text-indigo-600 hover:underline dark:text-indigo-400">
              Plugins
            </Link>
            .
          </p>
        )}
    </>
  );
}
