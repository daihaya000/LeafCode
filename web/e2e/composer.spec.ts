import { expect, test } from "@playwright/test";

// Engine-independent regression coverage for the redesigned home composer.

test.describe("home composer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "何をつくりますか？" })).toBeVisible();
  });

  test("exposes engine-independent settings as native comboboxes", async ({ page }) => {
    const project = page.getByRole("combobox", { name: "プロジェクト" });
    const workspace = page.getByRole("combobox", { name: "作業場所" });
    const accessMode = page.getByRole("combobox", { name: "アクセスモード" });

    await expect(project).toBeAttached();
    await expect(workspace).toBeVisible();
    await expect(accessMode).toBeVisible();

    await expect(workspace).toBeEnabled();
    await workspace.selectOption("current_folder");
    await expect(workspace).toHaveValue("current_folder");
    await workspace.selectOption("git_worktree");
    await expect(workspace).toHaveValue("git_worktree");

    await expect(accessMode).toBeEnabled();
    await accessMode.selectOption("full");
    await expect(accessMode).toHaveValue("full");
    await accessMode.selectOption("ask");
    await expect(accessMode).toHaveValue("ask");

    // Project data can be empty without a live engine/repository setup. If a
    // project is available, verify the native select remains operable too.
    if (await project.isEnabled()) {
      const value = await project.inputValue();
      await project.selectOption(value);
      await expect(project).toHaveValue(value);
    } else {
      await expect(project).toHaveValue("");
    }
  });

  test("native selects are keyboard focus targets", async ({ page }) => {
    const focusableSelects = [
      page.getByRole("combobox", { name: "作業場所" }),
      page.getByRole("combobox", { name: "アクセスモード" }),
    ];

    const project = page.getByRole("combobox", { name: "プロジェクト" });
    if (await project.isEnabled()) {
      focusableSelects.unshift(project);
    }

    for (const select of focusableSelects) {
      await select.focus();
      await expect(select).toBeFocused();
      await expect
        .poll(async () =>
          select.evaluate((element) => document.activeElement === element),
        )
        .toBe(true);
    }
  });

  test("does not create page-level horizontal scroll at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "何をつくりますか？" })).toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        ),
      )
      .toBe(true);
  });

  test("keeps the submit button disabled while the prompt is empty", async ({ page }) => {
    await expect(page.getByRole("button", { name: "タスク開始" })).toBeDisabled();
  });
});
