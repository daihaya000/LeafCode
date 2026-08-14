import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextTaskSuggest } from "./NextTaskSuggest";

const { sendJson } = vi.hoisted(() => ({ sendJson: vi.fn() }));

vi.mock("@/lib/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client")>()),
  sendJson,
}));

const GENERATE = "次のタスクを提案";

beforeEach(() => {
  sendJson.mockResolvedValue({
    suggestion: "提案A",
    suggestions: ["提案A", "提案B"],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NextTaskSuggest", () => {
  it("posts to the project-scoped endpoint with the composer model and agent", async () => {
    render(
      <NextTaskSuggest
        projectId="project-1"
        model="openai::gpt-5"
        agent="build"
        onApply={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/projects/project-1/next-task",
        expect.objectContaining({
          count: 3,
          model: { providerID: "openai", modelID: "gpt-5" },
          agent: "build",
        }),
        undefined,
        expect.objectContaining({ timeoutMs: expect.any(Number) }),
      ),
    );
    // Initial generation must not send an exclusion list.
    const [, , body] = sendJson.mock.calls[0]!;
    expect(body.previousSuggestions).toBeUndefined();
  });

  it("renders every returned suggestion and applies the clicked one", async () => {
    const onApply = vi.fn();
    render(<NextTaskSuggest projectId="project-1" onApply={onApply} />);

    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    expect(await screen.findByRole("button", { name: /提案A/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /提案B/ }));
    expect(onApply).toHaveBeenCalledWith("提案B");
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("sends previously shown suggestions on regeneration", async () => {
    render(<NextTaskSuggest projectId="project-1" onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    const again = await screen.findByRole("button", { name: "別の提案を生成" });
    sendJson.mockResolvedValueOnce({ suggestions: ["提案C"] });
    fireEvent.click(again);

    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(2));
    const [, , body] = sendJson.mock.calls[1]!;
    expect(body.previousSuggestions).toEqual(["提案A", "提案B"]);
  });

  it("shows a fixed message on failure without leaking the server error", async () => {
    sendJson.mockRejectedValueOnce(new Error("internal path /etc/secret"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<NextTaskSuggest projectId="project-1" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("提案の生成に失敗しました。");
    expect(alert.textContent).not.toContain("/etc/secret");
    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
    warn.mockRestore();
  });

  it("treats an empty suggestion list as a failure", async () => {
    sendJson.mockResolvedValueOnce({ suggestions: [] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<NextTaskSuggest projectId="project-1" onApply={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "提案の生成に失敗しました。",
    );
    warn.mockRestore();
  });

  it("disables generation without a project or when disabled", () => {
    const { rerender } = render(
      <NextTaskSuggest projectId="" onApply={vi.fn()} />,
    );
    expect(
      (screen.getByRole("button", { name: GENERATE }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    rerender(<NextTaskSuggest projectId="project-1" disabled onApply={vi.fn()} />);
    expect(
      (screen.getByRole("button", { name: GENERATE }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(sendJson).not.toHaveBeenCalled();
  });

  it("clears suggestions when the selected project changes", async () => {
    const { rerender } = render(
      <NextTaskSuggest projectId="project-1" onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: GENERATE }));
    expect(await screen.findByRole("button", { name: /提案A/ })).toBeTruthy();

    rerender(<NextTaskSuggest projectId="project-2" onApply={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /提案A/ })).toBeNull();
    expect(screen.getByRole("button", { name: GENERATE })).toBeTruthy();

    // The exclusion list belongs to the old repository and must not leak.
    fireEvent.click(screen.getByRole("button", { name: GENERATE }));
    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(2));
    const [, path, body] = sendJson.mock.calls[1]!;
    expect(path).toBe("/api/projects/project-2/next-task");
    expect(body.previousSuggestions).toBeUndefined();
  });

  it("hides the suggestion list when dismissed", async () => {
    render(<NextTaskSuggest projectId="project-1" onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: GENERATE }));
    expect(await screen.findByRole("button", { name: /提案A/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "提案を閉じる" }));

    expect(screen.queryByRole("button", { name: /提案A/ })).toBeNull();
    expect(screen.getByRole("button", { name: GENERATE })).toBeTruthy();
  });

  it("ignores a response that resolves after unmount", async () => {
    let release!: (value: unknown) => void;
    sendJson.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(
      <NextTaskSuggest projectId="project-1" onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: GENERATE }));

    unmount();
    release({ suggestions: ["提案A"] });
    await Promise.resolve();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
