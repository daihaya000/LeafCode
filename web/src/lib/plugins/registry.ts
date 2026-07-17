import {
  CODEXBAR_PLUGIN_ID,
  CodexBarWidget,
} from "@/components/plugins/codexbar/CodexBarWidget";
import type { WebUIPlugin } from "./types";

/** All registered WebUI plugins. Add new plugins here. */
export const PLUGINS: WebUIPlugin[] = [
  {
    id: CODEXBAR_PLUGIN_ID,
    name: "CodexBar 利用状況",
    description:
      "CodexBar のスナップショット（%APPDATA%\\CodexBar\\usage-snapshot.json）を読み、各サービスの使用率を右下に表示します。",
    defaultEnabled: true,
    Widget: CodexBarWidget,
  },
];
