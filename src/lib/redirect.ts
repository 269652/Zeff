import { redirect as nextRedirect } from "next/navigation";
import { requestPrefix } from "@/db/accounts";
import { withPrefix } from "@/lib/account-routes";

/**
 * next/navigation's redirect under the request's account route: "/workspace" asked on a "/privat/…" page goes to
 * "/privat/workspace" — a page load follows the redirect without the browser's script (account-nav-script), so it must say so.
 */
export function redirect(path: string, type?: Parameters<typeof nextRedirect>[1]): never {
  return nextRedirect(withPrefix(requestPrefix(), path), type);
}

/** A URL to redirect to from a route handler, under the request's account route (`base`: the request's URL). */
export const prefixedUrl = (path: string, base: string): URL => new URL(withPrefix(requestPrefix(), path), base);
