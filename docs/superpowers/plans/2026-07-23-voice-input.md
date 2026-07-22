# Voice Input (Web Speech API) Implementation Plan

# 音声入力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home 画面と Task 画面の両 composer で、Web Speech API を用いた音声認識入力を提供する。ユーザーはマイクボタンを押して話し、認識されたテキストを既存の入力内容に追記できる。

**Architecture:** 共通フック `useVoiceInput` が `SpeechRecognition` / `webkitSpeechRecognition` をラップし、`supported` / `listening` / `transcript` / `error` を返す。共通ボタン `VoiceInputButton` がフックの戻り値を受け取り、`onTranscript` コールバックで認識テキストを composer へ渡す。HomeView と TaskView はそれぞれ `useVoiceInput({ disabled })` を呼び出し、ツールバーの画像添付ボタン隣に `VoiceInputButton` を配置する。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Vitest、Testing Library、lucide-react（`Mic`, `MicOff`）、Web Speech API（`SpeechRecognition` / `webkitSpeechRecognition`）

## Global Constraints

- 外部 API・サードパーティ依存を追加しない。Web Speech API のみを使用する。
- 未対応ブラウザではマイクボタンを DOM から除去する（無効ボタンのグレーアウトは行わない）。
- 機能検出は `window.SpeechRecognition ?? window.webkitSpeechRecognition` で行い、結果を初回のみ保持する。
- `SpeechRecognition` 設定: `continuous: true`、`interimResults: false`、`maxAlternatives: 1`、`lang` は設定しない（ブラウザ既定）。
- `disabled === true` のとき `start()` は何もしない。認識中に `disabled` が `true` になったら自動停止し `transcript` を破棄する。
- フックのアンマウント時、認識中なら `abort()` を呼びインスタンスを解放する。
- エラー `"no-speech"` / `"aborted"` はエラー表示せず静かにリセットする。
- 認識停止時のみ `onTranscript` を通じて composer に追記する。自動送信は行わない。
- 認識中に composer の入力値が変更されても、確定テキストは常に現在の入力値の末尾に追記する。
- ロック中（HomeView: `submitting`、TaskView: `composerLocked`）は `disabled` を `true` にする。
- 常駐する開発サーバーや watch コマンドを起動しない。

## File Structure

- Create: `web/src/lib/use-voice-input.ts` — 共通フック
- Create: `web/src/lib/use-voice-input.test.ts` — フックのユニットテスト
- Create: `web/src/components/VoiceInputButton.tsx` — 共通マイクボタン
- Create: `web/src/components/VoiceInputButton.test.tsx` — ボタンのコンポーネントテスト
- Modify: `web/src/components/home/HomeView.tsx` — ツールバーに VoiceInputButton 追加
- Modify: `web/src/components/home/HomeView.test.tsx` — 結合テスト追加
- Modify: `web/src/components/task/TaskView.tsx` — ツールバーに VoiceInputButton 追加
- Modify: `web/src/components/task/TaskView.test.tsx` — 結合テスト追加
- Modify: `MEMORY.md` — 実装完了記録

---

### Task 1: 共通フック `useVoiceInput` の作成

**Files:**
- Create: `web/src/lib/use-voice-input.ts`
- Create: `web/src/lib/use-voice-input.test.ts`

**Interfaces:**
- Consumes: なし（ブラウザグローバル `window.SpeechRecognition` / `window.webkitSpeechRecognition`）
- Produces: `useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputReturn`

```ts
interface UseVoiceInputOptions {
  disabled?: boolean;
}

interface UseVoiceInputReturn {
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => string;
  transcript: string;
  error: string | null;
  clearError: () => void;
}
```

- [ ] **Step 1: フックの失敗テストを書く**

`web/src/lib/use-voice-input.test.ts` を次の内容で作成する。

