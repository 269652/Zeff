/** A note as a todo's source or context (Google Keep's or one of your boards'). Client-safe. */
export type KeepNoteBrief = {
  /** "keep:<Google's id>" or "keep:n<id>". */
  ref: string;
  title: string;
  text: string;
  labels: string[];
  color: string | null;
  /** In Keep (Google's) or on its board in Zeff. */
  url: string;
  /** "Google Keep" or the board's name. */
  where: string;
  updatedAt: string | null;
  archived: boolean;
};

/** A note's line: its title, else its first line. */
export const noteHeadline = (n: Pick<KeepNoteBrief, "title" | "text">) => n.title || n.text.split("\n")[0].slice(0, 120) || "Notiz";
