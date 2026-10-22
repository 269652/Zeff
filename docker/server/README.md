# Zeff on a server

Zeff on a Linux server, reachable from anywhere over HTTPS, with WhatsApp and Signal still on your own computer.

```
your computer                                         server (Docker, host network)
┌───────────────────────────────┐                     ┌─────────────────────────────────────────────┐
│ WhatsApp Web (automation       │                     │ Caddy :443 ── x-zeff-edge ──► Zeff 127.0.0.1 │
│   Chrome) · Signal Desktop     │                     │   (Let's Encrypt)            :9333 web       │
│ remote-bridge.mjs 127.0.0.1    │◄── ssh -R tunnel ───│                              :9336 sync      │
│   (chrome-bridge, token)       │   (bridge user:     │ 127.0.0.1:9230/10xxx ◄─────  :9334 work      │
└───────────────────────────────┘    forwarding only) │ knowledge 127.0.0.1:9556 (an account's)      │
                                                      └─────────────────────────────────────────────┘
```

- **The gate** (`src/lib/gate.ts`, `ZEFF_GATE=1`): every request Caddy passes on needs the password's session cookie (30 days) or a
  token (`Authorization: Bearer …`) — pages, Server Actions, the API, MCP alike. No `data/gate.json`: nothing gets in.
  Requests that do not come through Caddy (the services inside talking to each other) pass; Zeff listens on 127.0.0.1 only.
- **The bridge** (`scripts/remote-bridge.mjs`, on your computer): the browser bridge on 127.0.0.1 and an SSH tunnel that makes its
  ports listen on the server's 127.0.0.1. The server's SSH user for it may forward exactly those ports and nothing else.

## Set it up

On the server (`/srv/zeff` a volume of its own, Docker installed):

1. The image, built on a computer with enough memory (the build peaks near 12 GB), from a clean checkout:
   ```
   git archive HEAD | tar -x -C <dir> && docker build -t zeff-app:local -f <dir>/docker/app/Dockerfile <dir>
   docker save zeff-app:local | gzip | ssh <server> 'gunzip | docker load'
   ```
2. `docker/server/Caddyfile` and `up.sh` to `/srv/zeff/`; your computer's bridge token (`data/docker/bridge.json` → `token`) to
   `/srv/zeff/bridge-token`.
3. The data: `/srv/zeff/data/` — `accounts.json` with the accounts the server has, `accounts/<id>/` each (its database, documents,
   knowledge). Owned by uid 1000 (the containers' user).
4. A password: `docker run --rm -i -v /srv/zeff/data:/app/data zeff-app:local node scripts/gate.mjs password` (type it, Enter, Ctrl-D).
   Tokens: `… node scripts/gate.mjs token <name>`.
5. `ZEFF_DOMAIN=<name> KNOWLEDGE="privat:9556" sh /srv/zeff/up.sh`. Without a domain of your own: `<ip with dashes>.sslip.io`
   (e.g. `56-228-13-109.sslip.io`) — a real name for the IP, so Let's Encrypt can certify it. The firewall (security group) open on
   443 (and 80, for the redirect).
6. The AI CLIs' sign-in: `docker exec -it zeff-stack claude` (once; kept in the volume `zeff-claude-home`).

## The bridge

On the server, a user that may only forward the bridge's ports:

```
sudo useradd -m -s /sbin/nologin zeff-bridge
# ~zeff-bridge/.ssh/authorized_keys, one line:
restrict,port-forwarding,permitlisten="127.0.0.1:9230",permitlisten="127.0.0.1:10222",permitlisten="127.0.0.1:10231",permitlisten="127.0.0.1:10339",command="/bin/false" ssh-ed25519 AAAA… zeff-bridge
```

On your computer, `data/remote.json` — `{ "host": "<server>", "user": "zeff-bridge", "key": "<path of the private key>" }` — and
`node scripts/remote-bridge.mjs` (keep it running; the tunnel is built again when it drops). The ports: the bridge's control port 9230 and
each debug port + 1000 (9222 → 10222 the first account's browser, the other accounts' from 9231 up, Signal's 9339 → 10339).
