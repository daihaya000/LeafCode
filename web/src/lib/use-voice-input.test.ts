import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
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

  it("detects supported browser after mount", () => {
    const { result } = renderHook(() => useVoiceInput());
    // Feature detection runs in useEffect after mount; by the time
    // renderHook returns, the effect has flushed and supported is true.
    expect(result.current.supported).toBe(true);
  });

  it("detects unsupported browser after mount", () => {
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    const { result } = renderHook(() => useVoiceInput());
    expect(result.current.supported).toBe(false);
  });

  it("starts recognition on start()", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    expect(mockRecognition.start).toHaveBeenCalledTimes(1);
  });

  it("starts after React Strict Mode replays the mount cleanup", () => {
    const { result } = renderHook(() => useVoiceInput(), {
      wrapper: StrictMode,
    });

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

  it("stops recognition and resolves transcript on stop()", async () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    // Simulate a final result
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "hello world" }, isFinal: true }],
      }),
    );
    let text = "";
    await act(async () => {
      const p = result.current.stop();
      // stop() waits for the `end` event — fire it so the promise resolves.
      mockRecognition._dispatch("end");
      text = await p;
    });
    expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
    // stop() returns the captured transcript, but clears it for the next session.
    expect(text).toBe("hello world");
    expect(result.current.transcript).toBe("");
  });

  it("does nothing when disabled on start()", () => {
    const { result } = renderHook(() => useVoiceInput({ disabled: true }));
    act(() => result.current.start());
    expect(mockRecognition.start).not.toHaveBeenCalled();
  });

  it("clears transcript after stop() so next session starts fresh (R51#2)", async () => {
    const { result } = renderHook(() => useVoiceInput());
    // First session
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "first session" }, isFinal: true }],
      }),
    );
    await act(async () => {
      const p = result.current.stop();
      mockRecognition._dispatch("end");
      await p;
    });
    expect(result.current.transcript).toBe("");

    // Second session should not contain previous transcript
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "second session" }, isFinal: true }],
      }),
    );
    expect(result.current.transcript).toBe("second session");
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
        resultIndex: 0,
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
    // Realistic cumulative results: each event carries the full list with
    // resultIndex pointing at the newly-finalized entry.
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "first" }, isFinal: true }],
      }),
    );
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 1,
        results: [
          { 0: { transcript: "first" }, isFinal: true },
          { 0: { transcript: "second" }, isFinal: true },
        ],
      }),
    );
    expect(result.current.transcript).toBe("first second");
  });

  // Critical 1 regression: resultIndex must be honored so already-finalized
  // results are not re-appended on subsequent result events.
  it("does not duplicate finalized results across cumulative result events (Critical 1)", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    // 1st event: results=[A], resultIndex=0
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "A" }, isFinal: true }],
      }),
    );
    // 2nd event: results=[A,B], resultIndex=1 (cumulative)
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 1,
        results: [
          { 0: { transcript: "A" }, isFinal: true },
          { 0: { transcript: "B" }, isFinal: true },
        ],
      }),
    );
    expect(result.current.transcript).toBe("A B");
    expect(result.current.transcript).not.toBe("A A B");
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

  it("resets transcript on each start() so stop() returns only current session text", async () => {
    const { result } = renderHook(() => useVoiceInput());

    // Session 1
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "first session" }, isFinal: true }],
      }),
    );
    let text1 = "";
    await act(async () => {
      const p = result.current.stop();
      mockRecognition._dispatch("end");
      text1 = await p;
    });
    expect(text1).toBe("first session");

    // Session 2 — must not include session 1 text
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "second session" }, isFinal: true }],
      }),
    );
    let text2 = "";
    await act(async () => {
      const p = result.current.stop();
      mockRecognition._dispatch("end");
      text2 = await p;
    });
    expect(text2).toBe("second session");
  });

  // Critical 2 regression: stop() must wait for the final `result` that
  // arrives after recognition.stop() is called, then resolve with it.
  it("stop() resolves with the last result that arrives after stop() is called (Critical 2)", async () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    // First finalized chunk before stop.
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "first" }, isFinal: true }],
      }),
    );

    // Call stop() — recognition.stop() is synchronous but the final result
    // + end event arrive asynchronously afterwards.
    let resolved: string | undefined;
    await act(async () => {
      const p = result.current.stop();
      // After stop() was called, the engine finalizes the last utterance and
      // fires a final result event, then end.
      mockRecognition._dispatch("result", {
        resultIndex: 1,
        results: [
          { 0: { transcript: "first" }, isFinal: true },
          { 0: { transcript: "last utterance" }, isFinal: true },
        ],
      });
      mockRecognition._dispatch("end");
      resolved = await p;
    });
    expect(resolved).toBe("first last utterance");
  });

  it("stop() resolves immediately when not listening", async () => {
    const { result } = renderHook(() => useVoiceInput());
    let text = "";
    await act(async () => {
      text = await result.current.stop();
    });
    expect(text).toBe("");
    expect(mockRecognition.stop).not.toHaveBeenCalled();
  });

  it("stops a starting recognition and ignores its late start event", async () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    expect(result.current.busy).toBe(true);

    let pendingStop!: Promise<string>;
    act(() => {
      pendingStop = result.current.stop();
    });
    expect(mockRecognition.stop).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);

    act(() => mockRecognition._dispatch("start"));
    expect(result.current.listening).toBe(false);
    expect(result.current.busy).toBe(true);

    act(() => mockRecognition._dispatch("end"));
    await expect(pendingStop).resolves.toBe("");
    expect(result.current.busy).toBe(false);
  });

  it("makes repeated stop() calls single-flight until end", async () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));

    const first = result.current.stop();
    const second = result.current.stop();

    expect(first).toBe(second);
    expect(mockRecognition.stop).toHaveBeenCalledTimes(1);

    act(() => mockRecognition._dispatch("end"));
    await expect(first).resolves.toBe("");
  });

  it("resolves a pending stop() with an empty string when disabled interrupts it", async () => {
    const { result, rerender } = renderHook(
      (props: { disabled: boolean }) => useVoiceInput(props),
      { initialProps: { disabled: false } },
    );
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));

    const pendingStop = result.current.stop();
    rerender({ disabled: true });

    await expect(pendingStop).resolves.toBe("");
  });

  it("resolves a pending stop() with an empty string when unmounted", async () => {
    const { result, unmount } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));

    const pendingStop = result.current.stop();
    unmount();

    await expect(pendingStop).resolves.toBe("");
  });

  it("settles a pending stop() when recognition reports an error", async () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));

    const pendingStop = result.current.stop();
    act(() => mockRecognition._dispatch("error", { error: "no-speech" }));

    await expect(pendingStop).resolves.toBe("");
  });

  it("settles stop() when recognition.stop() throws", async () => {
    mockRecognition.stop.mockImplementationOnce(() => {
      throw new Error("stop failed");
    });
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));

    await expect(result.current.stop()).resolves.toBe("");
    expect(mockRecognition.abort).toHaveBeenCalledTimes(1);
  });

  it("uses the processed result index when resultIndex is missing", () => {
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
        results: [
          { 0: { transcript: "first" }, isFinal: true },
          { 0: { transcript: "second" }, isFinal: true },
        ],
      }),
    );

    expect(result.current.transcript).toBe("first second");
  });

  it("does not skip a result that changes from non-final to final at the same index", () => {
    const { result } = renderHook(() => useVoiceInput());
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "draft" }, isFinal: false }],
      }),
    );
    expect(result.current.transcript).toBe("");

    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "final text" }, isFinal: true }],
      }),
    );

    expect(result.current.transcript).toBe("final text");
  });

  // Important 3 regression: a late result event arriving after the session
  // was interrupted by disabled must not revive the transcript.
  it("drops late result events after disabled-interrupt so transcript stays empty (Important 3)", () => {
    const { result, rerender } = renderHook(
      (props: { disabled: boolean }) => useVoiceInput(props),
      { initialProps: { disabled: false } },
    );
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "discard me" }, isFinal: true }],
      }),
    );
    rerender({ disabled: true });
    expect(result.current.transcript).toBe("");
    expect(result.current.busy).toBe(true);
    // Late result arrives after the interrupt — must be ignored.
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 1,
        results: [
          { 0: { transcript: "discard me" }, isFinal: true },
          { 0: { transcript: "late arrival" }, isFinal: true },
        ],
      }),
    );
    expect(result.current.transcript).toBe("");
    act(() => mockRecognition._dispatch("end"));
    expect(result.current.busy).toBe(false);
  });

  it("waits for an interrupted session end before starting another session", () => {
    const { result, rerender } = renderHook(
      (props: { disabled: boolean }) => useVoiceInput(props),
      { initialProps: { disabled: false } },
    );
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    rerender({ disabled: true });
    rerender({ disabled: false });

    // A new start request before A's end is ignored. A's delayed events
    // therefore cannot be mistaken for a new B session.
    act(() => result.current.start());
    expect(mockRecognition.start).toHaveBeenCalledTimes(1);
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "stale A result" }, isFinal: true }],
      }),
    );
    act(() => mockRecognition._dispatch("end"));
    expect(result.current.transcript).toBe("");
    expect(result.current.listening).toBe(false);

    // Only after A's end may B start and update state.
    act(() => result.current.start());
    act(() => mockRecognition._dispatch("start"));
    act(() =>
      mockRecognition._dispatch("result", {
        resultIndex: 0,
        results: [{ 0: { transcript: "B result" }, isFinal: true }],
      }),
    );
    expect(mockRecognition.start).toHaveBeenCalledTimes(2);
    expect(result.current.transcript).toBe("B result");
    expect(result.current.listening).toBe(true);
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
