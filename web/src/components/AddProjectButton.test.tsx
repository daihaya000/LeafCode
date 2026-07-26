import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddProjectButton } from "./AddProjectButton";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  sendJson,
}));

vi.mock("@/lib/events", () => ({
  notifyTasksChanged: vi.fn(),
}));

vi.mock("@/components/shell/GlobalAttentionProvider", () => ({
  useOptionalGlobalAttention: () => null,
}));

type DirEntry = { name: string; path: string };

const ROOT = "C:\\Users\\Daichi\\Projects";
const CHILD = "C:\\Users\\Daichi\\Projects\\OpenCode";
const GRANDCHILD = "C:\\Users\\Daichi\\Projects\\OpenCode\\web";
const LEAF = "C:\\Users\\Daichi\\Projects\\OpenCode\\empty";

function makeDirList(path: string | null, parent: string | null, entries: DirEntry[]) {
  return { path, parent, entries, quickAccess: [] };
}

function mockBrowseNavigation() {
  getJson.mockImplementation((path: string, params?: Record<string, string | undefined>) => {
    if (path !== "/api/browse/dirs") {
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    }
    const dir = params?.path ?? null;
    switch (dir) {
      case null:
        return Promise.resolve(makeDirList(ROOT, "C:\\Users\\Daichi", [{ name: "OpenCode", path: CHILD }]));
      case ROOT:
        return Promise.resolve(makeDirList(ROOT, "C:\\Users\\Daichi", [{ name: "OpenCode", path: CHILD }]));
      case CHILD:
        return Promise.resolve(makeDirList(CHILD, ROOT, [{ name: "web", path: GRANDCHILD }, { name: "empty", path: LEAF }]));
      case GRANDCHILD:
        return Promise.resolve(makeDirList(GRANDCHILD, CHILD, []));
      case LEAF:
        return Promise.resolve(makeDirList(LEAF, CHILD, []));
      case "C:\\Users\\Daichi":
        return Promise.resolve(makeDirList("C:\\Users\\Daichi", null, [{ name: "Projects", path: ROOT }]));
      default:
        return Promise.reject(new Error(`Unexpected browse dir: ${dir}`));
    }
  });
}

function mockClientPlatform(platform: string, userAgent: string) {
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
}

beforeEach(() => {
  mockClientPlatform("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)");
  getJson.mockReset();
  sendJson.mockReset();
  sendJson.mockResolvedValue({ project: { id: "p1", name: "OpenCode", rootPath: CHILD } });
  mockBrowseNavigation();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function getInput() {
  return screen.getByPlaceholderText("またはパスを入力 C:\\path\\to\\repo") as HTMLInputElement;
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "プロジェクトを追加" }));
}

function getAddButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "このフォルダを追加" }) as HTMLButtonElement;
}

function getUpButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "上へ" }) as HTMLButtonElement;
}

/** Find the folder entry button whose accessible name is `${name} を開く`. */
async function findEntryButton(name: string): Promise<HTMLElement> {
  return screen.findByRole("button", { name: `${name} を開く` });
}

