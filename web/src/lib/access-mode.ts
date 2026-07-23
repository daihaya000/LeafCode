export type AccessMode = "ask" | "full";

const STORAGE_KEY = "webui:access-mode";

export const ACCESS_MODE_OPTIONS: {
  value: AccessMode;
  label: string;
  title: string;
}[] = [
  {
    value: "ask",
    label: "確認する",
    title: "権限が必要な操作は毎回承認を求めます",
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
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "full" || raw === "ask") return raw;
  } catch {
    /* ignore */
  }
  return "ask";
}

export function writeAccessMode(mode: AccessMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(
      new CustomEvent("webui:access-mode", { detail: mode }),
    );
  } catch {
    /* ignore */
  }
}
