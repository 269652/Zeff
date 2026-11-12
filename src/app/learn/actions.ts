"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/lib/redirect";

/** The one click on /learn: everything Learn needs is set up (src/plugins/learn/setup.ts), then its Courses are open. */
export async function setupLearnAction(): Promise<void> {
  let target = "/learn";
  try {
    const { setupLearn, learnStatus } = await import("@/plugins/learn/setup");
    const done = await setupLearn();
    const s = await learnStatus();
    revalidatePath("/learn");
    target = s.coursesId ? `/workspace/${s.coursesId}` : `/learn?ok=${encodeURIComponent(done.join(" · "))}`;
  } catch (e) {
    target = `/learn?err=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`;
  }
  return redirect(target);
}
