import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeView } from "./HomeView";

const { getJson, sendJson, push } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/client", () => ({ getJson, sendJson }));
vi.mock("@/lib/events", () => ({ notifyTasksChanged: vi.fn() }));
vi.mock("@/lib/access-mode", () => ({
  ACCESS_MODE_OPTIONS: [
    { value: "ask", label: "確認する", title: "" },
    { value: "full", label: "フルアクセス", title: "" },
  ],
  readAccessMode: () => "ask",
  writeAccessMode: vi.fn(),
}));
vi.mock("@/lib/default-model", () => ({ readDefaultModel: () => "" }));

describe("HomeView image attachments", () => {
  beforeEach(() => {
    getJson.mockImplementation((path: string) => {
      if (path === "/api/projects") {
        return Promise.resolve({
          projects: [
            {
              id: "project-1",
              name: "Project",
              rootPath: "/repo",
              favorite: false,
            },
          ],
        });
      }
      if (path === "/api/tasks") return Promise.resolve({ engineOk: true });
      if (path === "/api/git/branches") {
        return Promise.resolve({
          branches: ["main"],
          defaultTarget: "main",
          current: "main",
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    sendJson.mockResolvedValue({ taskId: "task-1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("submits an image selected without a text prompt", async () => {
    render(<HomeView />);

    const image = new File(["image"], "reference.png", {
      type: "image/png",
    });
    const input = await screen.findByLabelText("画像ファイルを選択");
    fireEvent.change(input, { target: { files: [image] } });

    expect(await screen.findByRole("img", { name: "reference.png" })).toBeTruthy();
    const submit = screen.getByRole("button", {
      name: "タスク開始",
    }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith(
        "POST",
        "/api/tasks",
        expect.objectContaining({
          projectId: "project-1",
          prompt: "",
          files: [
            expect.objectContaining({ mime: "image/png", name: "reference.png" }),
          ],
        }),
      ),
    );
  });

  it("previews multiple images and removes one independently", async () => {
    render(<HomeView />);

    const input = await screen.findByLabelText("画像ファイルを選択");
    fireEvent.change(input, {
      target: {
        files: [
          new File(["first"], "first.png", { type: "image/png" }),
          new File(["second"], "second.png", { type: "image/png" }),
        ],
      },
    });

    expect(await screen.findByRole("img", { name: "first.png" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "second.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "first.pngを削除" }));
    expect(screen.queryByRole("img", { name: "first.png" })).toBeNull();
    expect(screen.getByRole("img", { name: "second.png" })).toBeTruthy();
  });

  it("labels the prompt and keeps attachment removal visible on keyboard focus", async () => {
    render(<HomeView />);

    expect(await screen.findByLabelText("タスクの説明")).toBeTruthy();
    const input = await screen.findByLabelText("画像ファイルを選択");
    fireEvent.change(input, {
      target: { files: [new File(["image"], "keyboard.png", { type: "image/png" })] },
    });
    const remove = await screen.findByRole("button", { name: "keyboard.pngを削除" });
    expect(remove.className).toContain("focus-visible:opacity-100");
  });

  it("adds an image pasted into the prompt", async () => {
    render(<HomeView />);

    const image = new File(["image"], "pasted.png", { type: "image/png" });
    fireEvent.paste(
      screen.getByPlaceholderText("タスクを説明してください…（Ctrl+Enter で開始）"),
      {
        clipboardData: {
          items: [
            {
              kind: "file",
              type: "image/png",
              getAsFile: () => image,
            },
          ],
        },
      },
    );

    expect(await screen.findByRole("img", { name: "pasted.png" })).toBeTruthy();
  });

  it("disables attachment controls while submitting and preserves attachments after failure", async () => {
    let rejectRequest: (reason: Error) => void = () => undefined;
    sendJson.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );
    render(<HomeView />);

    const prompt = screen.getByPlaceholderText(
      "タスクを説明してください…（Ctrl+Enter で開始）",
    );
    fireEvent.change(prompt, { target: { value: "describe this" } });
    const input = await screen.findByLabelText("画像ファイルを選択");
    fireEvent.change(input, {
      target: { files: [new File(["image"], "failed.png", { type: "image/png" })] },
    });
    expect(await screen.findByRole("img", { name: "failed.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "タスク開始" }));

    await waitFor(() => {
      expect(
        (screen.getByLabelText("画像を添付") as HTMLButtonElement).disabled,
      ).toBe(true);
      expect((prompt as HTMLTextAreaElement).readOnly).toBe(true);
    });
    fireEvent.paste(prompt, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => new File(["image"], "during-submit.png", { type: "image/png" }),
          },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("img", { name: "during-submit.png" })).toBeNull();
    rejectRequest(new Error("network failed"));

    expect((await screen.findByRole("alert")).textContent).toContain("network failed");
    expect((prompt as HTMLTextAreaElement).value).toBe("describe this");
    expect(screen.getByRole("img", { name: "failed.png" })).toBeTruthy();
  });

  it("keeps the composer toolbar as two fixed rows (place + settings)", async () => {
    render(<HomeView />);

    const form = await screen.findByRole("form", { name: "タスク作成" });
    const toolbar = form.querySelector(":scope > div.px-3.pb-3");
    expect(toolbar).not.toBeNull();
    expect(toolbar?.className).toMatch(/\bflex\b/);
    expect(toolbar?.className).toMatch(/\bflex-col\b/);
    expect(toolbar?.className).not.toMatch(/\bgrid\b/);
    expect(toolbar?.className).not.toContain("xl:grid-cols-");
    expect(toolbar?.className).not.toMatch(/\bflex-wrap\b/);

    const rows = toolbar?.querySelectorAll(":scope > div");
    expect(rows?.length).toBe(2);

    const row1 = rows![0];
    const row2 = rows![1];
    expect(row1.className).toMatch(/\bflex\b/);
    expect(row1.className).toMatch(/justify-between/);
    expect(row2.className).toMatch(/\bflex\b/);

    // 1 段目: プロジェクト・作業場所・送信
    expect(row1.contains(screen.getByLabelText("プロジェクト"))).toBe(true);
    expect(row1.contains(screen.getByLabelText("作業場所"))).toBe(true);
    expect(row1.contains(screen.getByRole("button", { name: "タスク開始" }))).toBe(
      true,
    );

    // 2 段目: アクセスモード（モデル/知性/エージェントはモック次第で非表示可）
    expect(row2.contains(screen.getByLabelText("アクセスモード"))).toBe(true);

    const accessWrap = screen.getByLabelText("アクセスモード").closest("span");
    expect(accessWrap?.className).not.toContain("order-first");
    expect(accessWrap?.className).not.toContain("xl:order-none");
    expect(accessWrap?.className).not.toMatch(/max-w-\[/);
  });
});
