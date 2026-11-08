# Zeff companion — your todos on the phone

A small web app (`app/`, served at **https://app.getzeff.com**) that shows your Zeff todos on the phone and lets you
tick them off, flag them and add notes. It talks **straight to Zeff on your PC over WebRTC** — no server in between,
not even for setting up the connection.

- **At home (same Wi-Fi):** live. A tick on the phone is done in Zeff within a fraction of a second; a change in
  Zeff shows on the phone at once.
- **Away:** the phone keeps your todos and queues what you tick. Back on the Wi-Fi, the queue goes to the PC —
  each change once, in the order you made it.
- **Offline:** the app itself is cached by a service worker, so it opens without any network.

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
answer itself from the QR code: the PC's address, port and fingerprint are known, and the ICE username fragment
and password are the same random string, chosen by the phone and written into its own offer. The PC
(`launcher/lib/companion/host.js`, libdatachannel via `node-datachannel`) listens on one UDP port, reads the
fragment from the phone's first STUN check, and builds the phone's offer from it. libp2p's "WebRTC Direct" connects
the same way.

- The **phone checks the PC** (DTLS fingerprint from the QR code).
- The **PC checks the phone** on the data channel: an HMAC of the PC's challenge (bound to this connection's
  fragment) with the device secret.
- No STUN or TURN server is used. That's why it works only where the phone can reach the PC directly: the same
  Wi-Fi, or a VPN such as Tailscale on both.

## The protocol (JSON on data channel 0)

| from | message |
| --- | --- |
| PC | `hello {nonce}` → phone `auth {device, mac}` → PC `welcome` or `denied` |
| phone | `sync` → PC `snapshot {at, todos}` (also pushed on every todo change in Zeff) |
| phone | `ops {ops: [{id, at, kind: status\|flag\|note, todoId, …}]}` → PC `applied {results}` |

Messages over 60 KB are sent in parts (`part {id, i, n, d}`). On the PC side the launcher passes them to Zeff's
`/api/companion` (`src/lib/companion.ts`), which remembers the ids it applied.

## Checking it

```sh
npm run test:server                       # a disposable Zeff; note url and dataDir
node companion/check.cjs <url> <dataDir>  # pairing, live both ways, away + queue, offline start, unpairing
npm run test:server -- --stop <port>
```

## Publishing the app

`app/` is static: any HTTPS host will do (WebRTC and the service worker need HTTPS). For app.getzeff.com on GitHub
Pages: a repository with the contents of `app/` and a `CNAME` file containing `app.getzeff.com`, plus a DNS
`CNAME` record `app → <owner>.github.io`. Pairing links use the launcher's `companionApp` setting
(`zeff-launcher.json`; default `https://app.getzeff.com/`).

## Known limits

- **Same network only** (or a VPN): no STUN or TURN server on purpose.
- **Windows firewall:** the first time, Windows asks whether Zeff may use private networks. Allow it, or phones
  can't connect.
- **iPhone (Safari):** not tested yet. The trick depends on the browser accepting the rewritten ICE password; Chrome
  and Firefox do.
- **One account:** the companion shows the default Zeff account's todos.
