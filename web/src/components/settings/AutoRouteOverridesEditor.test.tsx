import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AutoRouteConfig } from "@/lib/auto-model";
import { AutoRouteOverridesEditor, type AutoRouteProviders } from "./AutoRouteOverridesEditor";

afterEach(cleanup);

const PROVIDERS: AutoRouteProviders = [
  {
    id: "alpha",
    name: "Alpha",
    enabled: true,
    models: [
      { id: "cheap", name: "Alpha Cheap", enabled: true },
      {
        id: "mid",
        name: "Alpha Mid",
        enabled: true,
        variants: { low: {}, high: {} },
      },
    ],
  },
  {
    id: "beta",
    name: "Beta",
    enabled: false,
    models: [{ id: "premium", name: "Beta Premium", enabled: false }],
  },
];

const EMPTY_CONFIG: AutoRouteConfig = { version: 2, modes: {} };

/** Controlled harness so edits flow back into the `config` prop. */
function Harness({
  initial,
  mode = "balanced",
  providers = PROVIDERS,
}: {
  initial: AutoRouteConfig;
  mode?: "cost" | "balanced" | "intelligence";
  providers?: AutoRouteProviders;
}) {
  const [config, setConfig] = useState(initial);
  return (
    <AutoRouteOverridesEditor
      mode={mode}
      config={config}
      providers={providers}
      onChange={setConfig}
    />
  );
}

function renderEditor(
  config: AutoRouteConfig = EMPTY_CONFIG,
  mode: "cost" | "balanced" | "intelligence" = "balanced",
) {
  render(<Harness initial={config} mode={mode} />);
}

function open() {
  fireEvent.click(screen.getByText("Auto ルーティング設定"));
}

/** All three tier cards' candidate areas (light/standard/heavy). */
function lightCard() {
  const cards = screen.getAllByText(/^ライト/);
  return cards[0]?.closest("div.space-y-2");
}

describe("AutoRouteOverridesEditor", () => {
  it("is collapsed by default", () => {
    renderEditor();
    expect(screen.queryByText("ライト")).toBeNull();
    expect(screen.queryByLabelText("全モードの設定をリセット")).toBeNull();
  });

  it("expands to show all three tiers", () => {
    renderEditor();
    open();
    expect(screen.getByText("ライト")).toBeTruthy();
    expect(screen.getByText("標準")).toBeTruthy();
    expect(screen.getByText("ヘビー")).toBeTruthy();
  });

  it("shows a reset-all button only when a config exists and clears it", () => {
    render(
      <Harness
        initial={{
          version: 2,
          modes: {
            balanced: {
              light: { candidates: [{ kind: "cost", cost: "mid" }] },
            },
          },
        }}
      />,
    );
    open();
    fireEvent.click(screen.getByLabelText("全モードの設定をリセット"));
    expect(screen.getAllByText("プリセットを使用中").length).toBe(3);
  });

  it("switches mode tabs and marks the running mode with an asterisk", () => {
    renderEditor();
    open();
    const runningTab = screen.getByText((_, el) => el?.textContent === "バランス*");
    expect(runningTab).toBeTruthy();
    fireEvent.click(screen.getByText("知能優先"));
    expect(
      screen.getByText((_, el) => el?.textContent === "知能優先"),
    ).toBeTruthy();
  });

  it("shows プリセットを使用中 when the cell has no candidates", () => {
    renderEditor();
    open();
    expect(screen.getAllByText("プリセットを使用中").length).toBe(3);
  });

  it("resets a single tier via its aria-labelled reset button", () => {
    render(
      <Harness
        initial={{
          version: 2,
          modes: {
            balanced: {
              light: { candidates: [{ kind: "cost", cost: "mid" }] },
            },
          },
        }}
      />,
    );
    open();
    fireEvent.click(screen.getByLabelText("ライトをリセット"));
    expect(screen.getAllByText("プリセットを使用中").length).toBe(3);
  });

  it("adds a candidate and switches its kind to a model reference", () => {
    renderEditor();
    open();
    fireEvent.click(screen.getAllByText("候補を追加")[0]);
    expect(screen.getAllByLabelText("候補1の種別")[0]).toBeTruthy();

    fireEvent.change(screen.getAllByLabelText("候補1の種別")[0], {
      target: { value: "model" },
    });
    const modelSelect = screen.getAllByLabelText("候補1のモデル")[0];
    expect(modelSelect).toBeTruthy();
    expect(modelSelect.getAttribute("value")).toBe("alpha::cheap");
  });

  it("removes a candidate with the delete button", () => {
    render(
      <Harness
        initial={{
          version: 2,
          modes: {
            balanced: {
              light: {
                candidates: [
                  { kind: "cost", cost: "cheap" },
                  { kind: "cost", cost: "mid" },
                ],
              },
            },
          },
        }}
      />,
    );
    open();
    fireEvent.click(screen.getByLabelText("候補2を削除"));
    expect(screen.queryByLabelText("候補2を削除")).toBeNull();
    // Only the light tier still has candidates; standard/heavy stay preset.
    expect(screen.getAllByLabelText("候補1の種別").length).toBe(1);
  });

  it("moves a candidate down within the order", () => {
    render(
      <Harness
        initial={{
          version: 2,
          modes: {
            balanced: {
              light: {
                candidates: [
                  { kind: "cost", cost: "cheap" },
                  { kind: "cost", cost: "mid" },
                ],
              },
            },
          },
        }}
      />,
    );
    open();
    fireEvent.click(screen.getByLabelText("候補1を下へ"));
    // The two cost selects in the light card swapped order.
    const lightCosts = lightCard()
      ?.querySelectorAll('select[aria-label$="のコスト帯"]');
    expect(lightCosts?.length).toBe(2);
  });

  it("disables the add button at MAX_AUTO_ROUTE_CANDIDATES", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => ({
      kind: "cost" as const,
      cost: i % 3 === 0 ? ("cheap" as const) : i % 3 === 1 ? ("mid" as const) : ("premium" as const),
      variant: (["minimal", "none", "low"] as const)[i % 3],
    }));
    render(
      <Harness
        initial={{
          version: 2,
          modes: { balanced: { light: { candidates } } },
        }}
      />,
    );
    open();
    const addButtons = screen.getAllByText("候補を追加");
    expect(addButtons[0]?.hasAttribute("disabled")).toBe(true);
  });

  it("updates the fallback policy select", () => {
    render(
      <Harness
        initial={{
          version: 2,
          modes: {
            balanced: {
              light: {
                candidates: [{ kind: "cost", cost: "mid" }],
                fallback: "error",
              },
            },
          },
        }}
      />,
    );
    open();
    fireEvent.change(screen.getByLabelText("ライトのフォールバック"), {
      target: { value: "strongest" },
    });
    expect(
      (screen.getByLabelText("ライトのフォールバック") as HTMLSelectElement).value,
    ).toBe("strongest");
  });

  it("shows the resolution preview", () => {
    renderEditor();
    open();
    expect(screen.getAllByText(/現在の解決結果/).length).toBe(3);
  });

  it("shows a failure preview when every candidate is unconnected", () => {
    render(
      <Harness
        initial={{
          version: 2,
          modes: {
            balanced: {
              light: {
                candidates: [
                  { kind: "model", providerID: "beta", modelID: "premium" },
                ],
                fallback: "error",
              },
            },
          },
        }}
      />,
    );
    open();
    expect(
      screen.getAllByText("解決できません（候補が全て未接続です）").length,
    ).toBe(1);
  });
});
