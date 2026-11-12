"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { toast } from "@/components/Toaster";
import { ClaudeSession } from "@/components/work/ClaudeSession";
import { DanglingSessions } from "@/components/work/DanglingSessions";
import { ChatComposer } from "@/app/chat/ChatComposer";
import { FailedRun } from "@/app/chat/FailedRun";
import { StuckRun } from "@/app/chat/StuckRun";
import type { WorkRunView } from "@/lib/work/shared";
import { chatStartAction, chatStateAction } from "../actions";

type State = { todoId: number | null; version: number; live: WorkRunView | null; last: { id: number; status: string; error: string | null } | null; stuck: number | null; queued: boolean; active: boolean };

/**
 * The box of a plugin's live chat (the <chat> tag): a button to begin; then, while the agent speaks, its session; else the message box. It
 * looks at the chat every few seconds — which also brings the conversation database up to date — and says (`onGrew`) when that has more in
 * it, so the view reloads what it shows from there.
 */
export function ChatBox({ chat, keyName, title, first, placeholder, begin, onGrew }: { chat: string; keyName: string; title: string; first: string; placeholder: string; begin: string; onGrew: () => void }) {
  const t = useT();
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef(-1);
  const grew = useRef(onGrew);
  useEffect(() => {
    grew.current = onGrew;
  });
  const look = useCallback(async () => {
    const r = await chatStateAction(chat, keyName);
    if (!r.ok) return void toast(r.error, { tone: "error" });
    setS(r as unknown as State);
    if (seen.current >= 0 && r.version !== seen.current) grew.current();
    seen.current = r.version;
  }, [chat, keyName]);
  useEffect(() => {
    seen.current = -1;
    setS(null);
    void look();
    const timer = setInterval(() => void look(), 2500);
    return () => clearInterval(timer);
  }, [look]);

  if (!s) return <p className="text-sm text-zinc-500">{t("Loading …")}</p>;
  if (!s.todoId || !s.last) {
    return (
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await chatStartAction(chat, keyName, title, first);
          setBusy(false);
          if (!r.ok) return void toast(r.error, { tone: "error" });
          grew.current();
          void look();
        }}
      >
        {busy ? "…" : begin}
      </button>
    );
  }
  return (
    <div className="space-y-2">
      {s.stuck && <StuckRun runId={s.stuck} />}
      {!s.live && (s.last.status === "failed" || s.last.status === "interrupted") && <FailedRun runId={s.last.id} error={s.last.error} text="" />}
      {!s.live && s.queued && <DanglingSessions waiting />}
      {s.live ? <ClaudeSession key={s.live.id} run={s.live} wide /> : <ChatComposer runId={s.last.id} stay placeholder={s.active ? t("Working … — your message goes in when it has finished") : placeholder} />}
    </div>
  );
}
