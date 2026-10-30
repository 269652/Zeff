import { revalidatePath } from "next/cache";
import { t } from "@/lib/i18n/server";
import { pricesText, setPricesText, usageSummary, type UsageGroup } from "@/lib/ai/usage";

const money = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n));

function Table({ title, rows, label }: { title: string; rows: UsageGroup[]; label?: (k: string) => string }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.slice(0, 12).map((g) => (
            <tr key={g.key} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1 pr-2">{label ? label(g.key) : g.key}</td>
              <td className="px-2 text-right text-zinc-500 tabular-nums">{g.calls}×</td>
              <td className="px-2 text-right text-zinc-500 tabular-nums">{tokens(g.input)} → {tokens(g.output)}</td>
              <td className="py-1 pl-2 text-right tabular-nums">{g.unknownCost === g.calls ? "—" : money(g.cost)}{g.unknownCost && g.unknownCost < g.calls ? "+" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the AI used in the last 30 days - calls, tokens, cost - by day, task and model; and the prices to work a cost out where the CLI gives none. */
export function UsagePanel() {
  const u = usageSummary(30);
  const max = Math.max(1, ...u.byDay.map((d) => d.cost || d.calls / 100));
  async function savePrices(fd: FormData) {
    "use server";
    setPricesText(String(fd.get("prices") ?? ""));
    revalidatePath("/settings/ai");
  }
  return (
    <section className="card space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase">{t("Usage & cost")}</h2>
        <p className="max-w-[75ch] text-sm text-zinc-500">{t("Every AI answer of the last 30 days: how many, how many tokens (in → out) and what it cost. A “—” means the backend names no price (a subscription has none per token).")}</p>
      </div>
      {!u.total.calls ? (
        <p className="text-sm text-zinc-400">{t("Nothing yet — the numbers appear with the next AI answer.")}</p>
      ) : (
        <>
          <p className="text-2xl font-semibold tabular-nums">
            {u.total.unknownCost === u.total.calls ? "—" : money(u.total.cost)} <span className="text-sm font-normal text-zinc-500">· {u.total.calls}× · {tokens(u.total.input)} → {tokens(u.total.output)} {u.estimated ? `· ${t("partly estimated")}` : ""}</span>
          </p>
          <div className="flex h-16 items-end gap-0.5" aria-hidden>
            {u.byDay.map((d) => (
              <div key={d.key} title={`${d.key}: ${money(d.cost)} · ${d.calls}×`} className="min-w-1 flex-1 rounded-t bg-indigo-500/70" style={{ height: `${Math.max(4, ((d.cost || d.calls / 100) / max) * 100)}%` }} />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Table title={t("By task")} rows={u.byTask} />
            <Table title={t("By model")} rows={u.byModel} />
          </div>
        </>
      )}
      <form action={savePrices} className="space-y-1">
        <label className="label" htmlFor="ai-prices">{t("Prices for a cost where the backend names none (dollars per million tokens; a line “model in out”, e.g. “gpt-5.5 1.25 10”)")}</label>
        <textarea id="ai-prices" name="prices" rows={3} className="input font-mono text-xs" defaultValue={pricesText()} />
        <button className="btn btn-sm">{t("Save prices")}</button>
      </form>
    </section>
  );
}
