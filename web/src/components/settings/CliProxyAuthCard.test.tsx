import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliProxyAuthCard } from "./CliProxyAuthCard";

const { getJson, sendJson } = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson,
  sendJson,
}));

function renderCard() {
  return render(
    <CliProxyAuthCard
      title="Claude CLI Proxy"
      headingId="claude-cli-proxy-heading"
      provider="claude"
      authEndpoint="/api/provider/claude/auth"
      loginCommand="claude login"
      description="説明"
    />,
  );
}

beforeEach(() => {
  getJson.mockReset().mockResolvedValue({ connected: false });
  sendJson.mockReset().mockResolvedValue({ ok: true, command: "claude login" });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CliProxyAuthCard", () => {
  it("launches the terminal login and tells the user to finish there", async () => {
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "ターミナルでログイン" }));

    await waitFor(() =>
      expect(sendJson).toHaveBeenCalledWith("POST", "/api/provider/cli-login", {
        provider: "claude",
      }),
    );
    expect(
      await screen.findByText(/表示された手順を完了したら「再確認」を押してください/),
    ).toBeTruthy();
  });

  it("does not launch a second terminal while one is starting", async () => {
    let resolveLaunch!: (value: unknown) => void;
    sendJson.mockReturnValue(new Promise((resolve) => { resolveLaunch = resolve; }));

    renderCard();
    const button = await screen.findByRole("button", { name: "ターミナルでログイン" });
    fireEvent.click(button);

    const busy = await screen.findByRole("button", { name: "起動中…" });
    fireEvent.click(busy);
    expect(sendJson).toHaveBeenCalledTimes(1);

    resolveLaunch({ ok: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ターミナルでログイン" })).toBeTruthy(),
    );
  });

  it("surfaces a launch failure", async () => {
    sendJson.mockRejectedValue(new Error("ターミナルを起動できませんでした"));

    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "ターミナルでログイン" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "ターミナルを起動できませんでした",
    );
  });

  it("re-checks the CLI login state on demand", async () => {
    renderCard();
    await screen.findByText("未接続");

    getJson.mockResolvedValueOnce({ connected: true });
    fireEvent.click(screen.getByRole("button", { name: "再確認" }));

    await waitFor(() => expect(screen.getByText("接続済み")).toBeTruthy());
  });
});