```ts
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceInput } from "./use-voice-input";

/** Build a minimal SpeechRecognition mock that supports addEventListener. */
function createMockRecognition() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const mock = {
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    continuous: false,
    interimResults: false,
    maxAlternatives: 1,
    lang: "",
    addEventListener: vi.fn(
      (type: string, handler: (...args: unknown[]) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(handler);
      },
    ),
    removeEventListener: vi.fn(
      (type: string, handler: (...args: unknown[]) => void) => {
        listeners.get(type)?.delete(handler);
      },
    ),
    /** Test helper: dispatch a native-like event. */
    _dispatch(type: string, ...args: unknown[]) {
      for (const handler of listeners.get(type) ?? []) {
        handler(...args);
      }
    },
  };
  return mock;
}

describe("useVoiceInput", () => {
  let mockRecognition: ReturnType<typeof createMockRecognition>;

  beforeEach(() => {
    mockRecognition = createMockRecognition();
    vi.stubGlobal("webkitSpeechRecognition", mockRecognition);
    // Ensure SpeechRecognition is undefined so webkit prefix is used.
    vi.stubGlobal("SpeechRecognition", undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("detects supported browser", () => {
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.supported).toBe(true);
  });

  it("detects unsupported browser", () => {
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.supported).toBe(false);
  });

  it("starts recognition on start()", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    expect(mockRecognition.start).toHaveBeenCalledTimes(1);
  });

  it("sets listening=true on start event", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    expect(result.current.listening).toBe(true);
  });

  it("sets listening=false on end event", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    act(() => mockRecognition._dispatch("end"));
    expect(result.current.listening).toBe(false);
  });

  it("stops recognition and returns transcript on stop()", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    // Simulate a final result
    act(() =>
      mockRecognition._dispatch("result", {
        results: [[{ transcript: "hello world", isFinal: true }]],
      }),
    );
    let text = "";
    act(() => {
      text = result.current.stop();
    });
    expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
    expect(text).toBe("hello world");
    expect(result.current.transcript).toBe("hello world");
  });

  it("does nothing when disabled on start()", () => {
    const { result } = renderHook(() => useVoiceInput({ disabled: true }));
    act(() => result.current.start());
    expect(mockRecognition.start).not.toHaveBeenCalled();
  });

  it("auto-stops and discards transcript when disabled becomes true while listening", () => {
    const { result, rerender } = renderHook(
      (props: { disabled: boolean }) => useVoiceInput(props),
      { initialProps: { disabled: false } },
    );
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    act(() =>
      mockRecognition._dispatch("result", {
        results: [[{ transcript: "discard me", isFinal: true }]],
      }),
    );
    rerender({ disabled: true });
    expect(mockRecognition.stop).toHaveBeenCalled();
    expect(result.current.transcript).toBe("");
  });

  it("accumulates only final results", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    act(() =>
      mockRecognition._dispatch("result", {
        results: [[{ transcript: "first", isFinal: true }]],
      }),
    );
    act(() =>
      mockRecognition._dispatch("result", {
        results: [[{ transcript: "second", isFinal: true }]],
      }),
    );
    expect(result.current.transcript).toBe("first second");
  });

  it("sets error message on error event", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() =>
      mockRecognition._dispatch("error", { error: "not-allowed" }),
    );
    expect(result.current.error).toBe(
      "マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。",
    );
  });

  it("does not show error for no-speech or aborted", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() =>
      mockRecognition._dispatch("error", { error: "no-speech" }),
    );
    expect(result.current.error).toBeNull();
    act(() =>
      mockRecognition._dispatch("error", { error: "aborted" }),
    );
    expect(result.current.error).toBeNull();
  });

  it("calls abort() on unmount while listening", () => {
    const { result, unmount } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    unmount();
    expect(mockRecognition.abort).toHaveBeenCalled();
  });

  it("clears error on clearError()", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() =>
      mockRecognition._dispatch("error", { error: "not-allowed" }),
    );
    expect(result.current.error).not.toBeNull();
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
```

- [ ] **Step 2: テストが期待どおり失敗することを確認する**

Run:

```bash
cd web && npx vitest run src/lib/use-voice-input.test.ts
```

Expected: FAIL。`use-voice-input.ts` が存在しないためモジュール解決エラー。

- [ ] **Step 3: フックの最小実装を書く**

`web/src/lib/use-voice-input.ts` を次の内容で作成する。

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseVoiceInputOptions {
  disabled?: boolean;
}

