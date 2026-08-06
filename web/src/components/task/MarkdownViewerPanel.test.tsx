import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectMarkdownFiles,
  MarkdownViewerPanel,
} from "./MarkdownViewerPanel";
import type { MessageWithParts } from "@/lib/types";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));

vi.mock("@/lib/client", () => ({ getJson }));

vi.mock("./Markdown", () => ({
  Markdown: ({ text }: { text: string }) => (
    <div data-testid="md-content">{text}</div>
  ),
}));

function msg(
  id: string,
  role: "user" | "assistant",
  parts: MessageWithParts["parts"],
): MessageWithParts {
  return {
    info: { id, role },
    parts,
  };
}

describe("collectMarkdownFiles", () => {
  it("collects assistant file/text parts that reference absolute .md paths", () => {
    const messages: MessageWithParts[] = [
      msg("u1", "user", [{ id: "p0", messageID: "u1", type: "text", text: "hi" }]),
      msg(
        "a1",
        "assistant",
        [{ id: "p1", messageID: "a1", type: "file", filename: "C:\\repo\\plan.md" }],
      ),
      msg(
        "a2",
        "assistant",
        [
          {
            id: "p2",
            messageID: "a2",
            type: "text",
            text: "/repo/report.md",
          },
        ],
      ),
    ];
    const entries = collectMarkdownFiles(messages);
    expect(entries.map((e) => e.path)).toEqual([
      "C:\\repo\\plan.md",
      "/repo/report.md",
    ]);
  });

  it("skips image attachments and relative paths", () => {
    const messages: MessageWithParts[] = [
      msg(
        "a1",
        "assistant",
        [
          {
            id: "p1",
            messageID: "a1",
            type: "file",
            filename: "relative.md",
            mime: "image/png",
            url: "data:image/png;base64,AA",
          },
          { id: "p2", messageID: "a1", type: "text", text: "see relative.md" },
        ],
      ),
    ];
    expect(collectMarkdownFiles(messages)).toEqual([]);
  });

  it("dedupes the same path seen across parts", () => {
    const messages: MessageWithParts[] = [
      msg(
        "a1",
        "assistant",
        [
          { id: "p1", messageID: "a1", type: "file", filename: "/repo/plan.md" },
          { id: "p2", messageID: "a1", type: "text", text: "/repo/plan.md" },
        ],
      ),
      msg("a2", "assistant", [
        { id: "p3", messageID: "a2", type: "file", filename: "/repo/plan.md" },
      ]),
    ];
    expect(collectMarkdownFiles(messages)).toHaveLength(1);
  });
});

describe("MarkdownViewerPanel", () => {
  beforeEach(() => getJson.mockReset());
  afterEach(() => cleanup());

  it("shows an empty state when the session has no Markdown submissions", () => {
    render(<MarkdownViewerPanel directory="/repo" messages={[]} />);
    expect(
      screen.getByText("エージェントが提出した Markdown ファイルはありません"),
    ).toBeTruthy();
    expect(getJson).not.toHaveBeenCalled();
  });

  it("auto-selects the first entry and renders its content", async () => {
    getJson.mockResolvedValue({ name: "plan.md", content: "# Plan\n" });
    const messages: MessageWithParts[] = [
      msg(
        "a1",
        "assistant",
        [{ id: "p1", messageID: "a1", type: "file", filename: "/repo/plan.md" }],
      ),
    ];
    render(<MarkdownViewerPanel directory="/repo" messages={messages} />);

    await waitFor(() =>
      expect(screen.getByTestId("md-content").textContent).toBe("# Plan\n"),
    );
    expect(getJson).toHaveBeenCalledWith("/api/files/content", {
      directory: "/repo",
      path: "/repo/plan.md",
    });
  });

  it("switches to another file on click", async () => {
    getJson
      .mockResolvedValueOnce({ name: "plan.md", content: "# Plan\n" })
      .mockResolvedValueOnce({ name: "report.md", content: "# Report\n" });
    const messages: MessageWithParts[] = [
      msg(
        "a1",
        "assistant",
        [{ id: "p1", messageID: "a1", type: "file", filename: "/repo/plan.md" }],
      ),
      msg(
        "a2",
        "assistant",
        [{ id: "p2", messageID: "a2", type: "text", text: "/repo/report.md" }],
      ),
    ];
    render(<MarkdownViewerPanel directory="/repo" messages={messages} />);

    await waitFor(() =>
      expect(screen.getByTestId("md-content").textContent).toBe("# Plan\n"),
    );
    fireEvent.click(screen.getByRole("button", { name: "report.md" }));
    await waitFor(() =>
      expect(screen.getByTestId("md-content").textContent).toBe("# Report\n"),
    );
  });

  it("shows an error and retry button when content fetch fails", async () => {
    getJson.mockRejectedValueOnce(new Error("boom"));
    const messages: MessageWithParts[] = [
      msg(
        "a1",
        "assistant",
        [{ id: "p1", messageID: "a1", type: "file", filename: "/repo/plan.md" }],
      ),
    ];
    render(<MarkdownViewerPanel directory="/repo" messages={messages} />);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("読み込めませんでした"),
    );
    const list = screen.getAllByRole("button", { name: /再試行/ });
    fireEvent.click(list[0]!);
    expect(getJson).toHaveBeenCalledTimes(2);
  });
});