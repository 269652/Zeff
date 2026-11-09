/**
 * About you: what Zeff and its AI should know about you ("I teach F4", "I work part-time on Fridays") — one record,
 * edited in four places that all point to it: Settings → About me, the People app (beside your name), the AI settings'
 * "Context about you", and its page in System → Prompts. It goes in front of every AI task, worker and agent
 * (plugins/llm/run.ts llmPreamble: the prompt "llm-context").
 *
 * Where it lives: the prompt's page when there is one (the Workspace's System → Prompts — an edit there is the record),
 * else the AI settings' context field; both are written together, so either way every place reads the same. Server only.
 */
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/server";
import { promptText, writePromptPage } from "@/lib/prompts";
import { getLlmSettings, saveLlmSettings } from "@/plugins/llm/settings";

/** At most this long (together with your general instructions the AI settings allow 8000). */
export const ABOUT_ME_MAX = 6000;

/** What you wrote about yourself — as every AI prompt has it. */
export const aboutMe = (): string => promptText("llm-context", "", getLlmSettings().context).trim();

/** About you, changed (from any of its places): the AI settings' field and its prompt page alike. */
export async function setAboutMe(text: string): Promise<void> {
  const v = String(text ?? "").trim();
  if (v.length > ABOUT_ME_MAX) throw new ValidationError(t("About me: at most {n} characters.", { n: ABOUT_ME_MAX }));
  const s = getLlmSettings();
  saveLlmSettings({ ...s, context: v });
  await writePromptPage("llm-context", v);
}
