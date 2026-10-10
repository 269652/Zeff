# Zeff launcher

An Electron app — Electron's own binary, not rebuilt: `Zeff.exe` on Windows, `Zeff.app` on macOS (renamed and signed ad hoc), `zeff-launcher` behind the `./zeff` start script on Linux. It runs Zeff's Next servers on the bundled Node and serves them over HTTPS:

| Address | Goes to |
| --- | --- |
| `https://zeff`, `https://zeff:1337` | Zeff, `127.0.0.1:9333` |
| `https://knowledge.zeff` | the knowledge server of the account you're in — one per account: `127.0.0.1:9555` (the first), `:9556` … (the others) |
| `http://zeff` | redirects to https |

- `lib/supervisor.js` runs `node next start [knowledge] -H 127.0.0.1 -p <port>` and restarts it after a crash (2 s … 60 s backoff). A port that's already held, for example by the old `Zeff Server` scheduled task, is shown as "not started by the launcher" and proxied as is. Servers a killed launcher left behind are cleaned up on the next start (`data/launcher/pids.json`).
- `lib/proxy.js` terminates TLS on 127.0.0.1 and routes by Host. It keeps the `Host` header and sets `X-Forwarded-Proto/Host/For`, so Next builds https URLs and Server Actions accept the origin. It rewrites `Location: http(s)://localhost:9333/…` back to the browser's address, because Next builds `request.url` from its bind address. Streams pass through and WebSocket upgrades are tunnelled.
- `lib/tls.js` makes the certificate — with Windows' own crypto (`ps/new-cert.ps1`), elsewhere with the system's `openssl`. A "Zeff Local CA" signs a certificate for `zeff`, `knowledge.zeff`, their `.localhost` twins, `localhost` and `127.0.0.1`, and then its private key is deleted. The server certificate lasts 825 days (macOS refuses longer ones) and is renewed a month before. The files are in `data/launcher/tls/`.
- `lib/setup.js` does the one part that needs admin rights: the hosts entry and trusting the CA. Windows: `ps/setup-elevated.ps1` behind UAC (hosts + the computer's Root store). macOS: `ps/setup-elevated.sh` through osascript's password dialog (hosts); the CA goes in the login keychain as the user. Linux: `ps/setup-elevated.sh` through pkexec (hosts + the system store); browsers read `~/.pki/nssdb`, which needs `certutil` (libnss3-tools). Declined, the CA is trusted per user where possible and Zeff is served on `https://127.0.0.1:1337`.
- `main.js` has the tray (open, start / stop / restart, logs, data folder, "Start at log in", setup, quit) and the status window (`status.html`). "Start at log in" (`lib/autostart.js`) is a per-user scheduled task on log on + unlock on Windows (Fast Startup skips log on), a LaunchAgent on macOS, an XDG autostart entry on Linux — where the launcher also puts itself in the applications menu.

The launcher finds Zeff in `app/` of the bundle (next to `Zeff.exe` and `./zeff`; in `Zeff.app/Contents/Resources/zeff`) or in the checkout it sits in. Options go in `zeff-launcher.json` (see `lib/config.js`) — next to the exe, in the data folder, or `--config <file>`. Data, state and logs are in `<data>`, `<data>/launcher` and `<data>/logs`: `<app>/data` in a checkout and the Windows bundle; `~/Library/Application Support/Zeff` and `~/.local/share/zeff` in the macOS and Linux bundles (Zeff.app may run read-only, and an update replaces the folder). The servers then get `DATABASE_PATH`, `ZEFF_CALENDAR_INBOX` and `KNOWLEDGE_DATA_DIR` pointing there, and `<data>/.env` is read for settings like `JIRA_URL`.

```
npm run launcher:start      # from the checkout (Node from PATH): npm --prefix launcher start
npm run dist -- --zip       # the bundle for this system in dist/Zeff (+ Zeff.zip / .tar.gz)
npm run launcher:build      # refresh only the launcher in an existing bundle
npm run release             # a release from HEAD: dist/release/Zeff-<version>-<os>-<arch>.zip|.tar.gz
npm run release:check -- <archive>   # unpack it, start it with --smoke-test
```

Flags: `--background` (tray only, no browser), `--no-setup` (no hosts/certificate prompt), `--config <file>`, `--smoke-test` (start everything on its own Electron profile, check Zeff and the knowledge server answer over https against Zeff's CA, quit; exit code 0 = ok).

Releases for all three systems come from `.github/workflows/release.yml` (a tag `v*`): native modules (better-sqlite3) and the macOS bundle can only be built on their own system.
