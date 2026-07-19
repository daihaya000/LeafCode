import { codexbarAddon } from "@addons/codexbar";
import type { WebUIAddon } from "./types";

/**
 * All registered WebUI addons.
 * Add new addons under repo-root `addons/<name>/` and register them here.
 */
export const ADDONS: WebUIAddon[] = [codexbarAddon];
