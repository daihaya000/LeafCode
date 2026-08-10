"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cx } from "@/components/ui";
import { getJson, sendJson } from "@/lib/client";

type QwenNativeSettings = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  maxTokens: number;
};

const DEFAULTS: QwenNativeSettings = {
  enabled: false,
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "qwen2.5vl:7b",
  apiKey: "ollama",
  timeoutMs: 120_000,
  maxTokens: 2048,
};

const TIMEOUT_MIN_MS = 10_000;
const TIMEOUT_MAX_MS = 600_000;
const MAX_TOKENS_MIN = 256;
const MAX_TOKENS_MAX = 32_768;

function clampTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULTS.timeoutMs;
  return Math.min(TIMEOUT_MAX_MS, Math.max(TIMEOUT_MIN_MS, Math.round(value)));
}

function clampMaxTokens(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULTS.maxTokens;
  return Math.min(MAX_TOKENS_MAX, Math.max(MAX_TOKENS_MIN, Math.round(value)));
}

export function VisionSettings() {
  const [settings, setSettings] = useState<QwenNativeSettings | null>(null);
  const [draft, setDraft] = useState<QwenNativeSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusAvailable, setStatusAvailable] = useState<boolean | null>(null);
  const mountedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [saved, status] = await Promise.all([
        getJson<QwenNativeSettings>("/api/qwen-native/settings"),
        getJson<{ nativeAvailable: boolean }>("/api/qwen-native/status").catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setSettings(saved);
      setDraft(saved);
      if (status) setStatusAvailable(status.nativeAvailable);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "設定を読み込めませんでした");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const updateField = <K extends keyof QwenNativeSettings>(
    key: K,
    value: QwenNativeSettings[K],
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const sanitized: QwenNativeSettings = {
      enabled: draft.enabled,
      baseUrl: draft.baseUrl.trim() || DEFAULTS.baseUrl,
      model: draft.model.trim() || DEFAULTS.model,
      apiKey: draft.apiKey.trim() || DEFAULTS.apiKey,
      timeoutMs: clampTimeout(draft.timeoutMs),
      maxTokens: clampMaxTokens(draft.maxTokens),
    };
    setDraft(sanitized);
    try {
      const saved = await sendJson<QwenNativeSettings>(
        "PUT",
        "/api/qwen-native/settings",
        sanitized,
      );
      if (!mountedRef.current) return;
      setSettings(saved);
      setSuccess("画像解析設定を保存しました");
      const status = await getJson<{ nativeAvailable: boolean }>(
        "/api/qwen-native/status",
      ).catch(() => null);
      if (mountedRef.current && status) setStatusAvailable(status.nativeAvailable);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "保存に失敗しました");
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [draft, saving]);

  if (loading) {
    return (
      <p
        aria-busy="true"
        className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted"
      >
        画像解析設定を読み込んでいます…
      </p>
    );
  }

  const dirty =
    !settings ||
    settings.enabled !== draft.enabled ||
    settings.baseUrl !== draft.baseUrl ||
    settings.model !== draft.model ||
    settings.apiKey !== draft.apiKey ||
    settings.timeoutMs !== draft.timeoutMs ||
    settings.maxTokens !== draft.maxTokens;

  return (
    <section aria-label="画像解析設定" className="space-y-4 pb-6">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger"
        >
          {error}
        </div>
      )}
      {success && !error && (
        <div
          role="status"
          className="rounded-xl border border-success/30 bg-success-bg px-4 py-3 text-sm text-success"
        >
          {success}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface px-5 py-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span
            className={cx(
              "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
              statusAvailable ? "bg-success" : "bg-muted/40",
            )}
            aria-hidden="true"
          />
          <div>
            <h3 className="text-sm font-semibold text-text">画像事前解析</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
              画像非対応モデル使用時に、OpenAI互換の画像対応モデルで画像を事前解析しテキストとして取り込みます。
              ローカルOllama（<code className="font-mono">qwen2.5vl:7b</code> 等）だけでなく、OpenAI・Gemini・DashScope等のOpenAI互換エンドポイントも指定できます。
              外部APIを利用する場合は該当プロバイダーのAPIキーが必要です。
            </p>
            <p className="mt-1 text-xs text-faint">
              現在の状態:{" "}
              {statusAvailable === null
                ? "不明"
                : statusAvailable
                  ? "有効"
                  : "無効"}
            </p>
          </div>
        </div>
      </div>

      <fieldset
        className="rounded-2xl border border-border bg-surface px-5 py-4 shadow-sm"
        disabled={saving}
      >
        <legend className="px-1 text-sm font-semibold text-text">事前解析モデル</legend>

        <label
          className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg px-3.5 py-3 transition-colors hover:border-primary/40 hover:bg-surface-2"
          htmlFor="qwen-native-enabled"
        >
          <input
            id="qwen-native-enabled"
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            checked={draft.enabled}
            onChange={(event) => updateField("enabled", event.target.checked)}
            aria-label="画像事前解析を有効化"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text">有効化</span>
            <span className="block text-xs text-muted">
              チェックを外すと画像非対応モデルへの添付画像入力を拒否します
            </span>
          </span>
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              className="block text-xs font-medium text-muted"
              htmlFor="qwen-native-base-url"
            >
              Base URL（OpenAI互換エンドポイント）
            </label>
            <input
              id="qwen-native-base-url"
              type="text"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={draft.baseUrl}
              onChange={(event) => updateField("baseUrl", event.target.value)}
              placeholder="http://127.0.0.1:11434/v1"
              aria-label="事前解析モデルのAPI Base URL"
            />
            <p className="mt-1 text-[11px] text-faint">
              ローカルOllama: <code className="font-mono">http://127.0.0.1:11434/v1</code> / OpenAI: <code className="font-mono">https://api.openai.com/v1</code> / Gemini: <code className="font-mono">https://generativelanguage.googleapis.com/v1beta/openai</code>
            </p>
          </div>
          <div>
            <label
              className="block text-xs font-medium text-muted"
              htmlFor="qwen-native-model"
            >
              モデル名
            </label>
            <input
              id="qwen-native-model"
              type="text"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={draft.model}
              onChange={(event) => updateField("model", event.target.value)}
              placeholder="qwen2.5vl:7b"
              aria-label="事前解析モデル名"
            />
            <p className="mt-1 text-[11px] text-faint">
              例: <code className="font-mono">qwen2.5vl:7b</code> / <code className="font-mono">gpt-4o</code> / <code className="font-mono">gemini-2.5-flash</code> / <code className="font-mono">qwen-vl-max</code>
            </p>
          </div>
          <div>
            <label
              className="block text-xs font-medium text-muted"
              htmlFor="qwen-native-api-key"
            >
              API キー
            </label>
            <input
              id="qwen-native-api-key"
              type="password"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={draft.apiKey}
              onChange={(event) => updateField("apiKey", event.target.value)}
              placeholder="ollama"
              aria-label="事前解析モデルのAPIキー"
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] text-faint">
              ローカルOllamaは省略可（既定値 <code className="font-mono">ollama</code>）。外部APIは該当プロバイダーのキーを入力してください。
            </p>
          </div>
          <div>
            <label
              className="block text-xs font-medium text-muted"
              htmlFor="qwen-native-timeout"
            >
              タイムアウト（秒）
            </label>
            <input
              id="qwen-native-timeout"
              type="number"
              min={TIMEOUT_MIN_MS / 1000}
              max={TIMEOUT_MAX_MS / 1000}
              step={1}
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={Math.round(draft.timeoutMs / 1000)}
              onChange={(event) =>
                updateField("timeoutMs", Number(event.target.value) * 1000)
              }
              aria-label="解析タイムアウト秒"
            />
          </div>
          <div>
            <label
              className="block text-xs font-medium text-muted"
              htmlFor="qwen-native-max-tokens"
            >
              最大トークン
            </label>
            <input
              id="qwen-native-max-tokens"
              type="number"
              min={MAX_TOKENS_MIN}
              max={MAX_TOKENS_MAX}
              step={64}
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={draft.maxTokens}
              onChange={(event) =>
                updateField("maxTokens", Number(event.target.value))
              }
              aria-label="解析結果の最大トークン"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!dirty || saving}
            busy={saving}
          >
            保存
          </Button>
          {dirty && !saving && (
            <span className="text-xs text-faint">未保存の変更があります</span>
          )}
        </div>
      </fieldset>

      <div className="rounded-2xl border border-border bg-surface px-5 py-4 text-xs text-muted">
        <h4 className="text-sm font-semibold text-text">使い方</h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            画像対応のOpenAI互換モデルを用意してください。ローカルOllama（例:{" "}
            <code className="font-mono">ollama run qwen2.5vl:7b</code>）または外部API（OpenAI・Gemini・DashScope等）のどちらでも構いません。
          </li>
          <li>上記フォームで Base URL・モデル名・APIキーを設定し、有効化して保存します。</li>
          <li>
            画像非対応モデルを選んでいても、添付画像があれば WebUI が自動で事前解析し、テキストとして取り込みます。
          </li>
          <li>
            環境変数 <code className="font-mono">OPENCODE_WEBUI_QWEN_NATIVE=1</code>{" "}
            が設定されている場合はそちらが優先されます（ファイル設定より上位）。
          </li>
        </ol>
        <p className="mt-3 text-faint">
          既定のBase URL: <code className="font-mono">{DEFAULTS.baseUrl}</code> /{" "}
          既定モデル: <code className="font-mono">{DEFAULTS.model}</code>
        </p>
      </div>
    </section>
  );
}