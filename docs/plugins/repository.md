# Plugins from a repository: packages.json, update notes, merging

Zeff's runtime plugins (folders with a `zeff-plugin.json`, see [manifest](manifest.md)) live in their own repository —
`zeff-plugins`, beside Zeff (`../zeff-plugins`), one folder per plugin under `plugins/`: Learn (`plugins/learn`) and the language packs
(`plugins/lang-de`, `plugins/lang-es` — Zeff's German and Spanish). A Zeff installs them from there and keeps them up to date; nothing about a plugin is compiled into Zeff.

## packages.json

`<data>/packages.json` (or `ZEFF_PACKAGES_FILE`) says which plugins this Zeff has and where each comes from:

```json
{
  "sources": { "zeff-plugins": { "url": "../zeff-plugins", "branch": "main" } },
  "plugins": { "learn-ext": { "source": "zeff-plugins", "path": "plugins/learn" } }
}
```

- **sources** — repositories by a name: a folder on this computer (relative to where Zeff runs), `file://`, an ssh or https git
  address (read with `git`), or `https://github.com/owner/repo` (read through GitHub's web API). `branch` is optional (the
  repository's default). A token for a private repository is entered in Zeff (Plugins → Sources), never written into the file.
- **plugins** — per plugin id, the source and the folder in it (`path`; without it, the folder whose manifest has that id).

A running Zeff **watches the file** (`src/lib/ext/packages-sync.ts`, started in `instrumentation.ts`). When its text changes, every
plugin it lists is brought to the place it names: installed when it isn't there, **reinstalled** when it came from somewhere else
(packages.json now names another repository or folder) — merged with what was changed here, as below. Plugins it doesn't list are
left alone (named as "unlisted", never removed). Zeff writes the file itself when a plugin is installed or updated from a
repository, so the file stays what this Zeff has. What following it did is in `<plugins>/.packages-state.json`.

## Update notes

Every half hour (and on "Check now" under Plugins → Sources) Zeff fetches each source and compares: a plugin installed from there
with a newer version — or the same version with other commits — becomes an **update note**. The note shows on every page (bottom
right, `src/components/ext/PluginUpdates.tsx`): the plugin, `from → to`, the commits since your version that touched its folder, and
**Update** / **Later** (this version isn't offered again; a newer one is). The notes are kept in `<plugins>/.updates.json`.

## Merging, the way git does

An update is merged file by file (`src/lib/ext/merge3.ts`) from three versions: **base** (the commit installed before, read from the
repository it came from — also the old one when packages.json moved the plugin), **mine** (the plugins folder here) and **theirs**
(the new commit):

| base → mine | base → theirs | result |
|---|---|---|
| unchanged | changed | theirs |
| changed | unchanged | mine |
| changed | changed, other lines | both, merged by `git merge-file` |
| changed | changed, same lines | **conflict** |
| — | new | added |
| unchanged | gone | removed |
| changed | gone (or the other way) | **conflict** |

Line endings don't count (a Windows copy and the repository's are the same text). Files made here that the plugin never had stay.

With a conflict nothing is written: the update **waits** (`<plugins>/.merges/<id>.json`) and its note says so. **Settle the
conflicts** opens the merge (`MergeResolver.tsx`): per file the result (git's text with both sides between `<<<<<<<` and `>>>>>>>`),
mine, theirs and base; **Keep mine**, **Take theirs**, **✨ Merge with AI** (`merge-ai.ts` — the AI's merged text lands in the result
with a note of what it decided, for you to check) or your own text, then **Use this text**. When every conflict is settled,
**Finish the update** writes it; **Drop the update** leaves the plugin as it is. After an update the plugin's app (its workspace
package) is brought up to date the usual way — what you changed there stays.

## Publishing a version

Change the plugin in `zeff-plugins`, raise `version` in its `zeff-plugin.json`, commit. Every Zeff that has it offers the update at
its next check, with your commit messages as the notes.

## Signed releases

A release can be signed. The plugin's folder then holds `zeff-release.json`, with every file's SHA-256 and an Ed25519 signature over
them (`src/lib/kernel/release.ts`). Zeff checks it against the publisher keys it ships with (`RELEASE_KEYS`):

| What the repository serves | What Zeff does |
| --- | --- |
| Signed, every file as signed | Installs or updates. The origin remembers the key. |
| A file changed, added or missing after signing; another key; a forged signature | Refuses, and nothing is written. |
| Not signed | As before: installed switched off, with what you grant. |
| Not signed, but the plugin was installed signed | Refuses: a signed plugin is only updated signed. |

Publishing a signed version (of a plugin, or of a patch — a folder with `zeff-mod.json`, see [mods](../mods.md#patches-from-a-repository)):

1. Once: `npm run release:keygen -- <name>` makes a key pair. The private key goes to `~/.zeff-release/<name>.pem` (never into a
   repository). Put the printed public key into `RELEASE_KEYS`; that takes a kernel update.
2. Each version: change the plugin, raise `version`, then `npm run release:sign -- <plugin folder> ~/.zeff-release/<name>.pem <name>`,
   and commit `zeff-release.json` with it. Signing comes last: any later change makes the release refused.
