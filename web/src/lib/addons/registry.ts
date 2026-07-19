import {
  CODEXBAR_ADDON_ID,
  CodexBarWidget,
} from "@/components/addons/codexbar/CodexBarWidget";
import type { WebUIAddon } from "./types";

/** All registered WebUI addons. Add new addons here. */
export const ADDONS: WebUIAddon[] = [
  {
    id: CODEXBAR_ADDON_ID,
    name: "CodexBar 利用状況",
    description:
      "CodexBar のスナップショット（%APPDATA%\\CodexBar\\usage-snapshot.json）を読み、各サービスの使用率をサイドバーに表示します。",
    defaultEnabled: true,
    Widget: CodexBarWidget,
  },
];
