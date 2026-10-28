import fs from "node:fs";
import path from "node:path";
import { BASE_DIR, DEFAULT_ACCOUNT, accountKnowledge, activeAccountId, listAccounts, withAccount } from "@/db/accounts";
import { isInstalled } from "@/plugins/state";
import { accountToken } from "@/lib/account-tokens";

/**
 * Which knowledge servers there should be: the first account's always (knowledge/data — the
 * knowledge base as it always was, with or without the plugin), and one more per other account
 * with the Knowledge plugin, each with its port and data folder; plus the account you're in
 * (https://knowledge.zeff goes to its server). Kept in data/knowledge-instances.json — the
 * launcher (Zeff.exe) watches it and starts and stops the servers to match.
 */
export const KNOWLEDGE_INSTANCES_FILE = path.join(BASE_DIR, "knowledge-instances.json");

/** token: what it shows Zeff for its account's export (/api/knowledge/export) — that account's only. */
export type KnowledgeInstance = { account: string; name: string; port: number; dataDir: string | null; token: string };

function hasKnowledge(id: string): boolean {
  try {
    return withAccount(id, () => isInstalled("knowledge"));
  } catch (e) {
    console.error(`[knowledge] can't read the plugins of account ${id}`, e);
    return false;
  }
}

export function knowledgeInstances(): { active: string; instances: KnowledgeInstance[] } {
  const instances: KnowledgeInstance[] = [];
  for (const a of listAccounts()) {
    if (a.id !== DEFAULT_ACCOUNT && !hasKnowledge(a.id)) continue;
    const { port, dataDir } = accountKnowledge(a.id);
    instances.push({ account: a.id, name: a.name, port, dataDir, token: accountToken("knowledge", a.id) });
  }
  return { active: activeAccountId(), instances };
}

/** Write the list when it changed (after starting, installing a plugin, adding/removing/switching accounts). */
export function writeKnowledgeInstances(): void {
  try {
    const body = `${JSON.stringify(knowledgeInstances(), null, 2)}\n`;
    if (fs.existsSync(KNOWLEDGE_INSTANCES_FILE) && fs.readFileSync(KNOWLEDGE_INSTANCES_FILE, "utf8") === body) return;
    fs.mkdirSync(BASE_DIR, { recursive: true });
    fs.writeFileSync(`${KNOWLEDGE_INSTANCES_FILE}.part`, body);
    fs.renameSync(`${KNOWLEDGE_INSTANCES_FILE}.part`, KNOWLEDGE_INSTANCES_FILE);
  } catch (e) {
    console.error("[knowledge] writing knowledge-instances.json failed", e);
  }
}
