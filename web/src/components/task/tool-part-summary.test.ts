import { describe, expect, it } from "vitest";
import {
  firstQuestionText,
  questionInputFields,
  questionToolSummary,
} from "./tool-part-summary";

describe("firstQuestionText", () => {
  it("reads questions[0].question", () => {
    expect(
      firstQuestionText({
        questions: [{ question: "続行しますか？", header: "確認" }],
      }),
    ).toBe("続行しますか？");
  });

  it("falls back to header when question is missing", () => {
    expect(
      firstQuestionText({
        questions: [{ header: "確認事項", options: [] }],
      }),
    ).toBe("確認事項");
  });

  it("returns null for empty or malformed input", () => {
    expect(firstQuestionText({})).toBeNull();
    expect(firstQuestionText({ questions: [] })).toBeNull();
    expect(firstQuestionText({ questions: [null] })).toBeNull();
  });
});

describe("questionToolSummary", () => {
  it("does not show 回答待ち for schema errors", () => {
    expect(
      questionToolSummary({
        status: "error",
        error:
          'The question tool was called with invalid arguments: SchemaError(Missing key at ["questions"][0]["question"]). Please rewrite the input so it satisfies the expected schema.',
      }),
    ).toBe("引数が不正です");
  });

  it("summarizes a valid pending question from questions[]", () => {
    expect(
      questionToolSummary({
        status: "running",
        input: {
          questions: [{ question: "どの案にしますか？", header: "選択" }],
        },
      }),
    ).toBe("どの案にしますか？");
  });

  it("uses 回答待ち only while pending without text", () => {
    expect(
      questionToolSummary({
        status: "pending",
        input: { questions: [{}] },
      }),
    ).toBe("回答待ち");
  });
});

describe("questionInputFields", () => {
  it("lists questions from the array schema", () => {
    expect(
      questionInputFields({
        questions: [
          { question: "A?", header: "1" },
          { question: "B?", header: "2" },
        ],
      }),
    ).toEqual([
      { label: "質問1", value: "A?" },
      { label: "質問2", value: "B?" },
    ]);
  });
});
