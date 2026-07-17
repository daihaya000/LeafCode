import { expect, test } from "@playwright/test";

// These run without a live OpenCode engine; only the app shell is asserted.

test("home renders the composer shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "何をつくりますか？" })).toBeVisible();
  await expect(
    page.getByPlaceholder("タスクを説明してください…（Ctrl+Enter で開始）"),
  ).toBeVisible();
});

test("desktop composer keeps selection labels readable", async ({ page }) => {
  await page.route("**/api/opencode/provider", (route) =>
    route.fulfill({
      json: {
        all: [
          {
            id: "openai",
            name: "OpenAI",
            models: { "gpt-5.6-sol": { name: "GPT-5.6 Sol" } },
          },
        ],
        connected: ["openai"],
        default: { openai: "gpt-5.6-sol" },
      },
    }),
  );
  await page.route("**/api/opencode/config", (route) =>
    route.fulfill({ json: { model: "openai/gpt-5.6-sol", agent: "build" } }),
  );
  await page.route("**/api/opencode/agent", (route) =>
    route.fulfill({ json: [{ name: "build" }] }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: {
        projects: [
          {
            id: "project-1",
            name: "opencode",
            rootPath: "C:\\repo",
            favorite: true,
          },
        ],
      },
    }),
  );
  await page.route("**/api/git/branches**", (route) =>
    route.fulfill({
      json: { branches: ["master"], current: "master", defaultTarget: "master" },
    }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("webui:access-mode", "full"),
  );

  await page.goto("/");
  const form = page.getByRole("form", { name: "タスク作成" });
  const displayLabel = (name: string) =>
    page
      .getByRole("combobox", { name })
      .locator("..")
      .locator('span[aria-hidden="true"]')
      .nth(1);
  await expect(displayLabel("モデル")).toHaveText("GPT-5.6 Sol");
  await expect(displayLabel("エージェント")).toHaveText("build（Code）");
  expect((await form.boundingBox())?.width).toBeGreaterThanOrEqual(850);

  const selectionNames = [
    "プロジェクト",
    "作業場所",
    "モデル",
    "エージェント",
    "アクセスモード",
  ];
  for (const name of selectionNames) {
    const label = displayLabel(name);
    const size = await label.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(size.clientWidth, `${name} label is truncated`).toBeGreaterThanOrEqual(
      size.scrollWidth,
    );
  }

  await page.setViewportSize({ width: 1024, height: 720 });
  for (const name of selectionNames) {
    const size = await displayLabel(name).evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(
      size.clientWidth,
      `${name} label is truncated at 1024px`,
    ).toBeGreaterThanOrEqual(size.scrollWidth);
  }
});

test("has the expected document title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/OpenCode/);
});

test("settings page renders its sections", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Remote Workspace" }),
  ).toBeVisible();
});

test("theme toggle switches the color scheme", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  const toggle = page.getByRole("button", { name: "テーマ切替" });
  await expect(toggle).toBeVisible();
  const before = (await html.getAttribute("class")) ?? "";
  await toggle.click();
  await expect(html).not.toHaveClass(before);
});

test("CodexBar plugin widget renders bottom-right by default", async ({ page }) => {
  await page.goto("/");
  // Default-enabled plugin widget; renders regardless of whether CodexBar data exists.
  await expect(page.getByText("CodexBar 利用状況")).toBeVisible();
  // Collapsing the widget hides the full header and shows the compact pill.
  await page.getByRole("button", { name: "折りたたむ" }).click();
  await expect(page.getByText("CodexBar 利用状況")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "CodexBar 利用状況を開く" })).toBeVisible();
});

test("settings exposes the plugin toggle", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "プラグイン" })).toBeVisible();
  await expect(
    page.getByTitle("このウィジェットを閉じる（設定から再表示できます）"),
  ).toHaveCount(0);
  const toggle = page.getByRole("switch");
  const thumb = toggle.locator("span");
  await expect(toggle).toBeVisible();

  const expectThumbInsideTrack = async () => {
    const [trackBox, thumbBox] = await Promise.all([
      toggle.boundingBox(),
      thumb.boundingBox(),
    ]);
    expect(trackBox).not.toBeNull();
    expect(thumbBox).not.toBeNull();
    expect(thumbBox!.x).toBeGreaterThanOrEqual(trackBox!.x);
    expect(thumbBox!.x + thumbBox!.width).toBeLessThanOrEqual(
      trackBox!.x + trackBox!.width,
    );
  };

  await expectThumbInsideTrack();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expectThumbInsideTrack();
});
