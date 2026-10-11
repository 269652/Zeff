import { EFFORTS, type Effort, type SessionMode } from "@/lib/work/shared";

/**
 * What a new session (or your next message) can choose, per backend: only a backend that runs as
 * live sessions has choices — its driver's modes, the models it offers, its effort levels. The
 * composer shows the chosen backend's, and starts over with that backend's defaults when you
 * switch (a model of one backend is nothing to another).
 */
export type BackendChoices = {
  /** The driver's modes (Bypass / Full access only where allowed), and the one it starts in. */
  modes: SessionMode[];
  defaultMode: string;
  /** "" first: the backend's own default. `efforts`: the levels this model takes (none given: all). */
  models: { value: string; label: string; efforts?: string[] }[];
  /** It has an effort choice, and its default level. */
  effort: boolean;
  defaultEffort: Effort;
  /** It can run as administrator (Claude, on Windows with the plugin). */
  admin: boolean;
};

export type ComposerOptions = {
  /** The backend a session starts on when none is picked. */
  defaultProvider: string;
  /** The backends to choose from, each with whether it runs live. */
  providers: { id: string; label: string; live: boolean }[];
  choices: Record<string, BackendChoices>;
};

/** The effort levels a model takes (all of Zeff's when it names none). */
export const effortsOf = (model: { efforts?: string[] } | undefined): Effort[] => EFFORTS.filter((e) => e === "" || !model?.efforts || model.efforts.includes(e));
