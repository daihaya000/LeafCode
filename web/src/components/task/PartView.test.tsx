import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Part } from "@/lib/types";
import { PartView } from "./PartView";

afterEach(() => cleanup());

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
