import crypto from "node:crypto";
import http from "node:http";

/**
 * A stand-in for Google — the OAuth token endpoint and the slice of Drive v3 that Zeff uses
 * (folders, listing, resumable uploads, downloads, exports, deletes) — so the Google Drive plugin
 * is tested without Google, a network or an account.
 */
export type FakeFile = { id: string; name: string; mimeType: string; parents: string[]; data: Buffer; trashed: boolean; modifiedTime: string };

export type FakeGoogle = {
  url: string;
  files: Map<string, FakeFile>;
  /** The access token Drive accepts now; any other one is a 401 (as when it ran out). */
  state: { valid: string; tokens: number; invalidGrant: boolean; scope: string; failChunkOnce: boolean; requests: string[]; tokenRequests: URLSearchParams[] };
  /** Put a file in a folder as a person would in Drive's web page (Zeff didn't make it). */
  addByHand(name: string, parent: string, data: Buffer, mimeType?: string): FakeFile;
  /** Change a file's content in place (an edit in Drive). */
  edit(id: string, data: Buffer): void;
  /** Make the current access token run out. */
  expireToken(): void;
  childrenOf(id: string): FakeFile[];
  close(): Promise<void>;
};

const md5 = (b: Buffer) => crypto.createHash("md5").update(b).digest("hex");
const FOLDER = "application/vnd.google-apps.folder";

