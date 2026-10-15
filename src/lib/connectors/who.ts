/** Who a provider's sign-in is for — one read of the user, to test the sign-in and to show it. Server only. */
import { apiGet } from "./http";
import type { Provider } from "./store";

export async function whoAmI(provider: Provider): Promise<string> {
  if (provider === "gitlab") return (await (await import("@/lib/gitlab/api")).whoAmI()).username;
  if (provider === "google") return String((await apiGet<{ email?: string }>("google", "/oauth2/v2/userinfo")).email ?? "");
  const me = await apiGet<{ userPrincipalName?: string; mail?: string }>("microsoft", "/me?$select=userPrincipalName,mail");
  return String(me.mail || me.userPrincipalName || "");
}
