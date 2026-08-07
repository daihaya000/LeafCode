import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import type { Part } from "@/lib/types";

vi.mock("./NestedAgentPanel", () => ({
  NestedAgentPanel: ({ active }: { active: boolean }) => (
    <div data-testid="nested-agent-panel">{active ? "active" : "inactive"}</div>
  ),
}));

import { PartView } from "./PartView";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function filePart(overrides: Partial<Part> = {}): Part {
  return {
    id: "p1",
    messageID: "m1",
    type: "file",
    ...overrides,
  };
}

describe("PartView file attachments", () => {
  it("renders an image thumbnail for an image attachment instead of a filename chip", () => {
    const part = filePart({
      filename: "image.png",
      mime: "image/png",
      url: "data:image/png;base64,iVBORw0KGgo=",
    });
    render(<PartView part={part} role="user" />);

    const img = screen.getByAltText("image.png") as HTMLImageElement;
    expect(img.src).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(screen.queryByText("image.png")).toBeNull();
  });

  it("right-aligns sent image thumbnails", () => {
    const part = filePart({
      filename: "sent.png",
      mime: "image/png",
      url: "data:image/png;base64,iVBORw0KGgo=",
    });
    render(<PartView part={part} role="user" />);

    expect(screen.getByLabelText("sent.png を拡大表示").className).toContain(
      "ml-auto",
    );
  });

  it("expands the image into a lightbox on click and closes on Escape", () => {
    const part = filePart({
      filename: "photo.jpg",
      mime: "image/jpeg",
      url: "data:image/jpeg;base64,/9j/4AAQ",
    });
    render(<PartView part={part} role="user" />);

    fireEvent.click(screen.getByLabelText("photo.jpg を拡大表示"));
    expect(screen.getByRole("dialog", { name: "photo.jpg" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps focus inside the lightbox and restores it to the thumbnail", () => {
    const part = filePart({
      filename: "focus.jpg",
      mime: "image/jpeg",
      url: "data:image/jpeg;base64,/9j/4AAQ",
    });
    render(<PartView part={part} role="user" />);

    const thumbnail = screen.getByLabelText("focus.jpg を拡大表示") as HTMLElement;
    thumbnail.focus();
    fireEvent.click(thumbnail);

    const dialog = screen.getByRole("dialog", { name: "focus.jpg" });
    const close = screen.getByRole("button", { name: "閉じる" });
    expect(close.className).toContain("h-11");
    expect(close.className).toContain("w-11");
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(thumbnail);
    expect(dialog).not.toBe(document.activeElement);
  });

  it("falls back to a filename chip for non-image file attachments", () => {
    const onFileClick = vi.fn();
    const part = filePart({ filename: "notes.txt", mime: "text/plain" });
    render(<PartView part={part} role="user" onFileClick={onFileClick} />);

    const chip = screen.getByText("notes.txt");
    fireEvent.click(chip);
    expect(onFileClick).toHaveBeenCalledWith("notes.txt");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("falls back to a filename chip when an image part has no url", () => {
    const part = filePart({ filename: "pending.png", mime: "image/png" });
    render(<PartView part={part} role="user" />);
    expect(screen.getByText("pending.png")).toBeTruthy();
  });
});

describe("PartView error display", () => {
  it("always shows error content when status is error", () => {
    const part: Part = {
      id: "p1",
      messageID: "m1",
      type: "tool",
      tool: "bash",
      state: {
        status: "error",
        error: "Command failed with exit code 1",
        input: {},
        output: "",
      },
    };
    render(<PartView part={part} role="assistant" />);

    expect(screen.getByText(/Command failed with exit code 1/)).toBeTruthy();
  });

  it("shows schema error content when status is error and output is present", () => {
    const part: Part = {
      id: "p2",
      messageID: "m2",
      type: "tool",
      tool: "question",
      state: {
        status: "error",
        error: "schema validation failed: missing 'questions' field",
        input: {},
        output: "",
      },
    };
    render(<PartView part={part} role="assistant" />);

    expect(screen.getByText(/schema validation failed/, { selector: "pre" })).toBeTruthy();
  });
});

describe("PartView cancelled tool display", () => {
  it("shows a neutral cancellation state without the original failure text", () => {
    const part: Part = {
      id: "p3",
      messageID: "m3",
      type: "tool",
      tool: "bash",
      state: {
        status: "cancelled",
        error: "Tool execution cancelled",
        input: { command: "sleep 10" },
      },
    };
    render(<PartView part={part} role="assistant" />);

    expect(screen.getAllByText("中断されました").length).toBeGreaterThan(0);
    expect(screen.queryByText("Tool execution cancelled")).toBeNull();
    expect(screen.getByRole("button").parentElement?.className).not.toContain(
      "border-danger/40",
    );
    expect(screen.getByRole("button").querySelector(".text-danger")).toBeNull();
  });

  it("keeps a cancelled sub-agent as a terminal nested panel", () => {
    const part: Part = {
      id: "p4",
      messageID: "m4",
      type: "tool",
      tool: "task",
      callID: "call-4",
      state: { status: "cancelled", input: { description: "調査" } },
    };
    render(
      <PartView
        part={part}
        role="assistant"
        directory="C:/repo"
        rootSessionId="session-4"
      />,
    );

    expect(screen.getByTestId("nested-agent-panel").textContent).toBe("active");
  });
});

describe("PartView memory injection hiding", () => {
  it("strips the leading workspace-memory block from a user message", () => {
    const part: Part = {
      id: "p-mem",
      messageID: "m-mem",
      type: "text",
      text: "<workspace-memory>\n- [fact] secret context\n</workspace-memory>\nWhat is step one?",
    };
    render(<PartView part={part} role="user" />);
    expect(screen.queryByText(/workspace-memory/)).toBeNull();
    expect(screen.queryByText(/secret context/)).toBeNull();
    expect(screen.getByText("What is step one?")).toBeTruthy();
  });

  it("returns nothing when the user text is only the memory block", () => {
    const part: Part = {
      id: "p-mem2",
      messageID: "m-mem2",
      type: "text",
      text: "<workspace-memory>\n- [fact] only context\n</workspace-memory>",
    };
    render(<PartView part={part} role="user" />);
    expect(screen.queryByText(/workspace-memory/)).toBeNull();
    expect(screen.queryByText(/only context/)).toBeNull();
  });

  it("keeps a user message with no memory block unchanged", () => {
    const part: Part = {
      id: "p-mem3",
      messageID: "m-mem3",
      type: "text",
      text: "plain user question",
    };
    render(<PartView part={part} role="user" />);
    expect(screen.getByText("plain user question")).toBeTruthy();
  });
});

describe("PartView long-running tool display", () => {
  it("warns when a shell tool has run for the configured five-minute threshold", () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-08-01T00:00:00Z").getTime();
    vi.setSystemTime(startedAt);
    const part: Part = {
      id: "p5",
      messageID: "m5",
      type: "tool",
      tool: "bash",
      state: {
        status: "running",
        input: { command: "npx debug-agent" },
        time: { start: startedAt },
      },
    };

    render(<PartView part={part} role="assistant" />);
    expect(screen.queryByTestId("long-running-tool-warning")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(300_000);
    });

    expect(screen.getByTestId("long-running-tool-warning").textContent).toContain(
      "ハングの可能性があります",
    );
  });
});
