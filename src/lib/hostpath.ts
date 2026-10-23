/**
 * In a container, the host's folders sit elsewhere (a bind mount): the repos you gave Zeff on Windows —
 * C:\Users\me\Documents\ACME\repo — are /host/documents/ACME/repo in there. ZEFF_PATH_MAP says how:
 *
 *   ZEFF_PATH_MAP="C:\Users\me\Documents=/host/documents;D:\Work=/host/work"
 *
 * Zeff keeps the host's paths (so the data folder works on both sides) and maps them where a folder is used. Server only.
 */
export type PathMap = { host: string; local: string }[];

/** A drive letter (C:) or a network share (\\server) on the host's side, an absolute path on the container's. */
const validPair = (p: { host: string; local: string }) => /^[A-Za-z]:|^\\\\/.test(p.host) && p.local.startsWith("/");

export function parsePathMap(text: string | undefined): PathMap {
  return String(text ?? "")
    .split(";")
    .map((entry) => {
      const i = entry.indexOf("=");
      return { host: entry.slice(0, i).trim().replace(/[\\/]+$/, ""), local: entry.slice(i + 1).trim().replace(/\/+$/, "") };
    })
    .filter((p) => p.host && p.local && validPair(p));
}

export const pathMap = (): PathMap => parsePathMap(process.env.ZEFF_PATH_MAP);

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** The path as the container uses it: a host path under a mapped folder becomes the mounted one; any other is as it is. */
export function toLocalPath(p: string, map: PathMap = pathMap()): string {
  const n = norm(p);
  for (const m of map) {
    const h = norm(m.host);
    if (n.toLowerCase() === h.toLowerCase()) return m.local;
    if (n.toLowerCase().startsWith(`${h.toLowerCase()}/`)) return `${m.local}${n.slice(h.length)}`;
  }
  return p;
}

/** The path as Zeff keeps it (the host's): a mounted path becomes the host's, written the Windows way; any other is as it is. */
export function toHostPath(p: string, map: PathMap = pathMap()): string {
  const n = norm(p);
  for (const m of map) {
    if (n === m.local) return m.host;
    if (n.startsWith(`${m.local}/`)) return `${m.host}${n.slice(m.local.length).replace(/\//g, "\\")}`;
  }
  return p;
}