describe("AddProjectButton path sync (row click opens + syncs field)", () => {
  it("uses the native Windows folder picker and adds the selected folder", async () => {
    mockClientPlatform("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    sendJson.mockImplementation((method: string, path: string) => {
      if (method === "POST" && path === "/api/browse/folder") {
        return Promise.resolve({ path: CHILD, cancelled: false });
      }
      if (method === "POST" && path === "/api/projects") {
        return Promise.resolve({ project: { id: "p1", name: "OpenCode", rootPath: CHILD } });
      }
      return Promise.reject(new Error(`Unexpected request: ${method} ${path}`));
    });

    render(<AddProjectButton />);
    openDialog();

    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(2));
    expect(sendJson).toHaveBeenNthCalledWith(
      1,
      "POST",
      "/api/browse/folder",
      { title: "プロジェクトフォルダを選択", initialPath: undefined },
      undefined,
      { timeoutMs: 300_000 },
    );
    expect(sendJson).toHaveBeenNthCalledWith(2, "POST", "/api/projects", {
      rootPath: CHILD,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("syncs the path field to the initial folder when the dialog opens", async () => {
    render(<AddProjectButton />);
    openDialog();

    await waitFor(() => expect(getInput().value).toBe(ROOT));
    expect(getAddButton().disabled).toBe(false);
    expect(getJson).toHaveBeenCalledWith("/api/browse/dirs", undefined);
  });

  it("syncs the path field after clicking a folder row to open it", async () => {
    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getInput().value).toBe(ROOT));

    // Clicking the "OpenCode" row opens it and syncs the field.
    fireEvent.click(await findEntryButton("OpenCode"));

    await waitFor(() => expect(getInput().value).toBe(CHILD));
    expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: CHILD });
    expect(getAddButton().disabled).toBe(false);
  });

  it("syncs the path field after navigating up", async () => {
    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getInput().value).toBe(ROOT));

    fireEvent.click(await findEntryButton("OpenCode"));
    await waitFor(() => expect(getInput().value).toBe(CHILD));

    fireEvent.click(getUpButton());
    await waitFor(() => expect(getInput().value).toBe(ROOT));
    expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: ROOT });
  });

  it("overrides user-edited path when navigating (field tracks the open folder)", async () => {
    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getInput().value).toBe(ROOT));

    const input = getInput();
    fireEvent.change(input, { target: { value: "C:\\stale" } });
    expect(input.value).toBe("C:\\stale");

    // Opening a subfolder syncs the field to that folder (standard explorer UX).
    fireEvent.click(await findEntryButton("OpenCode"));
    await waitFor(() => expect(getInput().value).toBe(CHILD));
  });

  it("adds the open folder when clicking add after navigating into a leaf", async () => {
    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getInput().value).toBe(ROOT));

    // Open -> OpenCode -> empty (leaf, no subfolders).
    fireEvent.click(await findEntryButton("OpenCode"));
    await waitFor(() => expect(getInput().value).toBe(CHILD));
    fireEvent.click(await findEntryButton("empty"));
    await waitFor(() => expect(getInput().value).toBe(LEAF));

    // Leaf has no subfolders but the field holds LEAF, so add is enabled.
    await waitFor(() =>
      expect(screen.getByText("サブフォルダがありません")).toBeTruthy(),
    );
    expect(getAddButton().disabled).toBe(false);

    fireEvent.click(getAddButton());
    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));
    expect(sendJson).toHaveBeenCalledWith("POST", "/api/projects", {
      rootPath: LEAF,
    });
  });
});

describe("AddProjectButton validation + errors", () => {
  it("rejects malformed manual path with form validation error", async () => {
    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getAddButton().disabled).toBe(false));

    const input = getInput();
    fireEvent.change(input, { target: { value: "not-a-path" } });

    fireEvent.click(getAddButton());

    await waitFor(() =>
      expect(screen.getByText("パスの形式が正しくありません")).toBeTruthy(),
    );
    expect(sendJson).not.toHaveBeenCalled();
  });

  it("translates API 404 to Japanese error", async () => {
    getJson.mockReset();
    const err = new Error("path not found");
    (err as Error & { status: number }).status = 404;
    getJson.mockRejectedValueOnce(err);

    render(<AddProjectButton />);
    openDialog();

    await waitFor(() =>
      expect(screen.getByText("フォルダが見つかりません")).toBeTruthy(),
    );
  });

  it("translates API 400 to Japanese error", async () => {
    getJson.mockReset();
    const err = new Error("EPERM");
    (err as Error & { status: number }).status = 400;
    getJson.mockRejectedValueOnce(err);

    render(<AddProjectButton />);
    openDialog();

    await waitFor(() =>
      expect(
        screen.getByText("このフォルダは追加できません（許可されていません）"),
      ).toBeTruthy(),
    );
  });
});

