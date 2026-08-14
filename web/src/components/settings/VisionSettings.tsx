"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, cx } from "@/components/ui";
import { getJson, sendJson, timedFetch } from "@/lib/client";
import {
  VISION_ANALYSIS_TIMEOUT_DEFAULT_MS,
  VISION_ANALYSIS_TIMEOUT_MAX_MS,
  VISION_ANALYSIS_TIMEOUT_MIN_MS,
  clampVisionAnalysisTimeoutMs,
} from "@/lib/image-send-timeout";

type QwenNativeSettings = {
  enabled: boolean;
  /** `providerID::modelID`（OpenCode 登録モデル）。 */
  opencodeModel: string;
  timeoutMs: number;
};

type OllamaStatus = {
  installed: boolean;
  running: boolean;
  version: string | null;
  models: string[];
};

type ModelOption = { value: string; label: string; group: string };

const DEFAULTS: QwenNativeSettings = {
  enabled: false,
  opencodeModel: "",
  timeoutMs: VISION_ANALYSIS_TIMEOUT_DEFAULT_MS,
};

const DEFAULT_OLLAMA_MODEL = "qwen2.5vl:7b";
const TIMEOUT_MIN_MS = VISION_ANALYSIS_TIMEOUT_MIN_MS;
const TIMEOUT_MAX_MS = VISION_ANALYSIS_TIMEOUT_MAX_MS;
const SETUP_TIMEOUT_MS = 900_000;

function clampTimeout(value: number): number {
  return clampVisionAnalysisTimeoutMs(value);
}

