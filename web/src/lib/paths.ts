import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../../../scripts/lib/data-dir.mjs";

export { dataDir };

export function dbPath(): string {
  return path.join(dataDir(), "webui.db");
}

export function ensureDataDir(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
}
