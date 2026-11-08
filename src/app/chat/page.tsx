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
import { ScrollToEnd } from "./ScrollToEnd";

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
  // A live session still running takes the next message (never a second run queued behind it, waiting for its worker).
  const liveRun = [...conversation].reverse().find((r) => !!r.session && r.status === "running");
  const earlier = chats.filter((c) => c.id !== todoId && runs.has(c.id));
  return (
    // A messenger's shape: the page fills the window (MainArea's full-height pages), the conversation scrolls, the
    // message box stays at the bottom (on a phone above the bottom bar — MainArea leaves its room).
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-3">
      <header className="flex shrink-0 items-center gap-2">
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
          <div id="chat-thread" className="min-h-0 flex-1 overflow-y-auto">
            <SessionThread turns={turns} />
          </div>
          <ScrollToEnd target="chat-thread" />
          <div className="max-h-[55%] shrink-0 overflow-y-auto border-t border-zinc-200 pt-2 dark:border-zinc-800">
            {liveRun ? <ClaudeSession key={liveRun.id} run={liveRun} /> : <ChatComposer runId={last.id} placeholder={isActive(last.status) ? t("Working … — your message goes in when it has answered") : t("Reply …")} />}
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-4">
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
