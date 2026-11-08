// The companion's WebRTC end on the PC: phones connect without any signaling server.
//
// How (the same trick as libp2p's "WebRTC Direct"): the pairing QR code carries this PC's LAN address,
// the UDP port and the certificate's fingerprint. From that alone the phone writes our answer itself
// (no answer has to travel back), using a random ICE username fragment as both its ufrag and its
// password (it rewrites its own offer to match). Its first STUN check arrives on our one UDP port; the
// port mux hands us the unknown ufrag, and we build the phone's offer from it in turn — same ufrag and
// password, its address learned from the check. We don't check the phone's certificate (we can't know
// it beforehand); the phone proves itself on the data channel instead: an HMAC of our challenge with the
// device secret the QR code gave it. The phone does check ours (the fingerprint), so nobody in between
// can read along.
//
// Messages are JSON on one negotiated data channel (id 0); long ones are cut into parts.
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

/** The ufrag phones of this protocol use (ICE allows [A-Za-z0-9+/]), and how long the random part is. */
const UFRAG_PREFIX = "zeff1";
const PART = 60 * 1024;
const MAX_MESSAGE = 256 * 1024;

const FAKE_FINGERPRINT = Array.from({ length: 32 }, () => "00").join(":");

/** The phone's offer as we must see it: its ufrag doubles as its password; it's the DTLS client (setup:active). */
function phoneOffer(ufrag, host, port) {
  const ip = host.includes(":") ? "IP6" : "IP4";
  return [
    "v=0",
    `o=- 0 0 IN ${ip} ${host}`,
    "s=-",
    `c=IN ${ip} ${host}`,
    "t=0 0",
    "a=group:BUNDLE 0",
    `m=application ${port} UDP/DTLS/SCTP webrtc-datachannel`,
    "a=mid:0",
    "a=setup:active",
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${ufrag}`,
    `a=fingerprint:sha-256 ${FAKE_FINGERPRINT}`,
    "a=sctp-port:5000",
    `a=max-message-size:${MAX_MESSAGE}`,
    `a=candidate:1 1 UDP 2130706431 ${host} ${port} typ host`,
    "a=end-of-candidates",
    "",
  ].join("\r\n");
}

/** A message → the strings to send (one, or its parts). */
function frames(msg) {
  const text = JSON.stringify(msg);
  if (text.length <= PART) return [text];
  const id = crypto.randomBytes(6).toString("hex");
  const n = Math.ceil(text.length / PART);
  return Array.from({ length: n }, (_, i) => JSON.stringify({ t: "part", id, i, n, d: text.slice(i * PART, (i + 1) * PART) }));
}

/** Reassembles parts; `push(text)` → the whole message, or null while parts are missing. */
function assembler() {
  const open = new Map();
  return (text) => {
    const msg = JSON.parse(text);
    if (msg.t !== "part") return msg;
    const parts = open.get(msg.id) ?? [];
    parts[msg.i] = msg.d;
    open.set(msg.id, parts);
    if (parts.filter((p) => p !== undefined).length < msg.n) return null;
    open.delete(msg.id);
    return JSON.parse(parts.join(""));
  };
}

/**
 * One connected phone, once it proved itself: `send(msg)`, `close()`; events "message" (msg) and "close".
 * `device` is the paired device's id.
 */
class Session extends EventEmitter {
  constructor(pc, dc, device, remote) {
    super();
    this.pc = pc;
    this.dc = dc;
    this.device = device;
    this.remote = remote;
    this.open = true;
  }
  send(msg) {
    if (!this.open) return false;
    try {
      for (const f of frames(msg)) this.dc.sendMessage(f);
      return true;
    } catch {
      return false;
    }
  }
  close() {
    if (!this.open) return;
    this.open = false;
    try {
      this.dc.close();
    } catch {}
    try {
      this.pc.close();
    } catch {}
    this.emit("close");
  }
}

/**
 * Listens on `port` (UDP, all interfaces) for phones. `secretOf(device)` → the device's secret (Buffer), or
 * null for an unknown one. Emits "session" (Session) for each phone that proved itself, "error" (Error).
 * `ndc` is node-datachannel (passed in: the launcher loads it from its own folder).
 */
class CompanionHost extends EventEmitter {
  constructor({ ndc, port, cert, secretOf, log = () => {} }) {
    super();
    this.ndc = ndc;
    this.port = port;
    this.cert = cert;
    this.secretOf = secretOf;
    this.log = log;
    this.pending = new Map(); // ufrag → peer connection still shaking hands
  }

  start() {
    this.listener = new this.ndc.IceUdpMuxListener(this.port);
    this.listener.onUnhandledStunRequest((req) => {
      try {
        this.accept(req);
      } catch (err) {
        this.log(`companion: a phone's connection failed: ${err.message}`);
      }
    });
    this.log(`companion: listening on UDP ${this.port}`);
  }

  stop() {
    for (const pc of this.pending.values()) {
      try {
        pc.close();
      } catch {}
    }
    this.pending.clear();
    try {
      this.listener?.stop();
    } catch {}
    this.listener = null;
  }

  accept({ ufrag, host, port }) {
    if (!ufrag.startsWith(UFRAG_PREFIX) || this.pending.has(ufrag)) return;
    if (this.pending.size > 16) return; // a burst of strangers: don't open connections for all of them
    const pc = new this.ndc.PeerConnection(`companion-${ufrag.slice(-6)}`, {
      iceServers: [],
      enableIceUdpMux: true,
      portRangeBegin: this.port,
      portRangeEnd: this.port,
      disableFingerprintVerification: true,
      disableAutoNegotiation: true,
      certificatePemFile: this.cert.certFile,
      keyPemFile: this.cert.keyFile,
      maxMessageSize: MAX_MESSAGE,
    });
    this.pending.set(ufrag, pc);
    const drop = () => {
      if (this.pending.get(ufrag) === pc) this.pending.delete(ufrag);
    };
    // A handshake that doesn't finish in time is given up.
    const giveUp = setTimeout(() => {
      if (this.pending.get(ufrag) === pc) {
        drop();
        try {
          pc.close();
        } catch {}
      }
    }, 20000);
    giveUp.unref?.();
    pc.onStateChange((s) => {
      if (s === "failed" || s === "closed") {
        drop();
        clearTimeout(giveUp);
      }
    });
    const dc = pc.createDataChannel("zeff", { negotiated: true, id: 0 });
    pc.setRemoteDescription(phoneOffer(ufrag, host, port), "offer");
    pc.setLocalDescription("answer", { iceUfrag: ufrag, icePwd: ufrag });

    const nonce = crypto.randomBytes(32).toString("base64");
    const read = assembler();
    let session = null;
    dc.onOpen(() => {
      clearTimeout(giveUp);
      try {
        dc.sendMessage(JSON.stringify({ t: "hello", nonce, v: 1 }));
      } catch {}
    });
    dc.onMessage((data) => {
      let msg;
      try {
        msg = read(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
      } catch {
        return;
      }
      if (!msg) return;
      if (session) return session.emit("message", msg);
      if (msg.t !== "auth" || typeof msg.device !== "string" || typeof msg.mac !== "string") return;
      const secret = this.secretOf(msg.device);
      const want = secret && crypto.createHmac("sha256", secret).update(`${nonce}|${ufrag}`).digest();
      const got = Buffer.from(msg.mac, "base64");
      if (!want || got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
        try {
          dc.sendMessage(JSON.stringify({ t: "denied" }));
        } catch {}
        setTimeout(() => pc.close(), 200);
        drop();
        this.log(`companion: a phone at ${host} was turned away (unknown device or wrong secret)`);
        return;
      }
      drop();
      session = new Session(pc, dc, msg.device, `${host}:${port}`);
      dc.onClosed(() => session.close());
      pc.onStateChange((s) => {
        if (s === "disconnected" || s === "failed" || s === "closed") session.close();
      });
      session.send({ t: "welcome" });
      this.emit("session", session);
    });
  }
}

module.exports = { CompanionHost, UFRAG_PREFIX, frames, assembler, phoneOffer };
