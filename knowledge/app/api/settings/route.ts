import { NextResponse } from "next/server";
import { saveSettings, type Settings } from "@k/db";
import { fail, unauthorized } from "@k/http";

/** Change the settings: spaces, pages per space, models, import folder. */
export async function POST(req: Request) {
  const no = unauthorized(req);
  if (no) return no;
  try {
    const b = (await req.json()) as Partial<Settings>;
    return NextResponse.json(saveSettings({ spaces: b.spaces, maxPages: b.maxPages, compileBackend: b.compileBackend, compileModel: b.compileModel, askBackend: b.askBackend, askModel: b.askModel, importDir: b.importDir }));
  } catch (e) {
    return fail(e, 400);
  }
}
