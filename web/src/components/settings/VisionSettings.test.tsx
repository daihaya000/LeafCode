import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisionSettings } from "./VisionSettings";

const h = vi.hoisted(() => ({
  getJson: vi.fn(),
  sendJson: vi.fn(),
  timedFetch: vi.fn(),
}));

vi.mock("@/lib/client", () => ({
  getJson: (...a: unknown[]) => h.getJson(...a),
  sendJson: (...a: unknown[]) => h.sendJson(...a),
  timedFetch: (...a: unknown[]) => h.timedFetch(...a),
}));

const savedSettings = {
  enabled: false,
  opencodeModel: "",
  timeoutMs: 60_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.getJson.mockImplementation(async (url: string) => {
    if (url.includes("/api/qwen-native/settings")) return savedSettings;
    if (url.includes("/api/qwen-native/status")) return { nativeAvailable: true };
    if (url.includes("/api/ollama/status")) {
      return { installed: true, running: true, version: "0.5.0", models: [] };
    }
    if (url.includes("/api/qwen-native/models")) {
      return {
        models: [
          { value: "provider::model-1", label: "Model 1", group: "Provider" },
        ],
      };
    }
    throw new Error(`unexpected getJson: ${url}`);
  });
  h.sendJson.mockImplementation(async () => savedSettings);
  h.timedFetch.mockImplementation(async () => new Response("{}", { status: 200 }));
});

afterEach(() => {
  cleanup();
});

describe("VisionSettings", () => {
  it("shows a loading state before the settings arrive", () => {
    h.getJson.mockImplementation(() => new Promise(() => undefined));
    render(<VisionSettings />);
    expect(screen.getByText("画像解析設定を読み込んでいます…")).toBeTruthy();
  });

  it("renders the vision section after loading", async () => {
    render(<VisionSettings />);
    expect(
      await screen.findByRole("heading", { name: "画像事前解析" }),
    ).toBeTruthy();
    expect(screen.getByText(/現在の状態: 有効/)).toBeTruthy();
    expect(screen.getByLabelText("画像事前解析を有効化")).toBeTruthy();
    expect(screen.getByLabelText("LeafCode登録モデル（画像対応）")).toBeTruthy();
  });

  it("saves the settings when the enable checkbox is toggled and the save button is clicked", async () => {
    render(<VisionSettings />);
    await screen.findByRole("heading", { name: "画像事前解析" });

    fireEvent.click(screen.getByLabelText("画像事前解析を有効化"));
    fireEvent.change(screen.getByLabelText("LeafCode登録モデル（画像対応）"), {
      target: { value: "provider::model-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(h.sendJson).toHaveBeenCalledWith(
        "PUT",
        "/api/qwen-native/settings",
        expect.objectContaining({
          enabled: true,
          opencodeModel: "provider::model-1",
        }),
      );
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      "画像解析設定を保存しました",
    );
  });

  it("shows an error when the save fails", async () => {
    h.sendJson.mockRejectedValue(new Error("保存に失敗しました"));
    render(<VisionSettings />);
    await screen.findByRole("heading", { name: "画像事前解析" });

    fireEvent.click(screen.getByLabelText("画像事前解析を有効化"));
    fireEvent.change(screen.getByLabelText("LeafCode登録モデル（画像対応）"), {
      target: { value: "provider::model-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "保存に失敗しました",
    );
  });

  it("shows a warning when no vision-capable model is registered", async () => {
    h.getJson.mockImplementation(async (url: string) => {
      if (url.includes("/api/qwen-native/settings")) return savedSettings;
      if (url.includes("/api/qwen-native/status")) return { nativeAvailable: true };
      if (url.includes("/api/ollama/status")) {
        return { installed: true, running: true, version: "0.5.0", models: [] };
      }
      if (url.includes("/api/qwen-native/models")) return { models: [] };
      throw new Error(`unexpected getJson: ${url}`);
    });
    render(<VisionSettings />);
    await screen.findByRole("heading", { name: "画像事前解析" });
    expect(
      screen.getByText(/画像対応モデルが見つかりません/),
    ).toBeTruthy();
  });
});
