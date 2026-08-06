import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectMarkdownEntries,
  MarkdownViewerPanel,
} from "./MarkdownViewerPanel";
import type { MessageWithParts, Part } from "@/lib/types";

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

function textPart(id: string, messageID: string, text: string): Part {
  return { id, messageID, type: "text", text };
}

function filePart(id: string, messageID: string, filename: string): Part {
  return { id, messageID, type: "file", filename };
}

describe("collectMarkdownEntries", () => {
  it("collects assistant file/text parts that reference absolute .md paths", () => {
    const messages: MessageWithParts[] = [
      msg("u1", "user", [textPart("p0", "u1", "hi")]),
      msg("a1", "assistant", [filePart("p1", "a1", "C:\\repo\\plan.md")]),
      msg("a2", "assistant", [textPart("p2", "a2", "/repo/report.md")]),
    ];
    const entries = collectMarkdownEntries(messages);
    expect(entries.map((e) => (e.kind === "file" ? e.path : e.text))).toEqual([
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
          textPart("p2", "a1", "see relative.md"),
        ],
      ),
    ];
    expect(collectMarkdownEntries(messages)).toEqual([]);
  });

  it("dedupes the same path seen across parts", () => {
    const messages: MessageWithParts[] = [
      msg(
        "a1",
        "assistant",
        [
          filePart("p1", "a1", "/repo/plan.md"),
          textPart("p2", "a1", "/repo/plan.md"),
        ],
      ),
      msg("a2", "assistant", [filePart("p3", "a2", "/repo/plan.md")]),
    ];
    expect(collectMarkdownEntries(messages)).toHaveLength(1);
  });

  it("collects assistant text parts that look like Markdown", () => {
    const messages: MessageWithParts[] = [
      msg(
        "a1",
        "assistant",
        [
          textPart("p1", "a1", "# Summary\n\nThis is a report.\n\n- item 1\n- item 2"),
        ],
      ),
    ];
    const entries = collectMarkdownEntries(messages);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("text");
    expect((entries[0] as { text: string }).text).toContain("# Summary");
  });

  it("ignores plain assistant text without Markdown syntax", () => {
    const messages: MessageWithParts[] = [
      msg("a1", "assistant", [textPart("p1", "a1", " plain sentence ")]),
    ];
    expect(collectMarkdownEntries(messages)).toEqual([]);
  });

  it("orders files before inline message Markdown", () => {
    const messages: MessageWithParts[] = [
      msg("a1", "assistant", [textPart("p1", "a1", "# Inline")]),
      msg("a2", "assistant", [filePart("p2", "a2", "/repo/plan.md")]),
    ];
    const entries = collectMarkdownEntries(messages);
    expect(entries[0]!.kind).toBe("file");
    expect(entries[1]!.kind).toBe("text");
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
      msg("a1", "assistant", [filePart("p1", "a1", "/repo/plan.md")]),
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
      msg("a1", "assistant", [filePart("p1", "a1", "/repo/plan.md")]),
      msg("a2", "assistant", [textPart("p2", "a2", "/repo/report.md")]),
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
      msg("a1", "assistant", [filePart("p1", "a1", "/repo/plan.md")]),
    ];
    render(<MarkdownViewerPanel directory="/repo" messages={messages} />);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("読み込めませんでした"),
    );
    const list = screen.getAllByRole("button", { name: /再試行/ });
    fireEvent.click(list[0]!);
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("renders an inline Markdown text entry without calling /api/files/content", async () => {
    const messages: MessageWithParts[] = [
      msg("a1", "assistant", [
        textPart("p1", "a1", "# Inline Report\n\nSome details."),
      ]),
    ];
    render(<MarkdownViewerPanel directory="/repo" messages={messages} />);

    await waitFor(() =>
      expect(screen.getByTestId("md-content").textContent).toBe(
        "# Inline Report\n\nSome details.",
      ),
    );
    expect(getJson).not.toHaveBeenCalled();
  });

  it("shows text entries in the list with a MessageSquare icon", () => {
    const messages: MessageWithParts[] = [
      msg("a1", "assistant", [
        textPart("p1", "a1", "# Inline Report\n\nSome details."),
      ]),
    ];
    render(<MarkdownViewerPanel directory="/repo" messages={messages} />);

    expect(
      screen.getByRole("button", { name: /メッセージ #1/ }),
    ).toBeTruthy();
  });
});
