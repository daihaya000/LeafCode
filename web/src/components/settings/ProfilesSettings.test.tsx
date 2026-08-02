import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilesSettings } from "./ProfilesSettings";

const HOST_OK = { ok: true, controlUrl: "http://127.0.0.1:1" };

function mockFetch(responses: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/profiles/settings")) {
      return new Response(JSON.stringify({ browserBridge: true, cursorAcp: true, claudeAuth: true, commandcodeAuth: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    for (const [pattern, body] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
}

const BASE_LIST = {
  profiles: [
    {
      id: "default-id",
      name: "default",
      path: "C:\\Users\\x\\OneDrive\\opencode",
      external: true,
      active: true,
      exists: true,
    },
    {
      id: "work-id",
      name: "work",
      path: "C:\\Users\\x\\AppData\\Roaming\\opencode-webui\\profiles\\work",
      active: false,
      exists: true,
    },
  ],
  activeId: "default-id",
  linkState: "link",
  canSwitch: true,
  migration: {
    needed: true,
    sourcePath: "C:\\Users\\x\\OneDrive\\opencode",
    estimatedBytes: 250_000_000,
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("ProfilesSettings", () => {
  it("renders both profiles with active and external badges", async () => {
    global.fetch = mockFetch({
      "/api/profiles": BASE_LIST,
      "/api/host": HOST_OK,
    }) as unknown as typeof fetch;

    render(<ProfilesSettings />);

    await waitFor(() => {
      expect(screen.getAllByText("default").length).toBeGreaterThan(0);
      expect(screen.getAllByText("work").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("アクティブ").length).toBeGreaterThan(0);
    expect(screen.getAllByText("dataDir 外").length).toBeGreaterThan(0);
  });

  it("shows the migration card when default is external", async () => {
    global.fetch = mockFetch({
      "/api/profiles": BASE_LIST,
      "/api/host": HOST_OK,
    }) as unknown as typeof fetch;

    render(<ProfilesSettings />);

    await waitFor(() => {
      expect(screen.getAllByText("dataDir への移行").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("移行を開始").length).toBeGreaterThan(0);
  });

  it("does not start migration twice before the first request settles", async () => {
    const baseFetch = mockFetch({
      "/api/profiles": BASE_LIST,
      "/api/host": HOST_OK,
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/profiles/migrate") && init?.method === "POST") {
        return new Promise<Response>(() => undefined);
      }
      return baseFetch(input);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<ProfilesSettings />);

    await screen.findAllByText("default");
    const migrate = screen
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("移行を開始"));
    expect(migrate).toBeTruthy();
    fireEvent.click(migrate!);
    fireEvent.click(migrate!);

    await waitFor(() => expect(migrate).toHaveProperty("disabled", true));
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/api/profiles/migrate"),
      ),
    ).toHaveLength(1);
  });

  it("does not show the migration card when not needed", async () => {
    const noMigration = {
      profiles: BASE_LIST.profiles,
      activeId: BASE_LIST.activeId,
      linkState: BASE_LIST.linkState,
      canSwitch: BASE_LIST.canSwitch,
      migration: { needed: false, sourcePath: "", estimatedBytes: 0 },
    };
    global.fetch = mockFetch({
      "/api/profiles": noMigration,
      "/api/host": HOST_OK,
    }) as unknown as typeof fetch;

    render(<ProfilesSettings />);

    await waitFor(() => {
      expect(screen.getAllByText("default").length).toBeGreaterThan(0);
    });
    expect(screen.queryAllByText("移行を開始")).toHaveLength(0);
  });

  it("shows the cannot-switch banner when reason is present", async () => {
    global.fetch = mockFetch({
      "/api/profiles": {
        ...BASE_LIST,
        canSwitch: false,
        reason: "実体ディレクトリのため切り替えられません。",
      },
      "/api/host": HOST_OK,
    }) as unknown as typeof fetch;

    render(<ProfilesSettings />);

    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/実体ディレクトリ/).length).toBeGreaterThan(0);
  });

  it("opens the switch confirmation dialog and warns about restart", async () => {
    global.fetch = mockFetch({
      "/api/profiles": BASE_LIST,
      "/api/host": HOST_OK,
    }) as unknown as typeof fetch;

    render(<ProfilesSettings />);

    await waitFor(() => {
      expect(screen.getAllByText("切り替え").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("切り替え")[0]);

    await waitFor(() => {
      expect(screen.getAllByRole("dialog").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/進行中のタスクは中断されます/).length).toBeGreaterThan(0);
  });

  it("traps focus in the switch dialog and restores it on Escape", async () => {
    global.fetch = mockFetch({
      "/api/profiles": BASE_LIST,
      "/api/host": HOST_OK,
    }) as unknown as typeof fetch;

    render(<ProfilesSettings />);
    await screen.findAllByText("default");
    const switchButton = screen.getAllByText("切り替え")[0] as HTMLElement;
    switchButton.focus();
    document.body.style.overflow = "auto";
    fireEvent.click(switchButton);

    const dialog = await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    const buttons = Array.from(dialog.querySelectorAll("button")) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    expect(document.activeElement).toBe(buttons[0]);

    buttons[1].focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(switchButton);
    expect(document.body.style.overflow).toBe("auto");
  });

  it("shows the create form when 新規作成 is clicked", async () => {
    global.fetch = mockFetch({
      "/api/profiles": BASE_LIST,
      "/api/host": HOST_OK,
    }) as unknown as typeof fetch;

    render(<ProfilesSettings />);

    await waitFor(() => {
      expect(screen.getAllByText("新規作成").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText("新規作成")[0]);

    await waitFor(() => {
      expect(screen.getAllByLabelText("名前").length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText("作成元").length).toBeGreaterThan(0);
    });
  });

  it("locks profile creation while the request is pending", async () => {
    const baseFetch = mockFetch({
      "/api/profiles": BASE_LIST,
      "/api/host": HOST_OK,
    });
    let resolveCreate!: (response: Response) => void;
    let createCalls = 0;
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/profiles") && init?.method === "POST") {
        createCalls += 1;
        return new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        });
      }
      return baseFetch(input);
    }) as unknown as typeof fetch;

    render(<ProfilesSettings />);
    await screen.findAllByText("default");
    fireEvent.click(screen.getByRole("button", { name: "新規作成" }));
    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "実験用" } });

    const create = screen.getByRole("button", { name: "作成" }) as HTMLButtonElement;
    fireEvent.click(create);
    fireEvent.click(create);

    await waitFor(() => expect(create.disabled).toBe(true));
    expect(createCalls).toBe(1);

    resolveCreate(
      new Response(JSON.stringify({ id: "new-id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "作成" })).toBeNull());
  });

  it("renders Browser Bridge and Cursor ACP setup checkboxes", async () => {
    global.fetch = mockFetch({
      "/api/profiles": BASE_LIST,
      "/api/host": HOST_OK,
    }) as unknown as typeof fetch;

    render(<ProfilesSettings />);

    await waitFor(() => {
      expect(screen.getByLabelText("Browser Bridgeの自動セットアップ")).toBeTruthy();
      expect(screen.getByLabelText("Cursor ACPの自動セットアップ")).toBeTruthy();
    });
    expect(
      (screen.getByLabelText("Browser Bridgeの自動セットアップ") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("shows error state when the API fails", async () => {
    global.fetch = vi.fn(async () =>
      new Response("{}", { status: 500 }),
    ) as unknown as typeof fetch;

    render(<ProfilesSettings />);

    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("再試行").length).toBeGreaterThan(0);
  });
});
