import { cookies } from "next/headers";
import { parseUiOpen, UI_OPEN_COOKIE, type UiOpenState } from "./ui-state-shared";

/** This request's remembered open/closed sections (server components; see ui-state-shared). */
export async function getUiOpen(): Promise<UiOpenState> {
  return parseUiOpen((await cookies()).get(UI_OPEN_COOKIE)?.value);
}
