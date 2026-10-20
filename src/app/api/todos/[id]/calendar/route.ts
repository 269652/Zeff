import { NextResponse } from "next/server";
import { getTodo } from "@/lib/boards/store";
import { calendarDatabase } from "@/plugins/workspace/calendar-database";

/** GET /api/todos/:id/calendar — to the calendar at the day a recurring todo is due (the series of the todo: its next appointment). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const todo = Number.isInteger(Number(id)) ? getTodo(Number(id)) : null;
  if (!todo) return new Response("Not found", { status: 404 });
  const day = todo.due ?? new Date().toLocaleDateString("sv-SE");
  const db = calendarDatabase();
  const to = db ? `/workspace/${db}?v=month&d=${day}` : `/calendar`;
  return NextResponse.redirect(new URL(to, req.url));
}