export async function startFakeGoogle(port = 0): Promise<FakeGoogle> {
  const files = new Map<string, FakeFile>();
  const uploads = new Map<string, { meta: { name: string; parents?: string[] }; mime: string; size: number; data: Buffer }>();
  let seq = 0;
  let failedOnce = false;
  const state: FakeGoogle["state"] = { valid: "at-0", tokens: 0, invalidGrant: false, scope: "openid email https://www.googleapis.com/auth/drive.file", failChunkOnce: false, requests: [], tokenRequests: [] };
  const meta = (f: FakeFile) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: String(f.data.length), md5Checksum: f.mimeType.startsWith("application/vnd.google-apps.") ? undefined : md5(f.data), modifiedTime: f.modifiedTime });
  const make = (name: string, parents: string[], data: Buffer, mimeType: string): FakeFile => {
    const f: FakeFile = { id: `id${++seq}`, name, mimeType, parents, data, trashed: false, modifiedTime: new Date(Date.now() + seq * 1000).toISOString() };
    files.set(f.id, f);
    return f;
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const u = new URL(req.url ?? "/", "http://x");
      const send = (status: number, payload?: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(payload === undefined ? undefined : JSON.stringify(payload));
      };
      state.requests.push(`${req.method} ${u.pathname}`);

      // The sign-in page: no questions asked, straight back with a code (what you'd get after clicking "Allow").
      if (u.pathname === "/auth") {
        const back = new URL(u.searchParams.get("redirect_uri") ?? "");
        back.searchParams.set("code", "fake-code");
        back.searchParams.set("state", u.searchParams.get("state") ?? "");
        state.scope = u.searchParams.get("scope") ?? state.scope;
        res.writeHead(302, { location: back.toString() });
        return void res.end();
      }

      if (u.pathname === "/token") {
        const form = new URLSearchParams(body.toString());
        state.tokenRequests.push(form);
        if (state.invalidGrant) return send(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        state.valid = `at-${++state.tokens}`;
        const idToken = `x.${Buffer.from(JSON.stringify({ email: "me@example.com" })).toString("base64url")}.y`;
        if (form.get("grant_type") === "authorization_code") return send(200, { access_token: state.valid, refresh_token: "rt-1", expires_in: 3600, scope: state.scope, id_token: idToken });
        return send(200, { access_token: state.valid, expires_in: 3600, scope: state.scope });
      }

      // Everything else needs the current token (a session URI of an upload does too, here).
      if (req.headers.authorization !== `Bearer ${state.valid}`) return send(401, { error: { message: "Invalid Credentials", code: 401 } });

      if (u.pathname.startsWith("/upload/session/")) {
        const up = uploads.get(u.pathname.split("/").pop()!);
        if (!up) return send(404, { error: { message: "no such upload" } });
        if (state.failChunkOnce && !failedOnce && body.length) {
          failedOnce = true;
          return send(503, { error: { message: "Backend Error" } });
        }
        const range = /^bytes (?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(String(req.headers["content-range"] ?? ""));
        if (!range) return send(400, { error: { message: "bad Content-Range" } });
        if (range[1] !== undefined) {
          const from = Number(range[1]);
          if (from !== up.data.length) return send(400, { error: { message: `chunk at ${from}, have ${up.data.length}` } });
          up.data = Buffer.concat([up.data, body]);
        }
        if (up.data.length >= up.size) {
          const f = make(up.meta.name, up.meta.parents ?? ["root"], up.data, up.mime);
          uploads.delete(u.pathname.split("/").pop()!);
          return send(200, meta(f));
        }
        return send(308, undefined, up.data.length ? { range: `bytes=0-${up.data.length - 1}` } : {});
      }

      if (u.pathname === "/upload/drive/v3/files" && req.method === "POST") {
        const id = `s${++seq}`;
        uploads.set(id, { meta: JSON.parse(body.toString()), mime: String(req.headers["x-upload-content-type"] ?? ""), size: Number(req.headers["x-upload-content-length"]), data: Buffer.alloc(0) });
        return send(200, {}, { location: `http://${req.headers.host}/upload/session/${id}` });
      }

      if (u.pathname === "/drive/v3/files" && req.method === "GET") {
        const q = u.searchParams.get("q") ?? "";
        const parent = /'((?:\\.|[^'])+)' in parents/.exec(q)?.[1];
        const name = /name='((?:\\.|[^'])*)'/.exec(q)?.[1]?.replace(/\\(.)/g, "$1");
        const folderOnly = q.includes("mimeType='application/vnd.google-apps.folder'");
        const list = [...files.values()].filter((f) => !f.trashed && (!parent || f.parents.includes(parent)) && (name === undefined || f.name === name) && (!folderOnly || f.mimeType === FOLDER));
        return send(200, { files: list.map(meta) });
      }
      if (u.pathname === "/drive/v3/files" && req.method === "POST") {
        const j = JSON.parse(body.toString()) as { name: string; mimeType: string; parents?: string[] };
        return send(200, meta(make(j.name, j.parents ?? ["root"], Buffer.alloc(0), j.mimeType)));
      }
      const m = /^\/drive\/v3\/files\/([^/]+)(\/export)?$/.exec(u.pathname);
      if (m) {
        const f = files.get(decodeURIComponent(m[1]));
        if (!f) return send(404, { error: { message: "File not found", code: 404 } });
        if (m[2]) {
          res.writeHead(200, { "content-type": "application/octet-stream" });
          return void res.end(Buffer.from(`exported:${u.searchParams.get("mimeType")}:${f.data.toString()}`));
        }
        if (req.method === "DELETE") {
          files.delete(f.id);
          return send(204);
        }
        if (u.searchParams.get("alt") === "media") {
          res.writeHead(200, { "content-type": "application/octet-stream" });
          return void res.end(f.data);
        }
        return send(200, { ...meta(f), trashed: f.trashed });
      }
      send(404, { error: { message: `unhandled ${req.method} ${u.pathname}` } });
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url,
    files,
    state,
    addByHand: (name, parent, data, mimeType = "text/plain") => make(name, [parent], data, mimeType),
    edit: (id, data) => {
      const f = files.get(id)!;
      f.data = data;
      f.modifiedTime = new Date(Date.now() + ++seq * 1000).toISOString();
    },
    expireToken: () => {
      state.valid = `expired-${++state.tokens}`;
    },
    childrenOf: (id) => [...files.values()].filter((f) => f.parents.includes(id) && !f.trashed),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