export interface UseVoiceInputReturn {
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => string;
  transcript: string;
  error: string | null;
  clearError: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。",
  "audio-capture":
    "マイクが見つかりません。マイクが接続されているか確認してください。",
  "language-not-supported":
    "この言語は音声認識に対応していません。",
  "service-not-allowed":
    "音声認識サービスが利用できません。",
};

const SILENT_ERRORS = new Set(["no-speech", "aborted"]);

function detectSpeechRecognition():
  | { new (): SpeechRecognition }
  | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    (window as unknown as Record<string, unknown>).SpeechRecognition ??
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  ) as { new (): SpeechRecognition } | undefined;
}

export function useVoiceInput(
  options: UseVoiceInputOptions = {},
): UseVoiceInputReturn {
  const { disabled = false } = options;
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const listeningRef = useRef(false);
  const [supported] = useState(() => !!detectSpeechRecognition());
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Lazily create the SpeechRecognition instance once.
  const getRecognition = useCallback((): SpeechRecognition | null => {
    if (recognitionRef.current) return recognitionRef.current;
    const Ctor = detectSpeechRecognition();
    if (!Ctor) return null;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.addEventListener("start", () => {
      listeningRef.current = true;
      setListening(true);
      setError(null);
    });

    recognition.addEventListener("end", () => {
      listeningRef.current = false;
      setListening(false);
    });

    recognition.addEventListener("result", (event: SpeechRecognitionEvent) => {
      const results = event.results;
      if (!results) return;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.isFinal) {
          const text = result[0]?.transcript ?? "";
          if (text) {
            transcriptRef.current = transcriptRef.current
              ? `${transcriptRef.current} ${text}`
              : text;
            setTranscript(transcriptRef.current);
          }
        }
      }
    });

    recognition.addEventListener("error", (event: SpeechRecognitionErrorEvent) => {
      const code = event.error;
      if (SILENT_ERRORS.has(code)) {
        // Reset silently
        listeningRef.current = false;
        setListening(false);
        return;
      }
      setError(ERROR_MESSAGES[code] ?? "音声認識でエラーが発生しました。");
      listeningRef.current = false;
      setListening(false);
    });

    recognitionRef.current = recognition;
    return recognition;
  }, []);

  const start = useCallback(() => {
    if (disabled) return;
    const recognition = getRecognition();
    if (!recognition) return;
    try {
      recognition.start();
    } catch {
      // Already started — ignore.
    }
  }, [disabled, getRecognition]);

  const stop = useCallback((): string => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // Not started — ignore.
      }
    }
    const text = transcriptRef.current;
    return text;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Auto-stop when disabled becomes true while listening.
  useEffect(() => {
    if (disabled && listeningRef.current) {
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.stop();
        } catch {
          // ignore
        }
      }
      listeningRef.current = false;
      setListening(false);
      transcriptRef.current = "";
      setTranscript("");
    }
  }, [disabled]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    supported,
    listening,
    start,
    stop,
    transcript,
    error,
    clearError,
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run:

```bash
cd web && npx vitest run src/lib/use-voice-input.test.ts
```

Expected: 全テスト PASS。

- [ ] **Step 5: 型チェックを通す**

Run:

```bash
cd web && npm run typecheck
```

Expected: TypeScript エラーが 0 件。

- [ ] **Step 6: 差分を確認して即コミットする**

Run:

```bash
git status --short
git diff -- web/src/lib/use-voice-input.ts web/src/lib/use-voice-input.test.ts
git add web/src/lib/use-voice-input.ts web/src/lib/use-voice-input.test.ts
git commit -m "feat: 音声入力共通フック useVoiceInput を追加"
git log --oneline -1
```

Expected: コミット出力と最新ログに新しいコミットハッシュが表示される。

---

### Task 2: 共通マイクボタン `VoiceInputButton` の作成

**Files:**
- Create: `web/src/components/VoiceInputButton.tsx`
- Create: `web/src/components/VoiceInputButton.test.tsx`

**Interfaces:**
- Consumes: `UseVoiceInputReturn`（Task 1）、`onTranscript: (text: string) => void`
- Produces: アクセシブルな `<button>` コンポーネント

```ts
interface VoiceInputButtonProps {
  voice: UseVoiceInputReturn;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}
```

- [ ] **Step 1: ボタンの失敗テストを書く**

