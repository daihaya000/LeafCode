export type AccessMode = "ask" | "full";

export const ACCESS_MODE_STORAGE_KEY = "webui:access-mode";
export const ACCESS_MODE_EVENT = "webui:access-mode";

export const ACCESS_MODE_OPTIONS: {
  value: AccessMode;
  label: string;
  title: string;
}[] = [
  {
    value: "ask",
    label: "確認する",
    title:
      "ファイル書き込み（edit / write / apply_patch）は毎回承認を求めます。" +
      "bash などは LeafCode の設定に従います",
  },
  {
    value: "full",
    label: "フルアクセス",
    title: "すべての権限要求を自動承認します（危険）",
  },
];

export function readAccessMode(): AccessMode {
  if (typeof window === "undefined") return "ask";
  try {
    const raw = localStorage.getItem(ACCESS_MODE_STORAGE_KEY);
    if (raw === "full" || raw === "ask") return raw;
  } catch {
    /* ignore */
  }
  return "ask";
}

export function writeAccessMode(mode: AccessMode): void {
  try {
    localStorage.setItem(ACCESS_MODE_STORAGE_KEY, mode);
    window.dispatchEvent(
      new CustomEvent(ACCESS_MODE_EVENT, { detail: mode }),
    );
  } catch {
    /* ignore */
  }
}
