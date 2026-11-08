import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { t } from "@/lib/i18n/server";
import { chatTodos } from "@/lib/chat";
import { getTodo } from "@/lib/todos/store";
import { runsForTodos } from "@/lib/work/store";
import { isActive, type WorkRunView } from "@/lib/work/shared";
import { formatDateTime } from "@/lib/format";
import { ClaudeSession } from "@/components/work/ClaudeSession";
import { SessionThread, type SessionTurn } from "@/components/work/SessionThread";
import { ChatComposer } from "./ChatComposer";

export async function generateMetadata(): Promise<Metadata> {
  return { title: t("Chat") };
}

/**
 * The chat — the phone's second main screen (beside the Todos): you talk to Zeff, a live Claude agent that works in Zeff
 * itself (src/lib/chat.ts) — it makes todos, writes notes, looks things up in your mail, chats and tickets, and asks
 * you here before it acts outside Zeff. Opens on your newest chat; "New chat" starts another, the list the earlier ones.
 */
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ run?: string; new?: string }> }) {
  await connection();
  const sp = await searchParams;
  const chats = chatTodos(30);
  const runs = runsForTodos(chats.map((c) => c.id));
  // The chat shown: the asked-for run's, else (not "new") the newest one.
  const asked = Number(sp.run) || null;
  const todoId = asked ? [...runs.entries()].find(([, rs]) => rs.some((r) => r.id === asked))?.[0] : sp.new ? undefined : chats.find((c) => runs.has(c.id))?.id;
  // (Each message a run; oldest first.)
  const conversation: WorkRunView[] = todoId ? [...(runs.get(todoId) ?? [])].reverse() : [];
  const todo = todoId ? getTodo(todoId) : undefined;
  const turns: SessionTurn[] = conversation.map((r) => ({
    run: r,
    ask: todo?.userNotes.filter((n) => n.kind === "instruction" && n.run === r.id).map((n) => n.text).join("\n\n") || null,
    label: "",
  }));
  const last = conversation[conversation.length - 1];
  const live = !!last?.session && last.status === "running";
  const earlier = chats.filter((c) => c.id !== todoId && runs.has(c.id));
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <header className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{todo?.text ?? t("Chat")}</h1>
        {earlier.length > 0 && (
          <details className="relative">
            <summary className="btn btn-sm cursor-pointer list-none">{t("Earlier chats")}</summary>
            <ul className="absolute right-0 z-20 mt-1 max-h-[60vh] w-72 max-w-[85vw] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
              {earlier.map((c) => {
                const newest = runs.get(c.id)?.[0];
                return (
                  <li key={c.id}>
                    <Link href={`/chat?run=${newest?.id}`} className="block rounded-md px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900">
                      <span className="line-clamp-2">{c.text}</span>
                      <span className="text-xs text-zinc-500">{formatDateTime(c.createdAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        {todoId && (
          <Link href="/chat?new=1" className="btn btn-sm">
            {t("New chat")}
          </Link>
        )}
      </header>

      {todoId && last ? (
        <>
          <SessionThread turns={turns} />
          <div className="sticky bottom-20 z-10 bg-zinc-50/95 pt-1 pb-2 backdrop-blur sm:bottom-0 dark:bg-zinc-950/95">
            {live ? <ClaudeSession key={last.id} run={last} /> : <ChatComposer runId={last.id} placeholder={isActive(last.status) ? t("Working … — your message goes in when it has answered") : t("Reply …")} />}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("Talk to Zeff: it makes todos, writes notes, looks things up in your mail, chats and tickets — and asks you here before it does anything outside Zeff.")}
          </p>
          <ChatComposer
            suggestions={[t("What's due today?"), t("Note a todo: call the plumber tomorrow"), t("What's new in my mail since yesterday?")]}
          />
        </div>
      )}
    </div>
  );
}
