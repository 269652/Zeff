import { getWeeklyReport } from "@/lib/entries";
import { resolveWeek } from "@/lib/week";

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GET /api/report?week=2026-W39[&by=name] — the week's entries as CSV. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const week = resolveWeek(url.searchParams.get("week"));
  if (!week) return Response.json({ error: "Invalid week" }, { status: 400 });
  const by = url.searchParams.get("by")?.trim() || undefined;

  const report = getWeeklyReport(week, { reportedBy: by });
  const header = ["date", "job_number", "job_name", "customer", "hours", "description", "ticket", "reported_by", "source"];
  const rows = [...report.entries]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((e) =>
      [e.date, e.job.number, e.job.name, e.job.customer, e.hours, e.description, e.ticket, e.reportedBy, e.source]
        .map(csvCell)
        .join(","),
    );
  const body = [header.join(","), ...rows].join("\r\n") + "\r\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="zeff-${week.key}${by ? "-" + by : ""}.csv"`,
    },
  });
}
