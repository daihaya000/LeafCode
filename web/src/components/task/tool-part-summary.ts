import type { ToolState } from "@/lib/types";

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** First question text from OpenCode question-tool input (`questions[].question`). */
export function firstQuestionText(input: Record<string, unknown>): string | null {
  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const first = questions[0];
  if (!first || typeof first !== "object") return null;
  const q = first as Record<string, unknown>;
  return asString(q.question) ?? asString(q.header);
}

/** Compact header summary for a question tool part. */
export function questionToolSummary(state: ToolState | undefined): string {
  if (state?.title) return state.title;
  if (state?.status === "error") {
    const err = asString(state.error);
    if (err) {
      // Prefer a short, actionable label over the full schema dump.
      if (/SchemaError|invalid arguments|Missing key/i.test(err)) {
        return "引数が不正です";
      }
      return err.length > 120 ? `${err.slice(0, 117)}…` : err;
    }
    return "呼び出し失敗";
  }

  const input = state?.input ?? {};
  return (
    firstQuestionText(input) ??
    asString(input.question) ??
    asString(input.header) ??
    (state?.status === "pending" || state?.status === "running"
      ? "回答待ち"
      : "確認")
  );
}

export type ToolField = { label: string; value: string };

/** Detail fields for a question tool part. */
export function questionInputFields(
  input: Record<string, unknown> | undefined,
): ToolField[] {
  if (!input) return [];
  const fields: ToolField[] = [];
  const questions = input.questions;
  if (Array.isArray(questions)) {
    questions.forEach((item, i) => {
      if (!item || typeof item !== "object") return;
      const q = item as Record<string, unknown>;
      const text = asString(q.question) ?? asString(q.header);
      if (!text) return;
      fields.push({
        label: questions.length > 1 ? `質問${i + 1}` : "質問",
        value: text,
      });
    });
  }
  const legacy = asString(input.question) ?? asString(input.header);
  if (fields.length === 0 && legacy) {
    fields.push({ label: "質問", value: legacy });
  }
  return fields;
}
