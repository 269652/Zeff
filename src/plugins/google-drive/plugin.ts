import { definePlugin } from "../define";

/** Google Drive: what it is and what it brings (its manifest). */
export default definePlugin({
  id: "google-drive",
  order: 120,
  name: "Google Drive",
  description: "Keeps a copy of your documents in your Google Drive — and, if you turn it on under Backups, of your backups. Files you add to Zeff's Documents folder in Drive can come into Zeff too (off until you switch it on). Signs in with an OAuth client of your own (free, made once in Google Cloud Console): by default Zeff only sees the files it puts in Drive itself.",
  category: "connector",
  defaultInstalled: false,
  beta: "Not yet tried against a real Google account for long — if Google changes its sign-in or API, a sync can fail (it says so on the Google Drive page and in the Sync menu). Backups hold your whole database: they only go to Drive when encrypted (set a password under Backups), unless you allow otherwise.",
  requires: "A Google Cloud OAuth client of your own (the Google Drive page shows the few steps) and the Google Drive API switched on in its project.",
  settings: { href: "/google-drive", what: "Your OAuth client, signing in, what syncs" },
  nav: [
    { href: "/google-drive", label: "Google Drive", hint: "Documents and backups in your Drive" },
  ],
  routes: ["/google-drive", "/api/google-drive"],
  extensions: [
    { key: "backup-sync", for: "backup", name: "Backups to Google Drive", description: "Copies each backup to Drive as it is made (encrypted ones only, unless you allow others there); what the retention removes here goes from Drive too, if set. Off until you turn it on — a backup is your whole database.", defaultInstalled: false, syncSteps: ["drivebackup"] },
    { key: "documents-sync", for: "documents", name: "Documents to Google Drive", description: "Copies your documents to a folder in Drive (and keeps it up to date). What you add to that folder in Drive comes into Zeff only if you switch that on on the Google Drive page.", defaultInstalled: true, syncSteps: ["drivedocs"] },
  ],
});
