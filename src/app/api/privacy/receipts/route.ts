/** A month's receipts as a report (Markdown, to keep or hand on): GET /api/privacy/receipts?month=YYYY-MM. */
export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return new Response("month: YYYY-MM", { status: 400 });
  const md = (await import("@/lib/ai/receipts")).exportReceipts(month);
  return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="zeff-ai-receipts-${month}.md"` } });
}
