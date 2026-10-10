# Google Keep schreiben (beta)

**Status: parked (2026-10-10).** It works end to end and is deployed, but it's a beta plugin, off by default (`keep-write` in `src/plugins/catalog.ts`, built on `keep`). What still has to happen before it's more than a beta is under [To do](#to-do).

While the plugin is installed, the Google Keep view (`/keep/google`) works like your own boards. You can:

- write a note or a list;
- edit the title, the text and the labels;
- tick items;
- change the colour, pin a note, archive it, put it in the trash.

Each change is made in Google Keep itself, then Zeff shows the note as Keep confirmed it.

## Board sync ("Sync to Google Keep")

Your own Keep boards get a "Sync to Google Keep" button (`board-sync.ts`, `BoardSyncButton.tsx`). The board's notes become notes in Keep labelled with the board's name, and the two sides stay the same:

1. Keep is read anew (the Keep sync).
2. Synced notes deleted in Zeff go to Keep's trash (`keep_own_deleted`).
3. Each note of the board is handled like this:
   - **Not linked:** it is created in Keep with the board's label, and its Google id is kept (`keep_own_notes.google_id`).
   - **Linked:** both sides are compared with their fingerprints from the last sync (`google_sync`). If only Zeff's side changed, it goes to Keep. If only Keep's side changed, it is taken over. If both changed, the later change wins.
   - **Gone from Keep:** it is archived in Zeff, not deleted, and unlinked.
4. Notes in Keep with the board's label that aren't linked yet are brought into the board.

Linked Google notes are left out of the Google Keep view, the knowledge export and the Lage (`linkedFilter` in `store.ts`). They show up there as the board's note, so nothing appears twice.

**Verified (2026-10-10, against the real Keep, on a DB copy):** create, push a local change, pull a change made in Keep, delete locally (to Keep's trash). The user's note with the board's label was imported and never written.

**Reader fix found along the way:** Keep's page brings its latest notes in the HTML itself (`loadChunk(JSON.parse('…'))`), not through the changes it loads afterwards. Both the reader (`keep_notes`) and `keep_write` used to miss them; `nodesFromHtml` in `driver.mjs` reads them now.

**Still open:**
- A conflict is decided per note (the later change wins), not per field.
- A board renamed after syncing keeps the old label on the notes already in Keep.
- Moving a note to another board keeps its old board's label in Keep until the next sync of the new board.

## How it works

Zeff never calls Keep's sync API itself. It drives Keep's own web page the way you would by hand, in a fresh tab of the account's automation Chrome, and reads back what Keep's page sends to Google.

| Where | What |
| --- | --- |
| `src/plugins/keep/write.mjs` | The editing in Keep's page: `createNote`, `updateNote`, `trashNote`. Covers title and text, checklists and their ticks, colour, labels, pin, archive, trash. `openNote` checks that the editor really shows the target note before anything is changed: the address must name it, and its title (or its first line) must match. |
| `src/plugins/keep/driver.mjs` | The MCP tool `keep_write {op, id, kind, title, text, list, color, labels, pinned, archived, current}`. It opens a tab and waits until Keep has loaded everything (`truncated: false`). After the change it waits for Keep's saves: at least one, none still open, 4 s quiet, **and** the asked state sent. A trash is only sent once Keep's undo bar is gone. Returns `{ok, confirmed, note}`. Title and text come from the editor; colour, pin, archive and labels from the last save Keep sent. |
| `src/plugins/keep/model.mjs` | Decodes Keep's content model (`serializedChunks` commands) into text and items; `textToItems` / `itemsToText`; the colours' names in Keep's UI. |
| `src/plugins/keep-write/write.ts` | Runs the driver (`runStdioSession`) and keeps Keep's answer in `keep_notes`. The only caller of `keep_write`, enforced by `tests/safety.test.ts`. |
| `src/plugins/keep-write/server-actions.ts` | `createGoogleNoteAction`, `updateGoogleNoteAction`, `trashGoogleNoteAction`. |
| `src/plugins/keep/KeepBoardView.tsx` | The UI, shared with your own boards (`source: {kind: "google"}`). A tick shows at once and the next tick builds on it. A card is busy while Keep saves. |
| `PluginManifest.beta` | The warning text. It shows as the Beta badge and warning box on the Plugins page and on `/keep/google`, and as a question before installing. |

### Keep's page, as learned (German UI)

- The title is `[contenteditable=true][role=textbox]`; its aria-label "Titel" is there only while it's empty.
- The composer's list items are not contenteditable. In an opened note they are `[contenteditable][role=combobox][aria-label=Listeneintrag]`.
- Checkboxes are `div[role=checkbox]` and sit in another branch of the markup than their text, so they're paired with their text by height on screen. Ticked items fold away under "N abgeschlossene Einträge".
- **Never press Ctrl+A in an opened list.** Keep selects all items, and Backspace then asks "Markierte Einträge löschen". `setField` selects the field's own content instead.
- "Kästchen ausblenden" on a list with ticked items asks "Markierte Einträge löschen". Zeff answers "Behalten" (`keepItems`).
- Keep re-renders the editor now and then, for example when a list turns into text. `fresh()` tags it again.
- The "Mehr" menu has: Label hinzufügen, Zeichnung hinzufügen, Kopie erstellen, Kästchen ein-/ausblenden, In Docs kopieren, Versionsverlauf, Notiz löschen.
- The label picker is a `role=menu` with the input "Namen des Labels eingeben". Each label is a `role=menuitemcheckbox` whose aria-label is its name and whose aria-checked says whether the note has it. While no label has exactly the typed name, there's a button `Label "…" erstellen`.
- A label taken off stays in the note's `labelIds`, marked `deleted`. The reader filters those out.
- Colours: Standard, Koralle, Pfirsich, Sand, Minze, Salbei, Nebel, Sturm, Dämmerung, Blüte, Lehm, Kreide (`COLOR_UI`).
- `location.hash = "#LIST/<serverId>"` opens a note. A click at a card's top-left hits "Notiz auswählen", not the note.
- Keep keeps nothing in the browser: closing the tab before the saves are answered loses them. A fresh tab may be handed only what changed, so a note may be missing from what it loaded (the driver then finds it by `serverId` in the saves).

## Verified (2026-10-10, Privat account, Keep in German)

Run against the real Keep with test notes, which were all deleted again:

- create a list with a tick, colour, pin and an existing label;
- update: the title, ticks, an added item, the colour, unpin, taking the label off;
- trash.

The same flow worked in the UI on a snapshot DB (create, tick, trash), and so did `scripts/keep-write-check.mjs`.

**Not verified yet:**
- archive / unarchive;
- plain notes (not lists): editing their text, turning a note into a list and back;
- resetting the colour to "Standard";
- creating a new label;
- Keep in English;
- a second Google account (`u/1`);
- notes with images, drawings, reminders or collaborators.

## To do

Roughly in order of value:

1. **Edit list items in place.** Changing or adding items now rewrites the whole list: checkboxes off, text set, checkboxes on, ticks set again (`setList`). That's the most fragile path, and Keep loses its items' identity. Better: edit the item that changed (`[role=combobox][aria-label=Listeneintrag]`), add new ones with "+ Listeneintrag", delete with the item's ✕, and keep the full rewrite only as a fallback.
2. **Verify the untested paths** listed above, starting with archive and plain notes. Each needs one run of the check script extended for it.
3. **Notes with more than text** (images, drawings, reminders, collaborators): make sure an update leaves them alone. If it can't, refuse the edit with a message, since a rewrite of the text could drop content.
4. **Combine quick changes.** Each change is a separate Keep write of about 30 s, one after another (the driver's tab lock). Several ticks or edits on one note in a row should go out as one write. Possibly a per-note queue in `keep-write/write.ts` that merges patches.
5. **After a write that failed or wasn't confirmed, sync that note.** A half-done write can leave Zeff's copy behind Keep. Read the note again (or run a Keep sync) and show what Keep really has.
6. **Keep sync: deletions on incremental reads.** When Keep hands only what changed (`full: false`), notes deleted in Keep stay in `keep_notes`. Use Keep's own markers for removed nodes, or do a full read now and then.
7. **New note in a label view** (`/keep/google?label=X`): give it that label in the composer.
8. **Auto-Aktionen "Notiz anlegen"** (`keep:note-action`) could offer Google Keep as a target while `keep-write` is installed.
9. **English Keep UI:** the word lists in `write.mjs` (`re([...])`, `COLOR_UI`) have English alternatives, but they're untested. The picker's input label in English is a guess.
10. **Tests without Keep:** unit tests for `model.mjs` (`decodeModel`, `textToItems`, `itemsToText`) and `isChecklist` from recorded nodes. The rest needs a real Keep (the check script).

## Testing

Only with test notes, and only in the account's automation Chrome (Privat: `http://127.0.0.1:9231`):

```bash
node scripts/keep-write-check.mjs --cdp http://127.0.0.1:9231
```

The script creates, updates and trashes one note titled "Zeff-Test HH:MM:SS (wird gleich gelöscht)", then checks that none is left. `--label <name>` also tries an existing label. `--cleanup` trashes leftover test notes; it finds them by title through `keep_notes` and never touches other notes. `KEEP_DEBUG=1` traces each step, and `KEEP_SHOTS=<folder>` adds a picture of the editor after each step.

To try the UI, use a snapshot DB and a second `next start`, never the live DB. Install the plugin there; its confirm dialog asks first.

The automation Chrome sometimes takes seconds to answer when the machine is busy. `connectToChrome` asks a slow tab once more before calling it stuck.
