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
        return Promise.resolve(makeDirList(CHILD, ROOT, [{ name: "web", path: GRANDCHILD }]));
      case GRANDCHILD:
        return Promise.resolve(makeDirList(GRANDCHILD, CHILD, []));
      case "C:\\Users\\Daichi":
        return Promise.resolve(makeDirList("C:\\Users\\Daichi", null, [{ name: "Projects", path: ROOT }]));
      default:
        return Promise.reject(new Error(`Unexpected browse dir: ${dir}`));
    }
  });
}

beforeEach(() => {
  getJson.mockReset();
  sendJson.mockReset();
  sendJson.mockResolvedValue({ project: { id: "p1", name: "OpenCode", rootPath: CHILD } });
  mockBrowseNavigation();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function getInput() {
  return screen.getByPlaceholderText("またはパスを入力 C:\\path\\to\\repo") as HTMLInputElement;
}

describe("AddProjectButton manual path sync", () => {
  it("sets the initial directory as the manual path when the dialog opens", async () => {
    render(<AddProjectButton />);
    fireEvent.click(screen.getByRole("button", { name: "プロジェクトを追加" }));

    await waitFor(() => expect(getInput().value).toBe(ROOT));
    expect(getJson).toHaveBeenCalledWith("/api/browse/dirs", undefined);
  });

  it("updates the manual path after navigating into a subfolder", async () => {
    render(<AddProjectButton />);
    fireEvent.click(screen.getByRole("button", { name: "プロジェクトを追加" }));
    await waitFor(() => expect(getInput().value).toBe(ROOT));

    const subfolder = await screen.findByRole("button", { name: "OpenCode" });
    fireEvent.click(subfolder);

    await waitFor(() => expect(getInput().value).toBe(CHILD));
    expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: CHILD });
  });

  it("updates the manual path after navigating up to the parent folder", async () => {
    render(<AddProjectButton />);
    fireEvent.click(screen.getByRole("button", { name: "プロジェクトを追加" }));
    await waitFor(() => expect(getInput().value).toBe(ROOT));

    fireEvent.click(await screen.findByRole("button", { name: "OpenCode" }));
    await waitFor(() => expect(getInput().value).toBe(CHILD));

    fireEvent.click(screen.getByRole("button", { name: "上へ" }));
    await waitFor(() => expect(getInput().value).toBe(ROOT));
    expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: ROOT });
  });

  it("keeps the manual path in sync even when the user edited it before navigating", async () => {
    render(<AddProjectButton />);
    fireEvent.click(screen.getByRole("button", { name: "プロジェクトを追加" }));
    await waitFor(() => expect(getInput().value).toBe(ROOT));

    const input = getInput();
    fireEvent.change(input, { target: { value: "C:\\stale" } });
    expect(input.value).toBe("C:\\stale");

    fireEvent.click(await screen.findByRole("button", { name: "OpenCode" }));
    await waitFor(() => expect(input.value).toBe(CHILD));
  });
});
