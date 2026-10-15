import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/db";

/** Where a page's pictures are kept (this account's data folder). Server only. */
export const filesDir = (): string => {
  const dir = path.join(dataDir(), "workspace-files");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
