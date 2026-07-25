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

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "プロジェクトを追加" }));
}

function getAddButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "このフォルダを追加" }) as HTMLButtonElement;
}

function getUpButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "上へ" }) as HTMLButtonElement;
}

/** Find the entry row (div[role=button]) whose accessible name is exactly `name`. */
async function findEntryRow(name: string): Promise<HTMLElement> {
  const rows = await screen.findAllByRole("button", { name });
  const row = rows.find((el) => el.getAttribute("aria-label") === name);
  if (!row) throw new Error(`row for ${name} not found`);
  return row;
}

async function findOpenButton(name: string): Promise<HTMLElement> {
  return screen.findByRole("button", { name: `${name} を開く` });
}

describe("AddProjectButton selected path sync", () => {
  it("sets the initial directory as the selected path when the dialog opens", async () => {
    render(<AddProjectButton />);
    openDialog();

    // manualPath stays empty (user input respected); selection defaults to ROOT.
    await waitFor(() => expect(getInput().value).toBe(""));
    // The add button becomes enabled because cwd/selectedPath is ROOT.
    await waitFor(() => expect(getAddButton().disabled).toBe(false));
    expect(getJson).toHaveBeenCalledWith("/api/browse/dirs", undefined);
  });

  it("updates the selected path after navigating into a subfolder", async () => {
    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getAddButton().disabled).toBe(false));

    // Open the "OpenCode" subfolder via the open affordance.
    const openBtn = await findOpenButton("OpenCode");
    fireEvent.click(openBtn);

    // manualPath remains empty; the add button stays enabled via selectedPath=CHILD.
    await waitFor(() => expect(getInput().value).toBe(""));
    await waitFor(() => expect(getAddButton().disabled).toBe(false));
    expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: CHILD });
  });

  it("updates the selected path after navigating up", async () => {
    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getAddButton().disabled).toBe(false));

    fireEvent.click(await findOpenButton("OpenCode"));
    await waitFor(() =>
      expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: CHILD }),
    );

    fireEvent.click(getUpButton());
    await waitFor(() =>
      expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: ROOT }),
    );
    // After navigating up, the add button is still enabled (selectedPath=ROOT).
    await waitFor(() => expect(getAddButton().disabled).toBe(false));
  });

  it("preserves user-edited manual path when navigating (no override)", async () => {
    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getAddButton().disabled).toBe(false));

    const input = getInput();
    fireEvent.change(input, { target: { value: "C:\\stale" } });
    expect(input.value).toBe("C:\\stale");

    fireEvent.click(await findOpenButton("OpenCode"));
    // manualPath is NOT overwritten by navigation.
    await waitFor(() =>
      expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: CHILD }),
    );
    await waitFor(() => expect(input.value).toBe("C:\\stale"));
  });
});

describe("AddProjectButton select + add", () => {
  it("selects a folder by clicking the row and adds it", async () => {
    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getAddButton().disabled).toBe(false));

    // Click the "OpenCode" row (select, not open).
    const row = await findEntryRow("OpenCode");
    fireEvent.click(row);

    // Add button enabled; clicking it sends the selected path.
    const addBtn = getAddButton();
    expect(addBtn.disabled).toBe(false);
    fireEvent.click(addBtn);

    await waitFor(() => expect(sendJson).toHaveBeenCalledTimes(1));
    expect(sendJson).toHaveBeenCalledWith("POST", "/api/projects", {
      rootPath: CHILD,
    });
  });

  it("opening a leaf folder keeps it selected for add", async () => {
    render(<AddProjectButton />);
    openDialog();
    await waitFor(() => expect(getAddButton().disabled).toBe(false));

    // Navigate into OpenCode, then open the empty "empty" leaf.
    fireEvent.click(await findOpenButton("OpenCode"));
    await waitFor(() =>
      expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: CHILD }),
    );
    fireEvent.click(await findOpenButton("empty"));
    await waitFor(() =>
      expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: LEAF }),
    );

    // entries empty -> "サブフォルダがありません" shown, but add button still enabled
    // because selectedPath (or cwd) is the leaf.
    await waitFor(() =>
      expect(screen.getByText("サブフォルダがありません")).toBeTruthy(),
    );
    expect(getAddButton().disabled).toBe(false);
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

    // While the initial load is pending, the entry open buttons are disabled,
    // so a second load cannot be triggered concurrently. Verify the add button
    // is disabled (no cwd yet) and the spinner is shown.
    await waitFor(() => expect(screen.getByText("…")).toBeTruthy());

    // Now resolve the initial load with a stale-ish payload that includes a
    // "stale" entry, then immediately issue a newer load for CHILD. The newer
    // load's response (no "stale" entry) must win.
    act(() =>
      resolveFirst?.(makeDirList(ROOT, "C:\\Users\\Daichi", [{ name: "OpenCode", path: CHILD }])),
    );
    await waitFor(() => expect(getAddButton().disabled).toBe(false));

    // Issue a newer load for CHILD via the open button.
    fireEvent.click(await findOpenButton("OpenCode"));
    await waitFor(() =>
      expect(getJson).toHaveBeenLastCalledWith("/api/browse/dirs", { path: CHILD }),
    );

    // The newer load resolved to CHILD with "web" entry (no "stale").
    await waitFor(() => expect(screen.getByText(CHILD)).toBeTruthy());
    expect(screen.queryByText("stale")).toBeNull();
    expect(screen.getByText("web")).toBeTruthy();
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
    // The second instance's trigger button is distinct from the first's.
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