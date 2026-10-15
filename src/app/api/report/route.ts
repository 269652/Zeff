import { listBookedEntries } from "@/lib/entries";
import { resolveMonth } from "@/lib/month";
import { resolveWeek } from "@/lib/week";

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GET /api/report?week=2026-W39 or ?month=2026-09 [&by=name] — the period's entries as CSV. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const monthParam = url.searchParams.get("month");
  let period: { key: string; from: string; to: string };
  if (monthParam !== null) {
    const month = resolveMonth(monthParam);
    if (!month) return Response.json({ error: "Invalid month" }, { status: 400 });
    period = { key: month.key, from: month.startIso, to: month.endIso };
  } else {
    const week = resolveWeek(url.searchParams.get("week"));
    if (!week) return Response.json({ error: "Invalid week" }, { status: 400 });
    period = { key: week.key, from: week.startIso, to: week.endIso };
  }
  const by = url.searchParams.get("by")?.trim() || undefined;

  const entries = listBookedEntries({ from: period.from, to: period.to, reportedBy: by });
  const header = ["date", "job_number", "job_name", "customer", "hours", "description", "ticket", "reported_by", "source", "project"];
  const rows = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((e) =>
      [e.date, e.job.number, e.job.name, e.job.customer, e.hours, e.description, e.ticket, e.reportedBy, e.source, e.project?.title]
        .map(csvCell)
        .join(","),
    );
  const body = [header.join(","), ...rows].join("\r\n") + "\r\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="zeff-${period.key}${by ? "-" + by : ""}.csv"`,
    },
  });
}
