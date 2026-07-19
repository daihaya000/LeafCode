import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GlobalAttentionProvider, useGlobalAttention } from "./GlobalAttentionProvider";
import type { AttentionItem } from "@/lib/attention";

const TestConsumer = ({ onItems }: { onItems: (items: AttentionItem[]) => void }) => {
  const { items, open, openNext, setOpen } = useGlobalAttention();
  onItems(items);
  return (
    <>
      <input aria-label="composer" />
      <output data-testid="open-state">{open ? "open" : "closed"}</output>
      <button onClick={openNext}>open</button>
      <button onClick={() => setOpen(false)}>close</button>
    </>
  );
};

class FakeEventSource {
  static latest: FakeEventSource | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor() {
    FakeEventSource.latest = this;
  }
}

function emitQuestion(id = "q1") {
  act(() => {
    FakeEventSource.latest?.onmessage?.({
      data: JSON.stringify({
        type: "question.asked",
        directory: "/repo",
        properties: { id, sessionID: "session-1", questions: [] },
      }),
    } as MessageEvent);
  });
}

describe("GlobalAttentionProvider", () => {
  beforeEach(() => {
    FakeEventSource.latest = null;
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("provides an empty queue initially", () => {
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={(items) => expect(items).toEqual([])} />
      </GlobalAttentionProvider>,
    );
  });

  it("opens after focus leaves an input that deferred auto-open", async () => {
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={() => undefined} />
      </GlobalAttentionProvider>,
    );
    const composer = screen.getByRole("textbox", { name: "composer" });
    composer.focus();

    emitQuestion();
    expect(screen.getByTestId("open-state").textContent).toBe("closed");

    composer.blur();
    fireEvent.focusOut(composer);
    await waitFor(() => expect(screen.getByTestId("open-state").textContent).toBe("open"));
  });

  it("does not reopen a manually closed queue on later focus changes", async () => {
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={() => undefined} />
      </GlobalAttentionProvider>,
    );
    emitQuestion();
    await waitFor(() => expect(screen.getByTestId("open-state").textContent).toBe("open"));
    fireEvent.click(screen.getByRole("button", { name: "close" }));

    const composer = screen.getByRole("textbox", { name: "composer" });
    composer.focus();
    composer.blur();
    fireEvent.focusOut(composer);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("open-state").textContent).toBe("closed");
  });
});
