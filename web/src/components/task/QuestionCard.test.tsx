import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuestionCard } from "./QuestionCard";
import type { QuestionRequest } from "@/lib/types";

const baseRequest = (questions: QuestionRequest["questions"]): QuestionRequest => ({
  id: "q1",
  version: "v1",
  sessionID: "s1",
  questions,
  receivedAt: Date.now(),
});

describe("QuestionCard custom answer", () => {
  it("renders the custom input when custom is true", () => {
    const request = baseRequest([
      {
        question: "好きな色は？",
        header: "",
        options: [{ label: "赤", description: "" }],
        custom: true,
      },
    ]);
    const markup = renderToStaticMarkup(
      createElement(QuestionCard, {
        request,
        onReply: vi.fn(),
        onReject: vi.fn(),
      }),
    );
    expect(markup).toContain("その他（自由入力）");
    expect(markup).toContain('type="text"');
  });

  it("renders free-text placeholder for custom-only question", () => {
    const request = baseRequest([
      {
        question: "何か追加があれば",
        header: "",
        options: [],
        custom: true,
      },
    ]);
    const markup = renderToStaticMarkup(
      createElement(QuestionCard, {
        request,
        onReply: vi.fn(),
        onReject: vi.fn(),
      }),
    );
    expect(markup).toContain("自由に入力してください");
  });

  it("shows submit button for custom questions", () => {
    const request = baseRequest([
      {
        question: "何か追加があれば",
        header: "",
        options: [],
        custom: true,
      },
    ]);
    const markup = renderToStaticMarkup(
      createElement(QuestionCard, {
        request,
        onReply: vi.fn(),
        onReject: vi.fn(),
      }),
    );
    expect(markup).toContain("回答する");
    expect(markup).toContain("キャンセル");
  });

  it("defaults to showing the custom input when `custom` is omitted", () => {
    const request = baseRequest([
      {
        question: "仕様書のどの点を修正しますか？",
        header: "修正箇所",
        options: [{ label: "A", description: "" }],
      },
    ]);
    const markup = renderToStaticMarkup(
      createElement(QuestionCard, {
        request,
        onReply: vi.fn(),
        onReject: vi.fn(),
      }),
    );
    expect(markup).toContain("その他（自由入力）");
    expect(markup).toContain('type="text"');
  });

  it("hides the custom input when `custom` is explicitly false", () => {
    const request = baseRequest([
      {
        question: "はい/いいえで答えてください",
        header: "",
        options: [{ label: "はい", description: "" }],
        custom: false,
      },
    ]);
    const markup = renderToStaticMarkup(
      createElement(QuestionCard, {
        request,
        onReply: vi.fn(),
        onReject: vi.fn(),
      }),
    );
    expect(markup).not.toContain('type="text"');
  });

  it("exposes single and multiple choices with their selection semantics", () => {
    const markup = renderToStaticMarkup(
      createElement(QuestionCard, {
        request: baseRequest([
          {
            question: "単一選択",
            header: "",
            options: [{ label: "A", description: "" }],
            custom: false,
          },
          {
            question: "複数選択",
            header: "",
            options: [{ label: "B", description: "" }],
            multiple: true,
            custom: false,
          },
        ]),
        onReply: vi.fn(),
        onReject: vi.fn(),
      }),
    );
    expect(markup).toContain('role="radio"');
    expect(markup).toContain('role="checkbox"');
    expect(markup).toContain('aria-checked="false"');
  });
});
