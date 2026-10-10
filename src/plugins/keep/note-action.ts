/**
 * Google Keep's action for Auto-Aktionen (its extension "Notiz anlegen"): a note on one of your
 * Keep boards — something to keep, not to do (a list, the details of an appointment, ideas). Offered
 * and run only while the extension is on. Client-safe.
 */
import { action, str } from "../actions/types";

export const KEEP_ACTIONS = [
  action({
    type: "keep-note",
    plugin: "keep",
    label: "Notiz anlegen",
    verb: "Anlegen",
    offer: {
      when: "Etwas festzuhalten statt zu tun: eine Einkaufs- oder Packliste, die Eckdaten einer Absprache oder eines Termins, Ideen, Infos zum Nachschlagen, die das Todo braucht — als Notiz in einem meiner Keep-Boards. Listenpunkte als Zeilen „- [ ] …“. Keine Passwörter oder Zugangsdaten.",
      fields: {
        board: "das Keep-Board (sein Name, z. B. Privat, Ideen, Einkauf) — ohne Angabe das erste",
        title: "der Titel der Notiz (kurz)",
        text: "der Text der Notiz — Listen als Zeilen „- [ ] …“",
      },
      example: { type: "keep-note", board: "Einkauf", title: "Einkauf Wochenende", text: "- [ ] Milch\n- [ ] Brot\n- [ ] Kaffee" },
    },
    clean: (o) =>
      str(o.title) || str(o.text)
        ? { type: "keep-note", board: str(o.board).slice(0, 80), title: str(o.title).slice(0, 300), text: str(o.text).slice(0, 8000) }
        : null,
    title: (op) => `Notiz „${op.title || op.text.split("\n")[0].slice(0, 60)}“${op.board ? ` in ${op.board}` : ""}`,
    note: (op) => ({ heading: `Notiz „${op.title || "ohne Titel"}“`, detail: op.board ? `Keep-Board ${op.board}` : "erstes Keep-Board", body: op.text }),
  }),
];
