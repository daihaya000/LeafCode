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
