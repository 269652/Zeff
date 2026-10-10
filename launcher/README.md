# Zeff launcher

An Electron app (the unmodified `electron.exe`, shipped as `Zeff.exe`). It runs Zeff's two Next servers on the bundled `node.exe` and serves them over HTTPS:

| Address | Goes to |
| --- | --- |
| `https://zeff`, `https://zeff:1337` | Zeff, `127.0.0.1:9333` |
| `https://knowledge.zeff` | the knowledge server of the account you're in — one per account: `127.0.0.1:9555` (the first), `:9556` … (the others) |
| `http://zeff` | redirects to https |

- `lib/supervisor.js` runs `node next start [knowledge] -H 127.0.0.1 -p <port>` and restarts it after a crash (2 s … 60 s backoff). A port that's already held, for example by the old `Zeff Server` scheduled task, is shown as "not started by the launcher" and proxied as is. Servers a killed launcher left behind are cleaned up on the next start (`data/launcher/pids.json`).
- `lib/proxy.js` terminates TLS on 127.0.0.1 and routes by Host. It keeps the `Host` header and sets `X-Forwarded-Proto/Host/For`, so Next builds https URLs and Server Actions accept the origin. It rewrites `Location: http(s)://localhost:9333/…` back to the browser's address, because Next builds `request.url` from its bind address. Streams pass through and WebSocket upgrades are tunnelled.
- `lib/tls.js` + `ps/new-cert.ps1` make the certificate with Windows' own crypto. A "Zeff Local CA" signs a certificate for `zeff`, `knowledge.zeff`, their `.localhost` twins, `localhost` and `127.0.0.1`, and then its private key is deleted. The files are in `data/launcher/tls/`.
- `lib/setup.js` + `ps/setup-elevated.ps1` do the one part that needs admin rights, behind a UAC prompt: the hosts entry and trusting the CA machine-wide. If that's declined, the CA is trusted per user instead and Zeff is served on `https://zeff.localhost`.
- `main.js` has the tray (open, start / stop / restart, logs, data folder, "Start with Windows", setup, quit) and the status window (`status.html`). "Start with Windows" is a per-user scheduled task on log on + unlock (`lib/autostart.js`), because Fast Startup skips log on.

The launcher finds Zeff in `app\` next to the exe (the bundle) or in the checkout it sits in. Options go in `zeff-launcher.json` next to the exe (see `lib/config.js`), or `--config <file>`. State and logs are in `<app>/data/launcher` and `<app>/data/logs`.

```
npm run launcher:start      # from the checkout (Node from PATH): npm --prefix launcher start
npm run dist -- --zip       # dist/Zeff (+ Zeff.zip): Zeff.exe, runtime/node.exe, app/
npm run launcher:build      # refresh only the launcher in an existing dist/Zeff
```

Flags: `--background` (tray only, no browser), `--no-setup` (no hosts/certificate prompt), `--config <file>`.
