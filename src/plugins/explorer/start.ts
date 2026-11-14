/** What an Explorer page starts with — read on the server with the page, so nothing waits for a round trip. Server only. */
import { currentAccountId } from "@/db/accounts";
import { errorMessage } from "@/lib/errors";
import { canOpenHere, listDir, places } from "./files";
import { lastPath, placesInTree } from "./pages";
import type { Listing, Places } from "./shared";
import { liveFolders } from "./watch";

export type ExplorerStart = { listing: Listing; places: Places; canOpen: boolean; live: string[]; error: string | null; /** Its places are in the Workspace tree (not beside the files). */ inTree: boolean };

export async function explorerStart(pageId: number): Promise<ExplorerStart> {
  const at = lastPath(pageId);
  let listing: Listing;
  let error: string | null = null;
  try {
    listing = listDir(at);
  } catch (e) {
    // The folder it was in is gone (a drive pulled out): This PC, and why.
    error = errorMessage(e);
    listing = listDir(null);
  }
  return { listing, places: places(), canOpen: canOpenHere(), live: liveFolders(currentAccountId()), error, inTree: placesInTree(pageId) };
}
