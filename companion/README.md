# Zeff companion — your todos on the phone

A small web app (`app/`, served at **https://app.getzeff.com**) that shows your Zeff todos on the phone and lets you
tick them off, flag them and add notes. It talks **straight to Zeff on your PC over WebRTC** — no server in between,
not even for setting up the connection.

- **At home (same Wi-Fi):** live. A tick on the phone is done in Zeff within a fraction of a second; a change in
  Zeff shows on the phone at once.
- **Away:** the phone keeps your todos and queues what you tick. Back on the Wi-Fi, the queue goes to the PC —
  each change once, in the order you made it.
- **Offline:** the app itself is cached by a service worker, so it opens without any network.
- **Accounts:** with several Zeff accounts, a switcher in the header. Each account's todos are kept apart on the phone,
  and every queued change goes to the account it was made in. An account behind Zeff's lock (Settings → Lock) is listed
  with 🔒 but shows nothing, and changes nothing.
- **No Zeff in reach:** with no PC paired, the app explains how to get Zeff: download it from getzeff.com (or send
  the link to your PC), unzip and start it, then pair. When a paired PC doesn't answer, a "Can't reach Zeff on your
  PC?" card says what to check (PC on and Zeff running, same Wi-Fi, firewall, pair again) and repeats the install
  steps. It's open while the phone has never reached Zeff, and folded once it has todos to show.

## All of Zeff, at app.getzeff.com

While the device is connected, app.getzeff.com shows **Zeff itself** in a frame that fills the screen. On a phone,
Zeff's bottom bar shows its two main screens (Todos, Chat) and More (every other page).

- The frame's address is Zeff's own path (app.getzeff.com/todos, /chat …).
- **The service worker** (`app/sw.js`) hands every request of the frame to the app's page.
- **The page** (`app/_zc/app.js`) sends the requests through the WebRTC connection as `http` messages.
- **The launcher** (`launcher/lib/companion/proxy.js`) asks Zeff's server for them like a browser on the PC would,
  and streams the answer back:
  - Origin, Referer and Location are rewritten to Zeff's own address.
  - Sec-Fetch-* is set, so Zeff's lock still guards locked accounts.
  - Cookies are kept by the app's page.
- **Zeff's dev live-reload socket** can't go through the connection. `app/_zc/frame.js`, put first into every Zeff
  page, gives it a quiet stand-in.
- **When the connection drops**, the app shows its own offline view of the todos, with the queue.
- **The launcher's Phone tab** pairs this computer's browser too ("Open on this computer").

The app's own files live under `/_zc/`, so they don't collide with Zeff's paths. GitHub Pages serves `404.html` (a
copy of `index.html`, made by the deploy) for any other address on a first visit.

## The chat

`/chat` (in Zeff) is a live Claude session that works only in Zeff (`src/lib/chat.ts`):

- **Tools:** Zeff's tools, through Zeff's MCP server. No shell and no file editing.
- **Asks first:** what acts outside Zeff (GitLab replies, Gmail changes, archiving, routines, the browser) needs your
  OK on the phone.
- **Clearance:** your own, since it's you asking.
- **Underneath:** a Work session on a todo with source `Zeff-Chat`, kept out of Work's list.

## Pairing

The launcher's status window → **Phone** → **Pair a phone…** shows a QR code. Scan it with the phone's camera and
open the link. The link carries everything the phone needs, after `#` (never sent to any server):

| field | what |
| --- | --- |
| `h` | the PC's LAN addresses (and a VPN's, e.g. Tailscale — then it works away from home too) |
| `p` | the UDP port (`companionPort`, 9341) |
| `f` | the SHA-256 fingerprint of the PC's certificate — the phone trusts only this PC |
| `d`, `s` | the phone's device id and its own secret (unpairing in the launcher revokes it) |

The app stores the pairing and removes it from the address bar.

## How the connection works without a signaling server

WebRTC normally needs a server to pass the offer and answer between the two ends. Here the phone writes the PC's
answer itself from the QR code, since the PC's address, port and fingerprint are known. For the PC's ICE username
fragment it writes `zeff2` + its own ICE password. The PC (`launcher/lib/companion/host.js`, libdatachannel via
`node-datachannel`) listens on one UDP port. The phone's first STUN check carries the username `<PC ufrag>:<phone
ufrag>`, so the PC learns the phone's ufrag and password from it and builds the phone's offer. This is libp2p's
"WebRTC Direct" v2 handshake ([specs#715](https://github.com/libp2p/specs/pull/715)). The phone's offer stays as the
browser made it. The older v1 trick, where the page rewrites its own ICE ufrag and password, fails in Chromium with
`WebRTC-NoSdpMangleUfrag`, which is on its way to Chrome's default. `check.cjs` runs Chrome with that rule switched on.

- The **phone checks the PC** (DTLS fingerprint from the QR code).
- The **PC checks the phone** on the data channel: an HMAC of the PC's challenge (bound to this connection's
  fragment) with the device secret.
- No STUN or TURN server is used. That's why it works only where the phone can reach the PC directly: the same
  Wi-Fi, or a VPN such as Tailscale on both.

## The protocol (JSON on data channel 0)

| from | message |
| --- | --- |
| PC | `hello {nonce}` → phone `auth {device, mac}` → PC `welcome` or `denied` |
| phone | `sync {account?}` → PC `snapshot {at, account, accounts, todos}` or `locked {account, accounts}` (also pushed on every todo change in Zeff) |
| phone | `account {id}` → switch, then `snapshot` or `locked` |
| phone | `ops {account, ops: [{id, at, kind: status\|flag\|note, todoId, …}]}` → PC `applied {account, results}` |

Messages over 60 KB are sent in parts (`part {id, i, n, d}`). On the PC side the launcher passes them to Zeff's
`/api/companion` (`src/lib/companion.ts`) under the account's route (`/<slug>/api/companion`). Zeff remembers the
ids it applied, per account.

## Checking it

```sh
npm run test:server                       # a disposable Zeff; note url and dataDir
node companion/check.cjs <url> <dataDir>  # pairing, live both ways, away + queue, offline start, unpairing
npm run test:server -- --stop <port>
```

## Publishing the app

`app/` is static: any HTTPS host will do (WebRTC and the service worker need HTTPS). `npm run companion:deploy`
puts it on GitHub Pages. On the first run it creates the public repo `269652/zeff-app` (`COMPANION_REPO`) and turns
on Pages with the custom domain `app.getzeff.com` (`COMPANION_DOMAIN`). The domain also needs a DNS record at the
registrar: `CNAME app → 269652.github.io`. Pairing links use the launcher's `companionApp` setting
(`zeff-launcher.json`; default `https://app.getzeff.com/`).

## Known limits

- **Same network only** (or a VPN): no STUN or TURN server on purpose.
- **Windows Firewall:** the Phone tab checks for its own rule (UDP port, private networks only) and offers to add it
  (one UAC prompt). A *block* rule Windows made after a declined prompt still wins over it; remove that one in
  Windows Defender Firewall.
- **iPhone (Safari):** not tested. Playwright's WebKit for Windows has no WebRTC. The v2 handshake rewrites nothing
  in the phone's own offer, which removes the risk the v1 trick carried. It still needs a test on a real iPhone.
