import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { GlobalAttentionProvider, useGlobalAttention } from "./GlobalAttentionProvider";
import type { AttentionItem } from "@/lib/attention";

const TestConsumer = ({ onItems }: { onItems: (items: AttentionItem[]) => void }) => {
  const { items, openNext } = useGlobalAttention();
  onItems(items);
  return <button onClick={openNext}>open</button>;
};

describe("GlobalAttentionProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", class {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      close = vi.fn();
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("provides an empty queue initially", () => {
    render(
      <GlobalAttentionProvider activeScope={null}>
        <TestConsumer onItems={(items) => expect(items).toEqual([])} />
      </GlobalAttentionProvider>,
    );
  });
});
