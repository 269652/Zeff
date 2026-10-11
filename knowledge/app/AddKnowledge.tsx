import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addOwn } from "@k/own";

/** The form to keep something (your own knowledge) — on the overview and the "Eigenes Wissen" page. */
export function AddKnowledgeForm({ action, compact = false }: { action: (fd: FormData) => Promise<void>; compact?: boolean }) {
  return (
    <form action={action} className="space-y-2">
      {!compact && <input name="title" placeholder="Title (optional — else the first line)" className="input" />}
      <textarea
        name="text"
        required
        rows={compact ? 2 : 6}
        placeholder="What you want to keep — a fact, a note, how something works … or just a link (https://…): then the page is read."
        className="input min-h-16 resize-y"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary">Keep</button>
        <span className="text-xs text-zinc-500">Compiled right away — entities and relations go into the graph.</span>
      </div>
    </form>
  );
}

/** What the form holds, kept — then back to `to`, with what came of it (?added=… or ?error=…). For a server action. */
export async function keepFromForm(fd: FormData, to: string): Promise<never> {
  const join = to.includes("?") ? "&" : "?";
  let target: string;
  try {
    const id = await addOwn({ title: String(fd.get("title") ?? ""), text: String(fd.get("text") ?? "") });
    target = `${to}${join}${new URLSearchParams({ added: id })}`;
  } catch (e) {
    target = `${to}${join}${new URLSearchParams({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) })}`;
  }
  revalidatePath("/", "layout");
  redirect(target);
}
