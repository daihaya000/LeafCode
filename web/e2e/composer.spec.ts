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

  test("waits for the selected project's base branch before submitting", async ({
    page,
  }) => {
    let submitted: Record<string, unknown> | null = null;
    await page.route("**/api/projects", (route) =>
      route.fulfill({
        json: {
          projects: [
            {
              id: "project-a",
              name: "Project A",
              rootPath: "C:\\repo-a",
              favorite: true,
            },
            {
              id: "project-b",
              name: "Project B",
              rootPath: "C:\\repo-b",
              favorite: false,
            },
          ],
        },
      }),
    );
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() === "POST") {
        submitted = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ json: { taskId: "created-task" } });
        return;
      }
      await route.fulfill({ json: { tasks: [], engineOk: true } });
    });
    await page.route("**/api/git/branches**", async (route) => {
      const directory = new URL(route.request().url()).searchParams.get(
        "directory",
      );
      if (directory === "C:\\repo-b") {
        await new Promise((resolve) => setTimeout(resolve, 300));
        await route.fulfill({
          json: {
            branches: ["develop"],
            current: "develop",
            defaultTarget: "develop",
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          branches: ["master"],
          current: "master",
          defaultTarget: "master",
        },
      });
    });

    await page.goto("/");
    const project = page.getByRole("combobox", { name: "プロジェクト" });
    const submit = page.getByRole("button", { name: "タスク開始" });
    const prompt = page.getByPlaceholder(
      "タスクを説明してください…（Ctrl+Enter で開始）",
    );
    await expect(project).toHaveValue("project-a");
    await project.selectOption("project-b");
    await prompt.fill("branch race regression");

    await expect(submit).toBeDisabled();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect.poll(() => submitted).not.toBeNull();
    expect(submitted).toMatchObject({
      projectId: "project-b",
      isolation: "git_worktree",
      baseBranch: "develop",
    });
  });

  test("selects the project requested by the URL", async ({ page }) => {
    await page.route("**/api/projects", (route) =>
      route.fulfill({
        json: {
          projects: [
            { id: "project-a", name: "Project A", rootPath: "C:\\repo-a", favorite: false },
            { id: "project-b", name: "Project B", rootPath: "C:\\repo-b", favorite: true },
          ],
        },
      }),
    );
    await page.route("**/api/git/branches**", (route) =>
      route.fulfill({
        json: { branches: ["main"], current: "main", defaultTarget: "main" },
      }),
    );

    await page.goto("/?projectId=project-b");
    await expect(page.getByRole("combobox", { name: "プロジェクト" })).toHaveValue(
      "project-b",
    );

    await page.goto("/?projectId=missing");
    await expect(page.getByRole("combobox", { name: "プロジェクト" })).toHaveValue(
      "project-a",
    );
  });
});
