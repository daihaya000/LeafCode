import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexBarWidget } from "./CodexBarWidget";

const { getJson, sendJson } = vi.hoisted(() => ({ getJson: vi.fn(), sendJson: vi.fn() }));

vi.mock("@/lib/client", () => ({ getJson, sendJson }));
vi.mock("@/lib/addons/state", () => ({ writeAddonEnabled: vi.fn() }));

const usage = {
  available: true,
  reason: null,
  schema: "codexbar.usage-snapshot/v1",
  generatedAt: null,
  subscriptionTotalMonthlyUsd: null,
  providers: [],
};

const settings = {
  version: "version-1",
  providers: [
    { id: "codex", name: "Codex", enabled: true, configurable: true },
    { id: "claude", name: "Claude", enabled: true, configurable: true },
  ],
};

describe("CodexBarWidget provider settings", () => {
  beforeEach(() => {
    localStorage.setItem("webui:addon:codexbar:collapsed", "0");
    getJson.mockReset();
    sendJson.mockReset();
    getJson.mockImplementation((url: string) => {
      if (url.endsWith("/tokens")) return Promise.resolve({ available: false });
      if (url.endsWith("/providers")) return Promise.resolve(settings);
      return Promise.resolve(usage);
    });
    sendJson.mockResolvedValue({
      version: "version-2",
      providers: [
        { id: "codex", name: "Codex", enabled: true, configurable: true },
        { id: "claude", name: "Claude", enabled: false, configurable: true },
      ],
    });
  });

  afterEach(cleanup);

  it("loads settings with an accessible disclosure and saves a provider change", async () => {
    render(<CodexBarWidget />);

    const disclosure = await screen.findByRole("button", { name: "更新するプロバイダー" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);

    await screen.findByRole("switch", { name: "Claude を CodexBar で更新" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(disclosure.getAttribute("aria-controls")).toBe("codexbar-provider-settings");

    fireEvent.click(screen.getByRole("switch", { name: "Claude を CodexBar で更新" }));
    await waitFor(() => {
      expect(sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/addons/codexbar/providers",
        { providerId: "claude", enabled: false, version: "version-1" },
      );
    });
    expect(screen.getByRole("switch", { name: "Claude を CodexBar で更新" }).getAttribute("aria-checked")).toBe("false");
    await waitFor(() => expect(getJson).toHaveBeenCalledWith("/api/addons/codexbar/usage"));
  });

  it("disables the final enabled provider switch before it can be saved", async () => {
    getJson.mockImplementation((url: string) => {
      if (url.endsWith("/tokens")) return Promise.resolve({ available: false });
      if (url.endsWith("/providers")) {
        return Promise.resolve({
          version: "version-1",
          providers: [{ id: "codex", name: "Codex", enabled: true, configurable: true }],
        });
      }
      return Promise.resolve(usage);
    });

    render(<CodexBarWidget />);
    fireEvent.click(await screen.findByRole("button", { name: "更新するプロバイダー" }));
    expect((await screen.findByRole("switch", { name: "Codex を CodexBar で更新" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
