import fs from "node:fs";
import path from "node:path";
import { dataDir, migrateLegacyDataDir } from "../../../scripts/lib/data-dir.mjs";

export { dataDir };

export function dbPath(): string {
  return path.join(dataDir(), "webui.db");
}

export function ensureDataDir(): void {
  migrateLegacyDataDir();
  fs.mkdirSync(dataDir(), { recursive: true });
}
