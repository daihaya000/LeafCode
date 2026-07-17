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
