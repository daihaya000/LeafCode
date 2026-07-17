import { expect, test } from "@playwright/test";

// These run without a live OpenCode engine; only the app shell is asserted.

test("home renders the composer shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "何をつくりますか？" })).toBeVisible();
  await expect(
    page.getByPlaceholder("タスクを説明してください…（Ctrl+Enter で開始）"),
  ).toBeVisible();
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
