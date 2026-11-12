import { getPref, setPref } from "@/lib/prefs";
import { installedLanguages, languageById, type KernelLanguage, type Where } from "./languages";

/**
 * What the Notebook may do and where each language can run. Whether code may run at all is a switch (off until you turn it on); a
 * session runs in a Docker container by default ("auto": a container when Docker answers, else on this computer), or as you set it
 * per language. A language is offered only when it can run somewhere. Server only.
 */

export type Mode = "auto" | "docker" | "host";
export const MODES: readonly Mode[] = ["auto", "docker", "host"];

const ENABLED = "notebook.enabled";
const TIMEOUT = "notebook.timeoutSeconds";
const NETWORK = "notebook.network";
const MEMORY = "notebook.memory";

export const notebookEnabled = (): boolean => getPref<boolean>(ENABLED, false) === true;
export const setNotebookEnabled = (on: boolean): void => setPref(ENABLED, !!on);
/** How long one cell may run (seconds): 5 … 3600, 120 unless set. */
export const cellTimeoutSeconds = (): number => Math.min(3600, Math.max(5, Math.floor(Number(getPref<number>(TIMEOUT, 120))) || 120));
export const setCellTimeoutSeconds = (n: number): void => setPref(TIMEOUT, Math.min(3600, Math.max(5, Math.floor(n) || 120)));
/** Whether a container may reach the network (pip, cargo, fetch): yes unless switched off. */
export const networkAllowed = (): boolean => getPref<boolean>(NETWORK, true) !== false;
export const setNetworkAllowed = (on: boolean): void => setPref(NETWORK, !!on);
/** A container's memory limit ("512m", "2g"). */
export const memoryLimit = (): string => {
  const v = String(getPref<string>(MEMORY, "2g")).trim().toLowerCase();
  return /^\d{2,5}[mg]$/.test(v) ? v : "2g";
};
export const setMemoryLimit = (v: string): void => setPref(MEMORY, /^\d{2,5}[mg]$/i.test(v.trim()) ? v.trim().toLowerCase() : "2g");

export const modeOf = (id: string): Mode => {
  const v = getPref<string>(`notebook.mode.${id}`, "auto");
  return (MODES as readonly string[]).includes(v) ? (v as Mode) : "auto";
};
export const setModeOf = (id: string, mode: string): void => setPref(`notebook.mode.${id}`, (MODES as readonly string[]).includes(mode) ? mode : "auto");
/** The image a language runs in: the one set, else the language's own. */
export const imageOf = (lang: KernelLanguage): string => {
  const v = String(getPref<string>(`notebook.image.${lang.id}`, "")).trim();
  return /^[\w][\w./:@-]{0,200}$/.test(v) ? v : lang.docker.image;
};
export const setImageOf = (id: string, image: string): void => setPref(`notebook.image.${id}`, image.trim());

export type LangStatus = {
  id: string;
  label: string;
  monaco: string;
  extension: string;
  mode: Mode;
  image: string;
  docker: boolean;
  host: { found: boolean; version?: string };
  /** Where it would run now; null: nowhere (it is not offered). */
  where: Where | null;
};

const hostCache = new Map<string, { at: number; v: { program: string[]; version: string } | null }>();
export async function hostProbe(lang: KernelLanguage, force = false): Promise<{ program: string[]; version: string } | null> {
  const hit = hostCache.get(lang.id);
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.v;
  const v = await lang.probe().catch(() => null);
  hostCache.set(lang.id, { at: Date.now(), v });
  return v;
}

/** Where a language runs, by its mode and what is there. */
export function chooseWhere(mode: Mode, dockerUp: boolean, hostFound: boolean): Where | null {
  if (mode === "docker") return dockerUp ? "docker" : null;
  if (mode === "host") return hostFound ? "host" : null;
  return dockerUp ? "docker" : hostFound ? "host" : null;
}

/** The languages of the installed plugins and where each can run — a language that can run nowhere has `where: null`. */
export async function languageStatuses(force = false): Promise<LangStatus[]> {
  await import("@/plugins/contributions");
  const { dockerStatus } = await import("./runner");
  const dk = await dockerStatus(force);
  return Promise.all(
    installedLanguages().map(async (l): Promise<LangStatus> => {
      const host = await hostProbe(l, force);
      const mode = modeOf(l.id);
      return { id: l.id, label: l.label, monaco: l.monaco, extension: l.extension, mode, image: imageOf(l), docker: dk.up, host: { found: !!host, ...(host ? { version: host.version } : {}) }, where: chooseWhere(mode, dk.up, !!host) };
    }),
  );
}

/** How to start a language's session now, or why it cannot be. */
export async function resolveLanguage(id: string): Promise<{ lang: KernelLanguage; where: Where; image: string; hostProgram: string[] | null }> {
  await import("@/plugins/contributions");
  const lang = languageById(id);
  if (!lang) throw new Error(`No such language: ${String(id).slice(0, 20)} (is its plugin installed?).`);
  const { dockerStatus } = await import("./runner");
  const dk = await dockerStatus();
  const host = await hostProbe(lang);
  const where = chooseWhere(modeOf(id), dk.up, !!host);
  if (!where) {
    const mode = modeOf(id);
    throw new Error(mode === "docker" ? `${lang.label} runs in Docker, and Docker is not running.` : mode === "host" ? `${lang.label} is not installed on this computer.` : `${lang.label} can run nowhere: Docker is not running and it is not installed on this computer.`);
  }
  return { lang, where, image: imageOf(lang), hostProgram: host?.program ?? null };
}

/** What a session on this computer may see of the environment: the system's basics and the toolchains' homes — no tokens, keys or Zeff's own settings. */
export function kernelEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const keep = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|HOMEDRIVE|HOMEPATH|USERPROFILE|USERNAME|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES(\(X86\))?|COMMONPROGRAMFILES(\(X86\))?|OS|NUMBER_OF_PROCESSORS|PROCESSOR_\w+|LANG|LC_\w+|TZ|CARGO_HOME|RUSTUP_HOME|PYTHONHOME|PYTHONPATH|VIRTUAL_ENV|NVM_\w+|NODE_PATH|SSL_CERT_FILE|HTTPS?_PROXY|NO_PROXY)$/i;
  const secret = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE)/i;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && keep.test(k) && !secret.test(k)) env[k] = v;
  return { ...env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", MPLBACKEND: "Agg", ...extra } as unknown as NodeJS.ProcessEnv;
}