export function VisionSettings() {
  const [settings, setSettings] = useState<QwenNativeSettings | null>(null);
  const [draft, setDraft] = useState<QwenNativeSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusAvailable, setStatusAvailable] = useState<boolean | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [ollamaMessage, setOllamaMessage] = useState<string | null>(null);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [ollamaModel, setOllamaModel] = useState(DEFAULT_OLLAMA_MODEL);
  const [opencodeModels, setOpencodeModels] = useState<ModelOption[]>([]);
  const mountedRef = useRef(false);

  const loadModels = useCallback(async () => {
    const registered = await getJson<{ models: ModelOption[] }>(
      "/api/qwen-native/models",
    ).catch(() => null);
    if (mountedRef.current && registered) setOpencodeModels(registered.models);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [saved, status, ollama, registeredModels] = await Promise.all([
        getJson<QwenNativeSettings>("/api/qwen-native/settings"),
        getJson<{ nativeAvailable: boolean }>("/api/qwen-native/status").catch(() => null),
        getJson<OllamaStatus>("/api/ollama/status").catch(() => null),
        getJson<{ models: ModelOption[] }>("/api/qwen-native/models").catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setSettings(saved);
      setDraft(saved);
      if (status) setStatusAvailable(status.nativeAvailable);
      if (ollama) setOllamaStatus(ollama);
      if (registeredModels) setOpencodeModels(registeredModels.models);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "設定を読み込めませんでした");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const refreshOllamaStatus = useCallback(async () => {
    const ollama = await getJson<OllamaStatus>("/api/ollama/status").catch(() => null);
    if (mountedRef.current && ollama) setOllamaStatus(ollama);
  }, []);

  /**
   * 起動時の自動セットアップは廃止済み。インストール → モデルPull →
   * OpenCode provider 登録までをこのボタンだけで行う。
   */
  const setupOllama = useCallback(async () => {
    if (ollamaBusy) return;
    setOllamaBusy(true);
    setOllamaMessage(null);
    setOllamaError(null);
    try {
      const res = await timedFetch("/api/ollama/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: ollamaModel.trim() || DEFAULT_OLLAMA_MODEL }),
        timeoutMs: SETUP_TIMEOUT_MS,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        steps?: string[];
        error?: string;
        modelValue?: string;
      };
      if (!mountedRef.current) return;
      if (res.ok && data.ok) {
        setOllamaMessage(
          [
            ...(data.steps ?? []),
            "OpenCode の再起動後に解析モデルとして利用できます。",
          ].join(" / "),
        );
        if (data.modelValue) {
          setDraft((prev) => ({ ...prev, opencodeModel: data.modelValue! }));
        }
        await Promise.all([refreshOllamaStatus(), loadModels()]);
      } else {
        setOllamaError(data.error ?? "Ollamaのセットアップに失敗しました");
        if ((data.steps ?? []).length > 0) setOllamaMessage(data.steps!.join(" / "));
      }
    } catch (err) {
      if (mountedRef.current) {
        setOllamaError(
          err instanceof Error ? err.message : "Ollamaのセットアップに失敗しました",
        );
      }
    } finally {
      if (mountedRef.current) setOllamaBusy(false);
    }
  }, [loadModels, ollamaBusy, ollamaModel, refreshOllamaStatus]);

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
      opencodeModel: draft.opencodeModel.trim(),
      timeoutMs: clampTimeout(draft.timeoutMs),
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

  const groups = useMemo(
    () => [...new Set(opencodeModels.map((model) => model.group))],
    [opencodeModels],
  );
  const selectedMissing =
    draft.opencodeModel.length > 0 &&
    !opencodeModels.some((model) => model.value === draft.opencodeModel);

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
    settings.opencodeModel !== draft.opencodeModel ||
    settings.timeoutMs !== draft.timeoutMs;

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
              画像非対応モデルの使用時に、OpenCodeへ登録済みの画像対応モデルで画像を事前解析し、テキストとして取り込みます。
              解析モデルはOpenCode登録モデルに一本化されており、ローカルOllamaも下の「ローカルOllama」からOpenCodeへ登録して使用します。
            </p>
            <p className="mt-1 text-xs text-faint">
              現在の状態:{" "}
              {statusAvailable === null ? "不明" : statusAvailable ? "有効" : "無効"}
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
            <label className="block text-xs font-medium text-muted" htmlFor="qwen-opencode-model">
              OpenCode登録モデル（画像対応）
            </label>
            <select
              id="qwen-opencode-model"
              value={draft.opencodeModel}
              onChange={(event) => updateField("opencodeModel", event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-primary"
            >
              <option value="">選択してください</option>
              {selectedMissing && (
                <option value={draft.opencodeModel}>
                  {draft.opencodeModel}（未接続）
                </option>
              )}
              {groups.map((group) => (
                <optgroup key={group} label={group}>
                  {opencodeModels
                    .filter((model) => model.group === group)
                    .map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            {opencodeModels.length === 0 && (
              <p className="mt-1 text-xs text-warning">
                画像対応モデルが見つかりません。プロバイダー接続、またはローカルOllamaの登録を行ってください。
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-muted" htmlFor="qwen-native-timeout">
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
              onChange={(event) => updateField("timeoutMs", Number(event.target.value) * 1000)}
              aria-label="解析タイムアウト秒"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!dirty || saving || (draft.enabled && !draft.opencodeModel)}
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
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-text">ローカルOllama</h4>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void refreshOllamaStatus()}
            disabled={ollamaBusy}
            aria-label="Ollama導入状況を再確認"
          >
            再確認
          </Button>
        </div>
        <p className="mt-1 max-w-2xl leading-5">
          起動時の自動セットアップは行いません。必要なときにこのボタンで、インストール →
          モデル取得 → OpenCodeへのプロバイダー登録 をまとめて実行します。
        </p>
        <dl className="mt-2 grid gap-1.5 sm:grid-cols-3">
          <div>
            <dt className="text-faint">インストール</dt>
            <dd>
              {ollamaStatus === null ? (
                <span className="text-faint">取得中…</span>
              ) : ollamaStatus.installed ? (
                <span className="text-success">
                  あり{ollamaStatus.version ? `（v${ollamaStatus.version}）` : ""}
                </span>
              ) : (
                <span className="text-danger">未導入</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-faint">サービス</dt>
            <dd>
              {ollamaStatus === null ? (
                <span className="text-faint">取得中…</span>
              ) : ollamaStatus.running ? (
                <span className="text-success">起動中</span>
              ) : (
                <span className="text-warning">停止中</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-faint">取得済みモデル</dt>
            <dd>
              {ollamaStatus === null ? (
                <span className="text-faint">取得中…</span>
              ) : ollamaStatus.models.length === 0 ? (
                <span className="text-faint">なし</span>
              ) : (
                <span className="font-mono text-muted">{ollamaStatus.models.join(", ")}</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[11px] font-medium text-faint" htmlFor="ollama-setup-model">
              取得するモデル
            </label>
            <input
              id="ollama-setup-model"
              type="text"
              className="mt-1 w-64 rounded-lg border border-border bg-bg px-3 py-2 font-mono text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={ollamaModel}
              onChange={(event) => setOllamaModel(event.target.value)}
              placeholder={DEFAULT_OLLAMA_MODEL}
              disabled={ollamaBusy}
              aria-label="セットアップで取得するOllamaモデル"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void setupOllama()}
            disabled={ollamaBusy}
            busy={ollamaBusy}
          >
            Ollamaをセットアップ
          </Button>
        </div>

        {ollamaError && (
          <p
            role="alert"
            className="mt-2 rounded-md border border-danger/30 bg-danger-bg px-2 py-1.5 text-xs text-danger"
          >
            {ollamaError}
          </p>
        )}
        {ollamaMessage && (
          <p
            role="status"
            className="mt-2 rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-muted"
          >
            {ollamaMessage}
          </p>
        )}
        {ollamaBusy && (
          <p className="mt-2 text-faint">
            インストールとモデル取得には数分かかることがあります。このタブを開いたままお待ちください。
          </p>
        )}
        {ollamaStatus && ollamaStatus.installed && !ollamaStatus.running && (
          <p className="mt-2 text-faint">
            Ollamaは導入済みですがサービスが停止しています。
            <code className="font-mono">ollama serve</code> またはスタートメニューから起動してください。
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface px-5 py-4 text-xs text-muted">
        <h4 className="text-sm font-semibold text-text">使い方</h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            画像対応モデルをOpenCodeに接続します。クラウドのプロバイダーは「プロバイダー/モデル」タブ、
            ローカルOllamaは上の「Ollamaをセットアップ」で <code className="font-mono">opencode.jsonc</code> に登録されます。
          </li>
          <li>登録したモデルを「事前解析モデル」で選び、有効化して保存します。</li>
          <li>
            画像非対応モデルを選んでいても、添付画像があればLeafCodeが自動で事前解析し、テキストとして取り込みます。
          </li>
          <li>
            環境変数 <code className="font-mono">LEAFCODE_QWEN_NATIVE=1</code>{" "}
            で強制的に有効化、<code className="font-mono">LEAFCODE_QWEN_MODEL</code>（
            <code className="font-mono">providerID::modelID</code>）で解析モデルを上書きできます。
          </li>
        </ol>
        <p className="mt-3 text-faint">
          プロバイダーを新規登録した直後は、OpenCode の再起動後に解析へ利用できます。
        </p>
      </div>
    </section>
  );
}
