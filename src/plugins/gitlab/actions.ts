/** The GitLab plugin's actions: replies and resolved threads on merge requests; opening and merging them (delivery). Client-safe. */
import { action, noteId, str } from "../actions/types";

export const GITLAB_ACTIONS = [
  action({
    type: "gitlab-reply",
    plugin: "gitlab",
    label: "Reply to GitLab comment",
    verb: "Reply",
    comms: true,
    offer: {
      when: "Eine Antwort im Thread eines Merge-Request-Kommentars.",
      fields: { note: "note:<id> des Kommentars (aus seiner Kennung gitlab:note:<id>)", body: "die fertige Antwort (Markdown)" },
      example: { type: "gitlab-reply", note: "note:461450", body: "Umgesetzt — die Klassen kommen jetzt per use-Statement." },
    },
    clean: (o) => (noteId(o.note) && str(o.body) ? { type: "gitlab-reply", note: noteId(o.note), body: str(o.body).slice(0, 8000) } : null),
    title: (op) => `Reply in GitLab (${op.note})`,
    note: (op) => ({ heading: `Reply in GitLab (${op.note})`, detail: null, body: op.body }),
  }),
  action({
    type: "gitlab-resolve",
    plugin: "gitlab",
    label: "Resolve GitLab thread",
    verb: "Resolve",
    comms: true,
    offer: {
      when: "Der Thread eines Merge-Request-Kommentars ist erledigt.",
      fields: { note: "note:<id> des Kommentars (aus seiner Kennung gitlab:note:<id>)" },
      example: { type: "gitlab-resolve", note: "note:461450" },
    },
    clean: (o) => (noteId(o.note) ? { type: "gitlab-resolve", note: noteId(o.note) } : null),
    title: (op) => `Resolve GitLab thread (${op.note})`,
    note: (op) => ({ heading: "Resolve GitLab thread", detail: op.note, body: null }),
  }),
  action({
    type: "gitlab-open-mr",
    plugin: "gitlab",
    label: "Open merge request",
    verb: "Open MR",
    delivery: true,
    clean: (o) =>
      str(o.project) && str(o.source) && str(o.target)
        ? { type: "gitlab-open-mr", repo: str(o.repo), project: str(o.project), source: str(o.source), target: str(o.target), title: str(o.title) || str(o.source), description: str(o.description) }
        : null,
    title: (op) => `Open MR: ${op.source} → ${op.target}`,
    note: (op) => ({ heading: "Open MR", detail: `${op.source} → ${op.target}${op.title ? ` · “${op.title}”` : ""}`, body: null }),
  }),
  action({
    type: "gitlab-merge",
    plugin: "gitlab",
    label: "Merge merge request",
    verb: "Merge",
    delivery: true,
    clean: (o) => (str(o.project) && Number(o.iid) > 0 ? { type: "gitlab-merge", project: str(o.project), iid: Number(o.iid), source: str(o.source) } : null),
    title: (op) => `Merge !${op.iid}`,
    note: (op) => ({ heading: `Merge !${op.iid}`, detail: `${op.source} — as soon as the MR is approved`, body: null }),
  }),
];