describe("AddProjectButton concurrency + UX", () => {
  it("prevents concurrent load race (newer response wins)", async () => {
    let resolveFirst: ((v: ReturnType<typeof makeDirList>) => void) | undefined;
    getJson.mockReset();
    getJson.mockImplementation((path: string, params?: Record<string, string | undefined>) => {
      if (path !== "/api/browse/dirs") {
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }
      const dir = params?.path ?? null;
      if (dir === null) {
        // Slow initial load — stays pending until we resolve it.
        return new Promise((resolve) => {
          resolveFirst = resolve as (v: ReturnType<typeof makeDirList>) => void;
        });
      }
      if (dir === CHILD) {
        // Fast follow-up load.
        return Promise.resolve(makeDirList(CHILD, ROOT, [{ name: "web", path: GRANDCHILD }]));
      }
      return Promise.reject(new Error(`Unexpected browse dir: ${dir}`));
    });

    render(<AddProjectButton />);
    openDialog();

    // While the initial load is pending, entry buttons are disabled.
    await waitFor(() => expect(screen.getByText("…")).toBeTruthy());

    // Resolve the initial load, then issue a newer load for CHILD.
    act(() =>
      resolveFirst?.(makeDirList(ROOT, "C:\\Users\\Daichi", [{ name: "OpenCode", path: CHILD }])),
    );
    await waitFor(() => expect(getInput().value).toBe(ROOT));

    fireEvent.click(await findEntryButton("OpenCode"));
    await waitFor(() =>
      expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: CHILD }),
    );

    // Newer load wins: CHILD with "web" entry, no "stale".
    await waitFor(() => expect(getInput().value).toBe(CHILD));
    expect(screen.getByText("web")).toBeTruthy();
    expect(screen.queryByText("stale")).toBeNull();
  });

  it("Enter key in input does not submit while busy", async () => {
    let resolvePost: ((v: { project: unknown }) => void) | undefined;
    sendJson.mockReset();
    sendJson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve as (v: { project: unknown }) => void;
        }),
    );

    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getAddButton().disabled).toBe(false));

    // Use a valid path so confirm proceeds past form validation.
    const input = getInput();
    fireEvent.change(input, { target: { value: CHILD } });

    // Submit via Enter — starts the POST.
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));

    // While busy, press Enter again — must NOT trigger a second submit.
    fireEvent.keyDown(input, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 10));
    expect(sendJson).toHaveBeenCalledTimes(1);

    // Resolve to allow cleanup.
    act(() => resolvePost?.({ project: { id: "p1", name: "x", rootPath: CHILD } }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("locks body scroll while dialog open and restores on close", async () => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "";

    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getAddButton().disabled).toBe(false));
    expect(document.body.style.overflow).toBe("hidden");

    // Close via the backdrop close button.
    fireEvent.click(screen.getAllByRole("button", { name: "閉じる" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.style.overflow).toBe("");

    document.body.style.overflow = prev;
  });

  it("uses unique aria-labelledby id via useId", async () => {
    const { unmount: unmountA } = render(<AddProjectButton />);
    openDialog();
    const dialogA = await screen.findByRole("dialog");
    const labelledByA = dialogA.getAttribute("aria-labelledby");
    expect(labelledByA).toBeTruthy();
    expect(document.getElementById(labelledByA!)).toBeTruthy();

    // Render a second instance and open its dialog; its title id must differ.
    const { unmount: unmountB } = render(<AddProjectButton />);
    const triggers = screen.getAllByRole("button", { name: "プロジェクトを追加" });
    expect(triggers.length).toBe(2);
    fireEvent.click(triggers[1]);

    const dialogs = await screen.findAllByRole("dialog");
    expect(dialogs.length).toBe(2);
    const labelledByB = dialogs[1].getAttribute("aria-labelledby");
    expect(labelledByB).toBeTruthy();
    expect(labelledByB).not.toBe(labelledByA);

    unmountA();
    unmountB();
  });
});
