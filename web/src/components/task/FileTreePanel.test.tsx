import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTreePanel } from "./FileTreePanel";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));

vi.mock("@/lib/client", () => ({ getJson }));

describe("FileTreePanel", () => {
  beforeEach(() => getJson.mockReset());
  afterEach(() => cleanup());

  it("explains an empty folder and disables going above the root", async () => {
    getJson.mockResolvedValue({ entries: [] });
    render(<FileTreePanel root={"C:\\"} />);

    expect((await screen.findByRole("status")).textContent).toContain("項目がありません");
    expect((screen.getByRole("button", { name: "上へ" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("shows and opens returned files and folders", async () => {
    getJson.mockResolvedValue({
      entries: [
        { name: "src", path: "C:\\repo\\src", kind: "dir" },
        { name: "README.md", path: "C:\\repo\\README.md", kind: "file" },
      ],
    });
    const onFile = vi.fn();
    render(<FileTreePanel root="C:\\repo" onFile={onFile} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "README.md" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    expect(onFile).toHaveBeenCalledWith("C:\\repo\\README.md");
    fireEvent.click(screen.getByRole("button", { name: "src" }));
    expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", {
      path: "C:\\repo\\src",
      files: "1",
    });
  });

  it("ignores a directory response that resolves after unmount", async () => {
    let resolveLoad!: (value: { entries: [] }) => void;
    const pending = new Promise<{ entries: [] }>((resolve) => {
      resolveLoad = resolve;
    });
    getJson.mockReturnValue(pending);
    const { unmount } = render(<FileTreePanel root="C:\\repo" />);

    await waitFor(() => expect(getJson).toHaveBeenCalled());
    unmount();
    await act(async () => {
      resolveLoad({ entries: [] });
      await Promise.resolve();
    });
    expect(getJson).toHaveBeenCalled();
  });
});
