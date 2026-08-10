import { fetchOllamaModelCapabilities, listOllamaModels } from "./ollama-cli";
import { upsertProviderEntry } from "./opencode-extensions/provider-models";

/**
 * ローカル Ollama を OpenCode の provider として `opencode.jsonc` に登録する。
 * 画像事前解析は OpenCode 登録モデルに一本化しているため、ローカルモデルも
 * ここを通して初めて解析モデルの選択肢に出てくる。
 *
 * OpenCode は provider 設定の `attachment` / `modalities` から
 * `capabilities.attachment` / `capabilities.input.image` を組み立てる。
 * これを書かないとVLモデルでも画像非対応として扱われるため、登録時に必ず付与する。
 */
export const OLLAMA_PROVIDER_ID = "ollama";
export const OLLAMA_PROVIDER_NAME = "Ollama (ローカル)";
export const OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
export const OLLAMA_DEFAULT_VISION_MODEL = "qwen2.5vl:7b";

export type OllamaModelEntry = {
  id: string;
  vision: boolean;
  tools: boolean;
};

/**
 * `POST /api/show` が使えないとき（デーモン停止・旧バージョン）だけ使う推定。
 * 誤検出しても選択肢に出るだけで、実際の解析は OpenCode 側のエラーになる。
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

/** モデルごとに Ollama へ能力を問い合わせ、失敗時は名前から推定する。 */
export async function resolveOllamaModelEntries(
  models: readonly string[],
): Promise<OllamaModelEntry[]> {
  return Promise.all(
    models.map(async (id) => {
      const capabilities = await fetchOllamaModelCapabilities(id);
      if (capabilities) {
        return { id, vision: capabilities.vision, tools: capabilities.tools };
      }
      // 能力が読めないモデルは、少なくともツール利用は従来どおり許可しておく。
      return { id, vision: isOllamaVisionModel(id), tools: true };
    }),
  );
}

export function ollamaProviderConfig(
  models: readonly OllamaModelEntry[],
): Record<string, unknown> {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: OLLAMA_PROVIDER_NAME,
    options: { baseURL: OLLAMA_BASE_URL, apiKey: "ollama" },
    models: Object.fromEntries(
      models.map((model) => [
        model.id,
        {
          name: model.id,
          tool_call: model.tools,
          ...(model.vision
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
  const entries = await resolveOllamaModelEntries(unique);
  await upsertProviderEntry(OLLAMA_PROVIDER_ID, ollamaProviderConfig(entries));
  return {
    providerID: OLLAMA_PROVIDER_ID,
    models: entries.map((entry) => entry.id),
    visionModels: entries.filter((entry) => entry.vision).map((entry) => entry.id),
  };
}
