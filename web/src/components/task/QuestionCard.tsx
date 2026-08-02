"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const [selected, setSelected] = useState<string[][]>(() =>
    request.questions.map(() => []),
  );
  const [customs, setCustoms] = useState<string[]>(() =>
    request.questions.map(() => ""),
  );
  const customRefs = useRef<(HTMLInputElement | null)[]>(
    request.questions.map(() => null),
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      busyRef.current = false;
    };
  }, []);

  useEffect(() => {
    requestGenerationRef.current += 1;
    busyRef.current = false;
    setBusy(null);
    setError(null);
    // #region debug log
    fetch('http://127.0.0.1:52338/ingest/8d185c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'8d185c',runId:'initial',hypothesisId:'Q1',location:'QuestionCard.tsx:47',message:'question request generation reset',data:{requestId:request.id,busyRef:busyRef.current},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [request.id]);

  // `custom` is enabled by default unless explicitly disabled (`custom: false`).
  // Some callers omit the field entirely while still expecting free-text input
  // (see the question tool's documented default), so undefined must count as on.
  const isCustomEnabled = (q: QuestionInfo) => q.custom !== false;

  const canSubmit = useMemo(() => {
    return request.questions.every((q, i) => {
      const picks = selected[i] ?? [];
      const custom = customs[i]?.trim() ?? "";
      if (picks.length > 0) return true;
      if (isCustomEnabled(q) && custom) return true;
      return false;
    });
  }, [request.questions, selected, customs]);

  const isOnlyCustom = (q: QuestionInfo) =>
    q.options.length === 0 && isCustomEnabled(q);

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
      if (isCustomEnabled(q) && custom && !picks.includes(custom))
        picks.push(custom);
      return picks;
    });

  const reply = async () => {
    if (!canSubmit || busy !== null || busyRef.current) return;
    const generation = requestGenerationRef.current;
    busyRef.current = true;
    setBusy("reply");
    setError(null);
    // #region debug log
    fetch('http://127.0.0.1:52338/ingest/8d185c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'8d185c',runId:'initial',hypothesisId:'Q2',location:'QuestionCard.tsx:92',message:'question reply started',data:{requestId:request.id,generation},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    try {
      await onReply(request, buildAnswers());
    } catch (err) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      setError(err instanceof Error ? err.message : "回答に失敗しました");
    } finally {
      busyRef.current = false;
      if (mountedRef.current && generation === requestGenerationRef.current) {
        setBusy(null);
      }
      // #region debug log
      fetch('http://127.0.0.1:52338/ingest/8d185c',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'8d185c',runId:'initial',hypothesisId:'Q2',location:'QuestionCard.tsx:103',message:'question reply finished',data:{requestId:request.id,generation,mounted:mountedRef.current,currentGeneration:requestGenerationRef.current,busyRef:busyRef.current},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
  };

  const reject = async () => {
    if (busy !== null || busyRef.current) return;
    const generation = requestGenerationRef.current;
    busyRef.current = true;
    setBusy("reject");
    setError(null);
    try {
      await onReject(request);
    } catch (err) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      setError(err instanceof Error ? err.message : "拒否に失敗しました");
    } finally {
      busyRef.current = false;
      if (mountedRef.current && generation === requestGenerationRef.current) {
        setBusy(null);
      }
    }
  };

  const quickReply = async (qi: number, label: string) => {
    if (busy !== null || busyRef.current) return;
    const q = request.questions[qi];
    if (!q || q.multiple || request.questions.length !== 1) {
      toggle(qi, label, q?.multiple);
      return;
    }
    const generation = requestGenerationRef.current;
    busyRef.current = true;
    setBusy("reply");
    setError(null);
    try {
      const answers = request.questions.map((_, i) =>
        i === qi ? [label] : [...(selected[i] ?? [])],
      );
      await onReply(request, answers);
    } catch (err) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) return;
      setError(err instanceof Error ? err.message : "回答に失敗しました");
    } finally {
      busyRef.current = false;
      if (mountedRef.current && generation === requestGenerationRef.current) {
        setBusy(null);
      }
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
    request.questions.some((q) => q.multiple || isCustomEnabled(q));

  return (
    <div
      className="rounded-xl border border-accent/40 bg-surface p-4 shadow-sm"
      aria-label="確認が必要です"
    >
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
                    role={q.multiple ? "checkbox" : "radio"}
                    aria-checked={on}
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
            {isCustomEnabled(q) && (
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
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert" aria-live="assertive">
          {error}
        </p>
      )}
    </div>
  );
}
