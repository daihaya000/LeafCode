import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceInputButton } from "./VoiceInputButton";
import type { UseVoiceInputReturn } from "@/lib/use-voice-input";

function mockVoice(overrides: Partial<UseVoiceInputReturn> = {}): UseVoiceInputReturn {
  return {
    supported: true,
    listening: false,
    start: vi.fn(),
    stop: vi.fn(() => Promise.resolve("")),
    transcript: "",
    error: null,
    clearError: vi.fn(),
    ...overrides,
    busy: overrides.busy ?? false,
  };
}

describe("VoiceInputButton", () => {
  const originalUserAgent = window.navigator.userAgent;

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(window.navigator, "userAgent", {
      value: originalUserAgent,
      configurable: true,
    });
    delete (window.navigator as Navigator & { brave?: unknown }).brave;
  });

  function mockUserAgent(userAgent: string) {
    Object.defineProperty(window.navigator, "userAgent", {
      value: userAgent,
      configurable: true,
    });
  }

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

  it("calls voice.stop() and onTranscript on click when listening", async () => {
    const voice = mockVoice({
      listening: true,
      stop: vi.fn(() => Promise.resolve("hello")),
    });
    const onTranscript = vi.fn();
    render(
      <VoiceInputButton voice={voice} onTranscript={onTranscript} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(voice.stop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("hello"));
  });

  it("calls onTranscript with empty string when voice.stop() resolves with empty string", async () => {
    const voice = mockVoice({ listening: true });
    const onTranscript = vi.fn();
    render(
      <VoiceInputButton voice={voice} onTranscript={onTranscript} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(voice.stop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith(""));
  });

  it("submits a resolved stop transcript only once while stopping", async () => {
    let resolveStop!: (text: string) => void;
    const voice = mockVoice({
      listening: true,
      stop: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveStop = resolve;
          }),
      ),
    });
    const onTranscript = vi.fn();
    render(
      <VoiceInputButton voice={voice} onTranscript={onTranscript} />,
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);

    expect(voice.stop).toHaveBeenCalledTimes(1);
    act(() => resolveStop("hello"));
    await waitFor(() => expect(onTranscript).toHaveBeenCalledTimes(1));
    expect(onTranscript).toHaveBeenCalledWith("hello");
  });

  it("shows a retryable error when stopping voice input fails", async () => {
    const voice = mockVoice({
      listening: true,
      stop: vi.fn(() => Promise.reject(new Error("停止に失敗しました"))),
    });
    render(<VoiceInputButton voice={voice} onTranscript={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "音声入力を停止" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "停止に失敗しました",
    );
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
    expect(btn.hasAttribute("disabled")).toBe(true);
    fireEvent.click(btn);
    expect(voice.start).not.toHaveBeenCalled();
  });

  it("is disabled and exposes aria-busy while the voice session is busy", () => {
    const voice = mockVoice({ busy: true });
    render(<VoiceInputButton voice={voice} onTranscript={vi.fn()} />);

    const button = screen.getByRole("button");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
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

  it("uses Windows voice input on Brave for Windows", async () => {
    mockUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    );
    Object.defineProperty(window.navigator, "brave", {
      value: {},
      configurable: true,
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }))));
    vi.stubGlobal("fetch", fetchMock);
    const onNativeVoiceStart = vi.fn();
    const voice = mockVoice();

    render(
      <VoiceInputButton
        voice={voice}
        onTranscript={vi.fn()}
        onNativeVoiceStart={onNativeVoiceStart}
      />,
    );

    const button = await screen.findByRole("button", { name: "Windows 音声入力" });
    fireEvent.click(button);

    expect(onNativeVoiceStart).toHaveBeenCalled();
    expect(voice.start).not.toHaveBeenCalled();
    await waitFor(() => {
      const [input, init] = (fetchMock.mock.calls as unknown as Array<[
        RequestInfo | URL,
        RequestInit | undefined,
      ]>)[0] ?? [];
      expect(input).toBe("/api/host/voice-input");
      expect(init).toEqual(expect.objectContaining({ method: "POST" }));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
    expect(onNativeVoiceStart).toHaveBeenCalledTimes(2);
  });

  it("does not start two native voice requests before the first settles", async () => {
    mockUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36");
    Object.defineProperty(window.navigator, "brave", {
      value: {},
      configurable: true,
    });
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceInputButton voice={mockVoice()} onTranscript={vi.fn()} />);

    const button = await screen.findByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => resolveFetch(new Response(JSON.stringify({ ok: true }))));
  });

  it("releases the native voice button when the host request times out", async () => {
    mockUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36");
    Object.defineProperty(window.navigator, "brave", {
      value: {},
      configurable: true,
    });
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VoiceInputButton voice={mockVoice()} onTranscript={vi.fn()} />);

    const button = await screen.findByRole("button", { name: /Windows/ });
    vi.useFakeTimers();
    fireEvent.click(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(button.getAttribute("aria-busy")).toBe("false");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("timed out");
  });

  it("does not submit a stop transcript after unmount", async () => {
    let resolveStop!: (text: string) => void;
    const voice = mockVoice({
      listening: true,
      stop: vi.fn(
        () => new Promise<string>((resolve) => {
          resolveStop = resolve;
        }),
      ),
    });
    const onTranscript = vi.fn();
    const { unmount } = render(
      <VoiceInputButton voice={voice} onTranscript={onTranscript} />,
    );

    fireEvent.click(screen.getByRole("button"));
    unmount();
    act(() => resolveStop("late transcript"));

    await waitFor(() => expect(onTranscript).not.toHaveBeenCalled());
  });

  it("keeps Web Speech mode on smartphones", async () => {
    mockUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
    );
    const voice = mockVoice();
    render(<VoiceInputButton voice={voice} onTranscript={vi.fn()} />);

    const button = await screen.findByRole("button", { name: "音声入力" });
    fireEvent.click(button);

    expect(voice.start).toHaveBeenCalledTimes(1);
  });
});
