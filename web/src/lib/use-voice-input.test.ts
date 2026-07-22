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
    // Wrap the mock in a constructor so `new Ctor()` works.
    function MockCtor() {
      return mockRecognition;
    }
    vi.stubGlobal("webkitSpeechRecognition", MockCtor);
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
        results: [{ 0: { transcript: "hello world" }, isFinal: true }],
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
        results: [{ 0: { transcript: "discard me" }, isFinal: true }],
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
        results: [{ 0: { transcript: "first" }, isFinal: true }],
      }),
    );
    act(() =>
      mockRecognition._dispatch("result", {
        results: [{ 0: { transcript: "second" }, isFinal: true }],
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
