"use client";

import { useMemo, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { Button, cx } from "@/components/ui";
import type { QuestionInfo, QuestionRequest } from "@/lib/types";

export function QuestionCard({
  request,
  onReply,
  onReject,
}: {
  request: QuestionRequest;
  onReply: (request: QuestionRequest, answers: string[][]) => Promise<void>;
  onReject: (request: QuestionRequest) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"reply" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[][]>(() =>
    request.questions.map(() => []),
  );
  const [customs, setCustoms] = useState<string[]>(() =>
    request.questions.map(() => ""),
  );
  const customRefs = useRef<(HTMLInputElement | null)[]>(
    request.questions.map(() => null),
  );

  const canSubmit = useMemo(() => {
    return request.questions.every((q, i) => {
      const picks = selected[i] ?? [];
      const custom = customs[i]?.trim() ?? "";
      if (picks.length > 0) return true;
      if (q.custom && custom) return true;
      return false;
    });
  }, [request.questions, selected, customs]);

  const isOnlyCustom = (q: QuestionInfo) =>
    q.options.length === 0 && !!q.custom;

  const toggle = (qi: number, label: string, multiple?: boolean) => {
    setSelected((prev) => {
      const next = prev.map((row) => row.slice());
      const row = next[qi] ?? [];
      if (multiple) {
        next[qi] = row.includes(label)
          ? row.filter((x) => x !== label)
          : [...row, label];
      } else {
        next[qi] = row.includes(label) ? [] : [label];
      }
      return next;
    });
  };

  const buildAnswers = (): string[][] =>
    request.questions.map((q, i) => {
      const picks = [...(selected[i] ?? [])];
      const custom = customs[i]?.trim() ?? "";
      if (q.custom && custom && !picks.includes(custom)) picks.push(custom);
      return picks;
    });

  const reply = async () => {
    if (!canSubmit) return;
    setBusy("reply");
    setError(null);
    try {
      await onReply(request, buildAnswers());
    } catch (err) {
      setError(err instanceof Error ? err.message : "回答に失敗しました");
      setBusy(null);
    }
  };

  const reject = async () => {
    setBusy("reject");
    setError(null);
    try {
      await onReject(request);
    } catch (err) {
      setError(err instanceof Error ? err.message : "拒否に失敗しました");
      setBusy(null);
    }
  };

  const quickReply = async (qi: number, label: string) => {
    const q = request.questions[qi];
    if (!q || q.multiple || request.questions.length !== 1) {
      toggle(qi, label, q?.multiple);
      return;
    }
    setBusy("reply");
    setError(null);
    try {
      const answers = request.questions.map((_, i) =>
        i === qi ? [label] : [...(selected[i] ?? [])],
      );
      await onReply(request, answers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "回答に失敗しました");
      setBusy(null);
    }
  };

  const handleCustomKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    qi: number,
  ) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = request.questions[qi];
    const custom = customs[qi]?.trim() ?? "";
    if (!q || !custom) return;
    // single-question, single/custom-only can submit immediately
    if (
      request.questions.length === 1 &&
      (isOnlyCustom(q) || !q.multiple)
    ) {
      void reply();
      return;
    }
    // otherwise just append the custom value to selected and clear input,
    // leaving the explicit submit button to finish the form
    setSelected((prev) => {
      const next = prev.map((row) => row.slice());
      const row = next[qi] ?? [];
      next[qi] = q.multiple
        ? row.includes(custom)
          ? row
          : [...row, custom]
        : [custom];
      return next;
    });
    setCustoms((prev) => {
      const next = prev.slice();
      next[qi] = "";
      return next;
    });
    customRefs.current[qi]?.focus();
  };

  const needsSubmitButton =
    request.questions.length > 1 ||
    request.questions.some((q) => q.multiple || q.custom);

  return (
    <div className="rounded-xl border border-accent/40 bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-accent">
        <HelpCircle className="h-4 w-4" />
        確認が必要です
      </div>
      <div className="space-y-4">
        {request.questions.map((q, qi) => (
          <div key={`${request.id}-${qi}`}>
            {q.header && (
              <p className="mb-0.5 text-xs font-medium text-faint">{q.header}</p>
            )}
            <p className="mb-2 break-words text-sm text-text">{q.question}</p>
            <div
              className="flex flex-col gap-1.5"
              role={q.multiple ? "group" : "radiogroup"}
              aria-label={q.header ?? q.question}
              aria-multiselectable={q.multiple || undefined}
            >
              {q.options.map((opt) => {
                const on = (selected[qi] ?? []).includes(opt.label);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    disabled={busy !== null}
                    aria-pressed={on}
                    onClick={() => void quickReply(qi, opt.label)}
                    className={cx(
                      "cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50",
                      on
                        ? "border-accent bg-accent/10 text-text"
                        : "border-border bg-surface-2 text-muted hover:border-border-strong hover:text-text",
                    )}
                  >
                    <span className="block text-sm font-medium">{opt.label}</span>
                    {opt.description && (
                      <span className="mt-0.5 block text-xs text-faint">
                        {opt.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {q.custom && (
              <div className="mt-2 flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-2 focus-within:border-border-strong">
                <input
                  ref={(el) => {
                    customRefs.current[qi] = el;
                  }}
                  type="text"
                  value={customs[qi] ?? ""}
                  disabled={busy !== null}
                  aria-label={
                    q.header
                      ? `${q.header}（自由入力）`
                      : `${q.question}（自由入力）`
                  }
                  onChange={(e) =>
                    setCustoms((prev) => {
                      const next = prev.slice();
                      next[qi] = e.target.value;
                      return next;
                    })
                  }
                  onKeyDown={(e) => handleCustomKeyDown(e, qi)}
                  placeholder={
                    q.options.length > 0
                      ? "その他（自由入力）"
                      : "自由に入力してください"
                  }
                  className="w-full bg-transparent px-1 py-1 text-sm text-text outline-none placeholder:text-muted"
                />
                {customs[qi]?.trim() && !isOnlyCustom(q) && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      const value = customs[qi]?.trim() ?? "";
                      if (!value) return;
                      setSelected((prev) => {
                        const next = prev.map((row) => row.slice());
                        const row = next[qi] ?? [];
                        next[qi] = q.multiple
                          ? row.includes(value)
                            ? row
                            : [...row, value]
                          : [value];
                        return next;
                      });
                      setCustoms((prev) => {
                        const next = prev.slice();
                        next[qi] = "";
                        return next;
                      });
                      customRefs.current[qi]?.focus();
                    }}
                    className="self-start rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
                  >
                    追加する
                  </button>
                )}
                {selected[qi]?.some((v) => !q.options.find((o) => o.label === v)) && (
                  <div className="flex flex-wrap gap-1">
                    {selected[qi]
                      .filter((v) => !q.options.find((o) => o.label === v))
                      .map((v) => (
                        <span
                          key={v}
                          className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-xs text-text"
                        >
                          {v}
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => {
                              setSelected((prev) => {
                                const next = prev.map((row) => row.slice());
                                next[qi] = next[qi].filter((x) => x !== v);
                                return next;
                                });
                              }}
                            className="text-faint hover:text-danger disabled:opacity-50"
                            aria-label={`${v} を削除`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {needsSubmitButton && (
          <Button
            variant="primary"
            size="md"
            busy={busy === "reply"}
            disabled={busy !== null || !canSubmit}
            onClick={() => void reply()}
          >
            回答する
          </Button>
        )}
        <Button
          variant="ghost"
          size="md"
          busy={busy === "reject"}
          disabled={busy !== null}
          onClick={() => void reject()}
        >
          キャンセル
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
