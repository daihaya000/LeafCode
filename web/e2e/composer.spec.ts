import { expect, test, type Page } from "@playwright/test";

// Engine-independent regression coverage for the redesigned home composer.
//
// The project/workspace/access-mode/intelligence/model pickers are custom
// GhostSelect / ModelSelect widgets (trigger button with
// aria-haspopup="listbox" + a portal-rendered role="listbox" menu), not
// native <select> elements. Interact with them via click + role="option",
// and read the current value via the trigger's `value` attribute (mirrored
// from the underlying business value even though it is a <button>).

async function pickOption(page: Page, optionName: string) {
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

test.describe("home composer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "OpenCodeWebUI" }),
    ).toBeVisible();
  });

  test("exposes engine-independent settings as accessible triggers", async ({ page }) => {
    const project = page.getByRole("button", { name: "プロジェクト", exact: true });
    const workspace = page.getByRole("button", { name: "作業場所" });
    const accessMode = page.getByRole("button", { name: "アクセスモード" });

    await expect(project).toBeAttached();
    await expect(workspace).toBeVisible();
    await expect(accessMode).toBeVisible();

    await expect(workspace).toBeEnabled();
    await workspace.click();
    await pickOption(page, "worktree");
    await expect(workspace).toHaveAttribute("value", "git_worktree");
    await workspace.click();
    await pickOption(page, "master");
    await expect(workspace).toHaveAttribute("value", "current_folder");

    await expect(accessMode).toBeEnabled();
    await accessMode.click();
    await pickOption(page, "フルアクセス");
    await expect(accessMode).toHaveAttribute("value", "full");
    await accessMode.click();
    await pickOption(page, "確認する");
    await expect(accessMode).toHaveAttribute("value", "ask");

    // Project data can be empty without a live engine/repository setup. If a
    // project is available, verify the trigger remains operable too.
    if (await project.isEnabled()) {
      const value = await project.getAttribute("value");
      await project.click();
      await expect(page.getByRole("listbox", { name: "プロジェクト" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(project).toHaveAttribute("value", value ?? "");
    } else {
      await expect(project).toHaveAttribute("value", "");
    }
  });

  test("settings triggers are keyboard focus targets", async ({ page }) => {
    const focusableTriggers = [
      page.getByRole("button", { name: "作業場所" }),
      page.getByRole("button", { name: "アクセスモード" }),
    ];

    const project = page.getByRole("button", { name: "プロジェクト", exact: true });
    if (await project.isEnabled()) {
      focusableTriggers.unshift(project);
    }

    for (const trigger of focusableTriggers) {
      await trigger.focus();
      await expect(trigger).toBeFocused();
      await expect
        .poll(async () =>
          trigger.evaluate((element) => document.activeElement === element),
        )
        .toBe(true);
    }
  });

  test("does not create page-level horizontal scroll at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "OpenCodeWebUI" }),
    ).toBeVisible();

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
    const project = page.getByRole("button", { name: "プロジェクト", exact: true });
    const workspace = page.getByRole("button", { name: "作業場所" });
    const submit = page.getByRole("button", { name: "タスク開始" });
    const prompt = page.getByPlaceholder(
      "タスクを説明してください…（Ctrl+Enter で開始）",
    );
    await expect(project).toHaveAttribute("value", "project-a");
    await project.click();
    await pickOption(page, "Project B");
    // The default isolation is now current_folder; explicitly opt into a
    // worktree so the base-branch wait still gates submission.
    await workspace.click();
    await pickOption(page, "worktree");
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
    await expect(page.getByRole("button", { name: "プロジェクト", exact: true })).toHaveAttribute(
      "value",
      "project-b",
    );

    await page.goto("/?projectId=missing");
    await expect(page.getByRole("button", { name: "プロジェクト", exact: true })).toHaveAttribute(
      "value",
      "project-a",
    );
  });

  test("defaults workspace to current_folder", async ({ page }) => {
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
        json: {
          branches: ["master"],
          current: "master",
          defaultTarget: "master",
        },
      }),
    );

    await page.goto("/");
    const workspace = page.getByRole("button", { name: "作業場所" });
    await expect(workspace).toHaveAttribute("value", "current_folder");
  });

  async function mockVariantProvider(page: Page) {
    await page.route("**/api/opencode/provider", (route) =>
      route.fulfill({
        json: {
          all: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.6-sol": {
                  name: "GPT-5.6 Sol",
                  variants: { high: {}, low: {} },
                },
              },
            },
          ],
          connected: ["openai"],
          default: { openai: "gpt-5.6-sol" },
        },
      }),
    );
    await page.route("**/api/opencode/config", (route) =>
      route.fulfill({
        json: { model: "openai/gpt-5.6-sol", agent: "build" },
      }),
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
        json: {
          branches: ["master"],
          current: "master",
          defaultTarget: "master",
        },
      }),
    );
  }

  test("shows intelligence selector when model declares variants", async ({
    page,
  }) => {
    await mockVariantProvider(page);

    await page.goto("/");
    const intelligence = page.getByRole("button", {
      name: "インテリジェンス",
    });
    await expect(intelligence).toBeVisible();
    await expect(intelligence).toHaveAttribute("value", "");
    await intelligence.click();
    const options = await page
      .getByRole("listbox", { name: "インテリジェンス" })
      .getByRole("option")
      .allTextContents();
    expect(options).toEqual(["デフォルト", "low", "high"]);
  });

  test("hides intelligence selector when model has no variants", async ({
    page,
  }) => {
    await page.route("**/api/opencode/provider", (route) =>
      route.fulfill({
        json: {
          all: [
            {
              id: "openai",
              name: "OpenAI",
              models: { "gpt-4": { name: "GPT-4" } },
            },
          ],
          connected: ["openai"],
          default: { openai: "gpt-4" },
        },
      }),
    );
    await page.route("**/api/opencode/config", (route) =>
      route.fulfill({ json: { model: "openai/gpt-4", agent: "build" } }),
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
        json: {
          branches: ["master"],
          current: "master",
          defaultTarget: "master",
        },
      }),
    );

    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "インテリジェンス" }),
    ).toHaveCount(0);
  });

  test("resets intelligence to default when model changes", async ({
    page,
  }) => {
    await page.route("**/api/opencode/provider", (route) =>
      route.fulfill({
        json: {
          all: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-5.6-sol": {
                  name: "GPT-5.6 Sol",
                  variants: { high: {}, low: {} },
                },
                "gpt-4": { name: "GPT-4" },
              },
            },
          ],
          connected: ["openai"],
          default: { openai: "gpt-5.6-sol" },
        },
      }),
    );
    await page.route("**/api/opencode/config", (route) =>
      route.fulfill({
        json: { model: "openai/gpt-5.6-sol", agent: "build" },
      }),
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
        json: {
          branches: ["master"],
          current: "master",
          defaultTarget: "master",
        },
      }),
    );

    await page.goto("/");
    const intelligence = page.getByRole("button", {
      name: "インテリジェンス",
    });
    await expect(intelligence).toBeVisible();
    await intelligence.click();
    await pickOption(page, "high");
    await expect(intelligence).toHaveAttribute("value", "high");

    // Switch to a model without variants — selector disappears, state resets
    const model = page.getByRole("button", { name: "モデル" });
    await model.click();
    await pickOption(page, "GPT-4");
    await expect(intelligence).toHaveCount(0);
  });

  test("sends variant in POST body when non-default is selected", async ({
    page,
  }) => {
    let postedBody: Record<string, unknown> | null = null;
    await mockVariantProvider(page);
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() === "POST") {
        postedBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ json: { taskId: "created-task" } });
        return;
      }
      await route.fulfill({ json: { tasks: [], engineOk: true } });
    });

    await page.goto("/");
    const prompt = page.getByPlaceholder(
      "タスクを説明してください…（Ctrl+Enter で開始）",
    );
    await prompt.fill("build a feature");
    const intelligence = page.getByRole("button", {
      name: "インテリジェンス",
    });
    await intelligence.click();
    await pickOption(page, "high");
    await page.getByRole("button", { name: "タスク開始" }).click();
    await expect.poll(() => postedBody).not.toBeNull();
    expect(postedBody).toMatchObject({
      variant: "high",
    });
  });

  test("omits variant from POST body when default is selected", async ({
    page,
  }) => {
    let postedBody: Record<string, unknown> | null = null;
    await mockVariantProvider(page);
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() === "POST") {
        postedBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ json: { taskId: "created-task" } });
        return;
      }
      await route.fulfill({ json: { tasks: [], engineOk: true } });
    });

    await page.goto("/");
    const prompt = page.getByPlaceholder(
      "タスクを説明してください…（Ctrl+Enter で開始）",
    );
    await prompt.fill("build a feature");
    await page.getByRole("button", { name: "タスク開始" }).click();
    await expect.poll(() => postedBody).not.toBeNull();
    expect(postedBody).not.toHaveProperty("variant");
  });

  test("lists the Auto option first in the model menu", async ({ page }) => {
    await mockVariantProvider(page);

    await page.goto("/");
    const model = page.getByRole("button", { name: "モデル" });
    // Wait for the provider list to settle before opening the menu.
    // ModelSelect values use the `provider::model` key form.
    await expect(model).toHaveAttribute("value", "openai::gpt-5.6-sol");
    await model.click();
    const options = await page
      .getByRole("listbox", { name: "モデル" })
      .getByRole("option")
      .allTextContents();
    expect(options[0]).toBe("Auto（コスト最適）");
  });

  test("hides the intelligence selector while Auto is selected", async ({
    page,
  }) => {
    await mockVariantProvider(page);

    await page.goto("/");
    const intelligence = page.getByRole("button", {
      name: "インテリジェンス",
    });
    await expect(intelligence).toBeVisible();

    const model = page.getByRole("button", { name: "モデル" });
    await model.click();
    await pickOption(page, "Auto（コスト最適）");
    await expect(model).toHaveAttribute("value", "auto");
    await expect(intelligence).toHaveCount(0);
  });

  test("shows optimize selector for Auto and sends its mode in the POST body", async ({
    page,
  }) => {
    let postedBody: Record<string, unknown> | null = null;
    await mockVariantProvider(page);
    await page.route("**/api/tasks", async (route) => {
      if (route.request().method() === "POST") {
        postedBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ json: { taskId: "created-task" } });
        return;
      }
      await route.fulfill({ json: { tasks: [], engineOk: true } });
    });

    await page.goto("/");
    const prompt = page.getByPlaceholder(
      "タスクを説明してください…（Ctrl+Enter で開始）",
    );
    await prompt.fill("これは何");
    const model = page.getByRole("button", { name: "モデル" });
    await model.click();
    await pickOption(page, "Auto（コスト最適）");
    await expect(model).toHaveAttribute("value", "auto");

    const optimize = page.getByRole("button", { name: "Auto の最適化" });
    await expect(optimize).toBeVisible();
    await optimize.click();
    await pickOption(page, "知能優先");
    await expect(optimize).toHaveAttribute("value", "intelligence");

    await page.getByRole("button", { name: "タスク開始" }).click();
    await expect.poll(() => postedBody).not.toBeNull();
    expect(postedBody).toMatchObject({
      auto: true,
      autoOptimize: "intelligence",
    });
    expect(postedBody).not.toHaveProperty("model");
    expect(postedBody).not.toHaveProperty("variant");
  });
});