`web/src/components/VoiceInputButton.test.tsx` を次の内容で作成する。

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceInputButton } from "./VoiceInputButton";
import type { UseVoiceInputReturn } from "@/lib/use-voice-input";

function mockVoice(overrides: Partial<UseVoiceInputReturn> = {}): UseVoiceInputReturn {
  return {
    supported: true,
    listening: false,
    start: vi.fn(),
    stop: vi.fn(() => ""),
    transcript: "",
    error: null,
    clearError: vi.fn(),
    ...overrides,
  };
}

describe("VoiceInputButton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders nothing when unsupported", () => {
    const voice = mockVoice({ supported: false });
    const { container } = render(
      <VoiceInputButton voice={voice} onTranscript={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders a mic button when supported", () => {
    const voice = mockVoice();
    render(<VoiceInputButton voice={voice} onTranscript={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "音声入力" }),
    ).toBeTruthy();
  });

  it("calls voice.start() on click when not listening", () => {
    const voice = mockVoice();
    render(<VoiceInputButton voice={voice} onTranscript={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(voice.start).toHaveBeenCalledTimes(1);
  });

  it("calls voice.stop() and onTranscript on click when listening", () => {
    const voice = mockVoice({ listening: true, stop: vi.fn(() => "hello") });
    const onTranscript = vi.fn();
    render(
      <VoiceInputButton voice={voice} onTranscript={onTranscript} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(voice.stop).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith("hello");
  });

  it("does nothing when disabled and not listening", () => {
    const voice = mockVoice();
    render(
      <VoiceInputButton
        voice={voice}
        onTranscript={vi.fn()}
        disabled
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(voice.start).not.toHaveBeenCalled();
  });

  it("updates aria-label and aria-pressed based on listening state", () => {
    const { rerender } = render(
      <VoiceInputButton
        voice={mockVoice({ listening: false })}
        onTranscript={vi.fn()}
      />,
    );
    let btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("音声入力");
    expect(btn.getAttribute("aria-pressed")).toBe("false");

    rerender(
      <VoiceInputButton
        voice={mockVoice({ listening: true })}
        onTranscript={vi.fn()}
      />,
    );
    btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("音声入力を停止");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows error message when voice.error is set", () => {
    const voice = mockVoice({ error: "テストエラー" });
    render(<VoiceInputButton voice={voice} onTranscript={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toBe("テストエラー");
  });

  it("shows aria-live region when listening", () => {
    const voice = mockVoice({ listening: true });
    render(<VoiceInputButton voice={voice} onTranscript={vi.fn()} />);
    expect(screen.getByText("認識中")).toBeTruthy();
  });
});
```

- [ ] **Step 2: テストが期待どおり失敗することを確認する**

Run:

```bash
cd web && npx vitest run src/components/VoiceInputButton.test.tsx
```

Expected: FAIL。`VoiceInputButton.tsx` が存在しないためモジュール解決エラー。

- [ ] **Step 3: ボタンの最小実装を書く**

`web/src/components/VoiceInputButton.tsx` を次の内容で作成する。

```tsx
"use client";

import { Mic, MicOff } from "lucide-react";
import type { UseVoiceInputReturn } from "@/lib/use-voice-input";

interface VoiceInputButtonProps {
  voice: UseVoiceInputReturn;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function VoiceInputButton({
  voice,
  onTranscript,
  disabled = false,
}: VoiceInputButtonProps) {
  if (!voice.supported) return null;

  const handleClick = () => {
    if (disabled) return;
    if (voice.listening) {
      const text = voice.stop();
      if (text) onTranscript(text);
    } else {
      voice.start();
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={voice.listening ? "音声入力を停止" : "音声入力"}
        aria-pressed={voice.listening}
        disabled={disabled}
        onClick={handleClick}
        className="flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-muted transition-colors hover:bg-accent hover:text-fg disabled:opacity-40"
      >
        {voice.listening ? (
          <MicOff className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      {voice.listening && (
        <span
          aria-live="polite"
          className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-danger"
        >
          認識中
        </span>
      )}
      {voice.error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {voice.error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run:

```bash
cd web && npx vitest run src/components/VoiceInputButton.test.tsx
```

Expected: 全テスト PASS。

- [ ] **Step 5: 型チェックを通す**

Run:

```bash
cd web && npm run typecheck
```

Expected: TypeScript エラーが 0 件。

- [ ] **Step 6: 差分を確認して即コミットする**

Run:

```bash
git status --short
git diff -- web/src/components/VoiceInputButton.tsx web/src/components/VoiceInputButton.test.tsx
git add web/src/components/VoiceInputButton.tsx web/src/components/VoiceInputButton.test.tsx
git commit -m "feat: 音声入力ボタン VoiceInputButton を追加"
git log --oneline -1
```

Expected: コミット出力と最新ログに新しいコミットハッシュが表示される。

---

### Task 3: HomeView への音声入力統合

**Files:**
- Modify: `web/src/components/home/HomeView.tsx`（import 追加、`useVoiceInput` 呼び出し、ツールバーに `VoiceInputButton` 追加）
- Modify: `web/src/components/home/HomeView.test.tsx`（結合テスト追加）

**Interfaces:**
- Consumes: `useVoiceInput`（Task 1）、`VoiceInputButton`（Task 2）、既存の `submitting` state、`setPrompt`、`prompt`、`autoResize`、`textareaRef`
- Produces: 画像添付ボタンの隣にマイクボタンが表示され、認識テキストが入力値末尾に追記される

- [ ] **Step 1: HomeView の既存テストが通っていることを確認する**

Run:

```bash
cd web && npx vitest run src/components/home/HomeView.test.tsx
```

Expected: 既存テストがすべて PASS。

- [ ] **Step 2: HomeView の統合テストを追加する**

`web/src/components/home/HomeView.test.tsx` の末尾（最終 `});` の前）に次のテストブロックを追加する。

```tsx
describe("HomeView voice input", () => {
  let mockRecognition: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    _dispatch: (type: string, ...args: unknown[]) => void;
  };

  beforeEach(() => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    mockRecognition = {
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      addEventListener: vi.fn(
        (type: string, handler: (...args: unknown[]) => void) => {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(handler);
        },
      ),
      removeEventListener: vi.fn(
        (type: string, handler: (...args: unknown[]) => void) => {
          listeners.get(type)?.delete(handler);
        },
      ),
      _dispatch(type: string, ...args: unknown[]) {
        for (const handler of listeners.get(type) ?? []) {
          handler(...args);
        }
      },
    };
    vi.stubGlobal("webkitSpeechRecognition", mockRecognition);
    vi.stubGlobal("SpeechRecognition", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the mic button when SpeechRecognition is supported", async () => {
    render(<HomeView />);
    expect(await screen.findByRole("button", { name: "音声入力" })).toBeTruthy();
  });

  it("appends transcript to the prompt on stop", async () => {
    render(<HomeView />);
    const micBtn = await screen.findByRole("button", { name: "音声入力" });

    // Start listening
    fireEvent.click(micBtn);
    act(() => mockRecognition._dispatch("start"));

    // Simulate final result
    act(() =>
      mockRecognition._dispatch("result", {
        results: [[{ transcript: "hello world", isFinal: true }]],
      }),
    );

    // Stop listening (button label changes)
    fireEvent.click(screen.getByRole("button", { name: "音声入力を停止" }));

    const textarea = screen.getByRole("combobox", {
      name: "タスクの説明",
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("hello world");
  });

  it("disables the mic button while submitting", async () => {
    let rejectRequest: (reason: Error) => void = () => undefined;
    sendJson.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );
    render(<HomeView />);

    const prompt = screen.getByPlaceholderText(
      "タスクを説明してください…（Ctrl+Enter で開始）",
    );
    fireEvent.change(prompt, { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "音声入力" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });

    rejectRequest(new Error("network failed"));
  });
});
```

- [ ] **Step 3: テストが期待どおり失敗することを確認する**

Run:

```bash
cd web && npx vitest run src/components/home/HomeView.test.tsx -t "voice input"
```

Expected: FAIL。`Mic` / `MicOff` が HomeView の lucide-react import に存在しないか、`VoiceInputButton` がツールバーにないため。

- [ ] **Step 4: HomeView に音声入力統合を実装する**

`web/src/components/home/HomeView.tsx` の lucide-react import 行に `Mic`, `MicOff` を追加する。

```tsx
import { ArrowUp, Bot, Cpu, FolderGit2, GitBranch, Mic, MicOff, Paperclip, X } from "lucide-react";
```

関数本体の先頭付近（`const [cursor, setCursor] = useState(0);` の前など）に `useVoiceInput` の import と呼び出しを追加する。

既存の import ブロックに次を追加する。

```tsx
import { useVoiceInput } from "@/lib/use-voice-input";
import { VoiceInputButton } from "@/components/VoiceInputButton";
```

関数本体の state 宣言群の末尾（`const [slashDismissed, setSlashDismissed] = useState(false);` の後など）に次を追加する。

```tsx
const voice = useVoiceInput({ disabled: submitting });
```

`onTranscript` コールバックを定義する（`autoResize` の定義後など）。

```tsx
const onVoiceTranscript = useCallback(
  (text: string) => {
    setPrompt((prev) => {
      const suffix = prev && !prev.endsWith(" ") ? " " : "";
      return prev + suffix + text;
    });
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      autoResize();
    });
  },
  [autoResize],
);
```

ツールバー1段目の画像添付ボタン（`<button aria-label="画像を添付" ...>`）の直後に `VoiceInputButton` を追加する。

```tsx
<VoiceInputButton voice={voice} onTranscript={onVoiceTranscript} disabled={submitting} />
```

- [ ] **Step 5: テストが通ることを確認する**

Run:

```bash
cd web && npx vitest run src/components/home/HomeView.test.tsx
```

Expected: 既存テスト + 新規 voice input テストがすべて PASS。

- [ ] **Step 6: 型チェックを通す**

Run:

```bash
cd web && npm run typecheck
```

Expected: TypeScript エラーが 0 件。

- [ ] **Step 7: 差分を確認して即コミットする**

Run:

```bash
git status --short
git diff -- web/src/components/home/HomeView.tsx web/src/components/home/HomeView.test.tsx
git add web/src/components/home/HomeView.tsx web/src/components/home/HomeView.test.tsx
git commit -m "feat: HomeView に音声入力を統合"
git log --oneline -1
```

Expected: コミット出力と最新ログに新しいコミットハッシュが表示される。

---

### Task 4: TaskView への音声入力統合

**Files:**
- Modify: `web/src/components/task/TaskView.tsx`（import 追加、`useVoiceInput` 呼び出し、ツールバーに `VoiceInputButton` 追加）
- Modify: `web/src/components/task/TaskView.test.tsx`（結合テスト追加）

**Interfaces:**
- Consumes: `useVoiceInput`（Task 1）、`VoiceInputButton`（Task 2）、既存の `composerLocked`、`setInput`、`input`、`textareaRef`
- Produces: 画像添付ボタンの隣にマイクボタンが表示され、認識テキストが入力値末尾に追記される

- [ ] **Step 1: TaskView の既存テストが通っていることを確認する**

Run:

```bash
cd web && npx vitest run src/components/task/TaskView.test.tsx
```

Expected: 既存テストがすべて PASS。

- [ ] **Step 2: TaskView の統合テストを追加する**

`web/src/components/task/TaskView.test.tsx` の末尾（最終 `});` の前）に次のテストブロックを追加する。

```tsx
describe("TaskView voice input", () => {
  let mockRecognition: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    _dispatch: (type: string, ...args: unknown[]) => void;
  };

  beforeEach(() => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    mockRecognition = {
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      addEventListener: vi.fn(
        (type: string, handler: (...args: unknown[]) => void) => {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(handler);
        },
      ),
      removeEventListener: vi.fn(
        (type: string, handler: (...args: unknown[]) => void) => {
          listeners.get(type)?.delete(handler);
        },
      ),
      _dispatch(type: string, ...args: unknown[]) {
        for (const handler of listeners.get(type) ?? []) {
          handler(...args);
        }
      },
    };
    vi.stubGlobal("webkitSpeechRecognition", mockRecognition);
    vi.stubGlobal("SpeechRecognition", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the mic button when SpeechRecognition is supported", async () => {
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    expect(await screen.findByRole("button", { name: "音声入力" })).toBeTruthy();
  });

  it("appends transcript to the input on stop", async () => {
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();
    const micBtn = await screen.findByRole("button", { name: "音声入力" });

    // Start listening
    fireEvent.click(micBtn);
    act(() => mockRecognition._dispatch("start"));

    // Simulate final result
    act(() =>
      mockRecognition._dispatch("result", {
        results: [[{ transcript: "follow up text", isFinal: true }]],
      }),
    );

    // Stop listening
    fireEvent.click(screen.getByRole("button", { name: "音声入力を停止" }));

    const textarea = screen.getByRole("combobox", {
      name: "フォローアップを送信",
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("follow up text");
  });

  it("disables the mic button while composer is locked", async () => {
    taskStatus = "working";
    render(<TaskView taskId="ws1" />);
    await flushTaskLoad();

    const micBtn = await screen.findByRole("button", { name: "音声入力" });
    expect((micBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 3: テストが期待どおり失敗することを確認する**

Run:

```bash
cd web && npx vitest run src/components/task/TaskView.test.tsx -t "voice input"
```

Expected: FAIL。`VoiceInputButton` が TaskView のツールバーにないため。

- [ ] **Step 4: TaskView に音声入力統合を実装する**

`web/src/components/task/TaskView.tsx` の lucide-react import 行に `Mic`, `MicOff` を追加する。

```tsx
import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Cpu,
  FolderTree,
  GitBranch,
  GitGraph,
  ListTodo,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  PanelRight,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
```

既存の import ブロックに次を追加する。

```tsx
import { useVoiceInput } from "@/lib/use-voice-input";
import { VoiceInputButton } from "@/components/VoiceInputButton";
```

関数本体の state 宣言群の末尾（`const [slashDismissed, setSlashDismissed] = useState(false);` の後など）に次を追加する。

```tsx
const voice = useVoiceInput({ disabled: composerLocked });
```

`onTranscript` コールバックを定義する（`restoreToComposer` の定義後など）。

```tsx
const onVoiceTranscript = useCallback(
  (text: string) => {
    setInput((prev) => {
      const suffix = prev && !prev.endsWith(" ") ? " " : "";
      return prev + suffix + text;
    });
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    });
  },
  [],
);
```

ツールバーの画像添付ボタン（`<button aria-label="画像を添付" ...>`）の直後に `VoiceInputButton` を追加する。

```tsx
<VoiceInputButton voice={voice} onTranscript={onVoiceTranscript} disabled={composerLocked} />
```

- [ ] **Step 5: テストが通ることを確認する**

Run:

```bash
cd web && npx vitest run src/components/task/TaskView.test.tsx
```

Expected: 既存テスト + 新規 voice input テストがすべて PASS。

- [ ] **Step 6: 型チェックを通す**

Run:

```bash
cd web && npm run typecheck
```

Expected: TypeScript エラーが 0 件。

- [ ] **Step 7: 差分を確認して即コミットする**

Run:

```bash
git status --short
git diff -- web/src/components/task/TaskView.tsx web/src/components/task/TaskView.test.tsx
git add web/src/components/task/TaskView.tsx web/src/components/task/TaskView.test.tsx
git commit -m "feat: TaskView に音声入力を統合"
git log --oneline -1
```

Expected: コミット出力と最新ログに新しいコミットハッシュが表示される。

---

### Task 5: MEMORY.md へ判断と教訓を記録

**Files:**
- Modify: `MEMORY.md`

**Interfaces:**
- Consumes: Task 1〜4 の実装結果と検証結果
- Produces: 日付付きの作業記録エントリ

- [ ] **Step 1: 現在の MEMORY.md 末尾を再読込する**

Run:

```bash
git status --short && powershell -NoProfile -Command "Get-Content MEMORY.md -Tail 80"
```

Expected: 最新の MEMORY.md 末尾が表示される。

- [ ] **Step 2: MEMORY.md 末尾へ追記する**

既存エントリを変更せず、末尾へ次の内容を追記する。

```markdown
## 2026-07-23 音声入力（Web Speech API）

- やったこと: Home 画面と Task 画面の両 composer に、Web Speech API を用いた音声認識入力を追加した。共通フック `useVoiceInput` が `SpeechRecognition` / `webkitSpeechRecognition` をラップし、共通ボタン `VoiceInputButton` がツールバーに配置される。認識テキストは停止時に composer の入力値末尾に追記される。
- 判断理由: 外部 API 依存を一切持たず、ブラウザネイティブの Web Speech API のみで完結する設計とした。`continuous: true` + `interimResults: false` で確定結果のみを扱い、ユーザーが明示停止するまで認識を継続する。`disabled` 制御は HomeView の `submitting` と TaskView の `composerLocked` をそのまま伝播する。
- 教訓: SpeechRecognition の型定義がブラウザごとに異なるため、`detectSpeechRecognition()` で `window` のプロパティを `unknown` 経由で安全に取得する必要があった。`no-speech` / `aborted` はユーザー操作の中断や無音タイムアウトでありエラー表示しない設計が UX 上適切。`continuous: true` でもブラウザが自動停止することがあるため、`end` イベントで必ず `listening` をリセットする。
- 検証: `use-voice-input.test.ts`（13 テスト）、`VoiceInputButton.test.tsx`（8 テスト）、`HomeView.test.tsx`（既存 + 3 テスト）、`TaskView.test.tsx`（既存 + 3 テスト）、`npm run typecheck` の全 PASS を確認した。
```

- [ ] **Step 3: 差分と秘密情報がないことを確認する**

Run:

```bash
git status --short
git diff -- MEMORY.md
```

Expected: 今回の追記だけが表示され、API キー・トークン・パスワードを含まない。

- [ ] **Step 4: MEMORY.md をコミットする**

Run:

```bash
git add MEMORY.md
git commit -m "docs: 音声入力の実装判断と教訓を記録"
git log --oneline -1
```

Expected: コミット出力と最新ログに新しいコミットハッシュが表示される。

- [ ] **Step 5: 終了チェックを行う**

Run:

```bash
git status --short
```

Expected: 出力が空。出所不明の差分があれば破棄・混在せず、所有者を確認する。

---

## 自己レビュー

### 1. 仕様カバレッジ

| 仕様要件 | 該当タスク |
|---------|-----------|
| Web Speech API のみ使用（依存追加なし） | Task 1（Global Constraints） |
| 機能検出（`SpeechRecognition` / `webkitSpeechRecognition`） | Task 1 Step 3 |
| 未対応ブラウザでボタン非表示 | Task 2 Step 3（`!voice.supported` → `null`） |
| 共通フック `useVoiceInput` | Task 1 |
| 共通ボタン `VoiceInputButton` | Task 2 |
| HomeView 統合 | Task 3 |
| TaskView 統合 | Task 4 |
| `disabled` 制御（`submitting` / `composerLocked`） | Task 3 Step 4、Task 4 Step 4 |
| 認識中に disabled → 自動停止・破棄 | Task 1 Step 3（`useEffect` on `disabled`） |
| 認識テキストを composer 末尾に追記 | Task 3 Step 4、Task 4 Step 4 |
| エラー表示（`not-allowed` 等） | Task 1 Step 3（`ERROR_MESSAGES`） |
| `no-speech` / `aborted` はエラー表示しない | Task 1 Step 3（`SILENT_ERRORS`） |
| アクセシビリティ（`aria-label` / `aria-pressed` / `aria-live` / `role="alert"`） | Task 2 Step 3 |
| クリーンアップ（アンマウント時 `abort()`） | Task 1 Step 3 |
| 全テスト | Task 1〜4 |
| MEMORY 追記 | Task 5 |

### 2. TBD / TODO チェック

- 全コードブロックに実コードが含まれている。プレースホルダー・TBD・TODO はなし。

### 3. 型名整合

- `UseVoiceInputOptions` / `UseVoiceInputReturn` / `VoiceInputButtonProps` は全タスク間で一致。
- `useVoiceInput({ disabled })` の呼び出し形式は Task 3 と Task 4 で同一。
- `onTranscript: (text: string) => void` のシグネチャは Task 2 の props と Task 3/4 のコールバックで一致。
- lucide-react の `Mic` / `MicOff` は Task 2 の実装と Task 3/4 の import 追加で一致。
