import { listOllamaModels } from "./ollama-cli";
import { upsertProviderEntry } from "./opencode-extensions/provider-models";

/**
 * ローカル Ollama を OpenCode の provider として `opencode.jsonc` に登録する。
 * 画像事前解析は OpenCode 登録モデルに一本化しているため、ローカルモデルも
 * ここを通して初めて解析モデルの選択肢に出てくる。
 */
export const OLLAMA_PROVIDER_ID = "ollama";
export const OLLAMA_PROVIDER_NAME = "Ollama (ローカル)";
export const OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
export const OLLAMA_DEFAULT_VISION_MODEL = "qwen2.5vl:7b";

/**
 * Ollama は models.dev のようなカタログを持たないため、モデル名から画像入力の
 * 可否を推定する。誤検出しても選択肢に出るだけで、実際の解析は OpenCode 側の
 * エラーになる。
 */
const VISION_MODEL_RE =
  /(?:^|[/:._-])(?:vl|vision|llava|bakllava|moondream|minicpm-v|pixtral|internvl)|qwen[\d.]*vl|llama3\.2-vision|gemma3/i;

export function isOllamaVisionModel(model: string): boolean {
  const name = model.trim().toLowerCase();
  if (!name) return false;
  // gemma3:1b はテキスト専用。
  if (/^gemma3:1b\b/.test(name)) return false;
  return VISION_MODEL_RE.test(name);
}

export function ollamaProviderConfig(
  models: readonly string[],
): Record<string, unknown> {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: OLLAMA_PROVIDER_NAME,
    options: { baseURL: OLLAMA_BASE_URL, apiKey: "ollama" },
    models: Object.fromEntries(
      models.map((model) => [
        model,
        {
          name: model,
          tool_call: true,
          ...(isOllamaVisionModel(model)
            ? {
                attachment: true,
                modalities: { input: ["text", "image"], output: ["text"] },
              }
            : {}),
        },
      ]),
    ),
  };
}

/** `providerID::modelID`（画像解析設定が保存する形式）。 */
export function ollamaModelValue(model: string): string {
  return `${OLLAMA_PROVIDER_ID}::${model}`;
}

export async function registerOllamaProvider(
  models?: readonly string[],
): Promise<{ providerID: string; models: string[]; visionModels: string[] }> {
  const detected = (models ?? (await listOllamaModels()))
    .map((model) => model.trim())
    .filter(Boolean);
  const unique = [...new Set(detected)];
  if (unique.length === 0) {
    throw new Error("Ollamaのモデルが見つかりません。先にモデルをPullしてください。");
  }
  await upsertProviderEntry(OLLAMA_PROVIDER_ID, ollamaProviderConfig(unique));
  return {
    providerID: OLLAMA_PROVIDER_ID,
    models: unique,
    visionModels: unique.filter(isOllamaVisionModel),
  };
}
