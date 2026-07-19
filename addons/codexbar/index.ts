import type { WebUIAddon } from "@/lib/addons/types";
import { CodexBarWidget, CODEXBAR_ADDON_ID } from "./CodexBarWidget";

export { CodexBarWidget, CODEXBAR_ADDON_ID } from "./CodexBarWidget";
export {
  providerIconSrc,
  providerIconSrcForOpencodeId,
  emptyUsage,
  parseCodexBarSnapshot,
  type CodexBarUsage,
  type CodexBarProvider,
} from "./lib/codexbar";
export {
  formatTokens,
  type CodexTokensResult,
} from "./lib/codex-tokens";

/** Registration entry for `web/src/lib/addons/registry.ts`. */
export const codexbarAddon: WebUIAddon = {
  id: CODEXBAR_ADDON_ID,
  name: "CodexBar 利用状況",
  description:
    "CodexBar のスナップショット（%APPDATA%\\CodexBar\\usage-snapshot.json）を読み、各サービスの使用率をサイドバーに表示します。",
  defaultEnabled: true,
  Widget: CodexBarWidget,
};
