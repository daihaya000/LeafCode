/**
 * Custom theme (設定 → 全般 → テーマ) storage.
 *
 * The custom theme is a full set of CSS custom-property tokens edited in the
 * Settings UI. Values persist to localStorage and are re-applied by
 * `ThemeTokenSync` on reload (no rebuild needed), or immediately when the
 * `CUSTOM_THEME_CHANGED_EVENT` fires.
 *
 * The defaults mirror `web/themes/oyster.json` at build time; editing that
 * JSON later does not rewrite already-saved custom themes (the user's
 * overrides win).
 */

export const CUSTOM_THEME_STORAGE_KEY = "webui.custom_theme.tokens";
export const CUSTOM_THEME_CHANGED_EVENT = "webui:custom-theme-changed";

/** Editable parts, in display order, with their Japanese labels. */
export const CUSTOM_THEME_PARTS: { key: string; label: string }[] = [
  { key: "--bg", label: "背景" },
  { key: "--surface", label: "サーフェス" },
  { key: "--surface-2", label: "サーフェス（濃）" },
  { key: "--surface-3", label: "サーフェス（最濃）" },
  { key: "--border", label: "ボーダー" },
  { key: "--border-strong", label: "ボーダー（強）" },
  { key: "--text", label: "テキスト" },
  { key: "--muted", label: "弱めテキスト" },
  { key: "--faint", label: "控えめテキスト" },
  { key: "--accent", label: "アクセント" },
];

/** Default tokens, same values as `web/themes/oyster.json` (build-time copy). */
export const CUSTOM_THEME_DEFAULT_TOKENS: Record<string, string> = {
  "--bg": "#fdfbf7",
  "--surface": "#fbf8f2",
  "--surface-2": "#f2eee5",
  "--surface-3": "#ebe5d9",
  "--border": "#e4ddd0",
  "--border-strong": "#d0c8b8",
  "--text": "#1e1b16",
  "--muted": "#6f685c",
  "--faint": "#9b9283",
  "--accent": "#2563eb",
};

const TOKEN_KEY_RE = /^--[a-z0-9-]+$/;

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(value);
}

/** Saved custom tokens, or null when the user never customized them. */
export function readCustomThemeTokens(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const tokens: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (
        TOKEN_KEY_RE.test(key) &&
        typeof value === "string" &&
        isHexColor(value)
      ) {
        tokens[key] = value;
      }
    }
    return Object.keys(tokens).length > 0 ? tokens : null;
  } catch {
    return null;
  }
}

/** Overlay the saved custom tokens onto the defaults (defaults for missing parts). */
export function resolveCustomThemeTokens(): Record<string, string> {
  return {
    ...CUSTOM_THEME_DEFAULT_TOKENS,
    ...readCustomThemeTokens(),
  };
}

export function writeCustomThemeTokens(tokens: Record<string, string>) {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (TOKEN_KEY_RE.test(key) && typeof value === "string" && isHexColor(value)) {
      clean[key] = value.toLowerCase();
    }
  }
  try {
    localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* ignore quota/private-mode failures */
  }
}

export function clearCustomThemeTokens() {
  try {
    localStorage.removeItem(CUSTOM_THEME_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Notify `ThemeTokenSync` (and other listeners) that custom tokens changed. */
export function dispatchCustomThemeChanged() {
  window.dispatchEvent(new CustomEvent(CUSTOM_THEME_CHANGED_EVENT));
}
