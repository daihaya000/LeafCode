import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
