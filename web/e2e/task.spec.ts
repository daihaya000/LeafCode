import { expect, test, type Page } from "@playwright/test";

const task = {
  id: "task-1",
  projectId: "project-1",
  projectName: "Project",
  title: "Busy task",
  directory: "C:\\repo",
  isolation: "current_folder",
  status: "working",
  sessionId: "session-1",
  branch: "main",
  additions: 0,
  deletions: 0,
  filesChanged: 0,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};

async function mockBusyTask(page: Page, onPrompt: () => void) {
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: {
        projects: [
          {
            id: "project-1",
            name: "Project",
            rootPath: "C:\\repo",
            favorite: true,
          },
        ],
      },
    }),
  );
  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/tasks/task-1") {
      await route.fulfill({ json: { task } });
      return;
    }
    await route.fulfill({ json: { tasks: [task], engineOk: true } });
  });
  await page.route("**/api/diff/files**", (route) =>
    route.fulfill({
      json: {
        git: true,
        branch: "main",
        files: [],
        additions: 0,
        deletions: 0,
      },
    }),
  );
  await page.route("**/api/opencode/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === "POST" &&
      url.pathname.endsWith("/session/session-1/prompt_async")
    ) {
      onPrompt();
      await route.fulfill({ json: {} });
      return;
    }
    if (url.pathname.endsWith("/provider")) {
      await route.fulfill({ json: { all: [], connected: [], default: {} } });
      return;
    }
    if (url.pathname.endsWith("/config")) {
      await route.fulfill({ json: {} });
      return;
    }
    if (url.pathname.endsWith("/agent")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/session/session-1/message")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/session/status")) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ json: { "session-1": { type: "busy" } } });
      return;
    }
    if (url.pathname.endsWith("/session/session-1/todo")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/session/session-1")) {
      await route.fulfill({ json: {} });
      return;
    }
    if (url.pathname.endsWith("/permission") || url.pathname.endsWith("/question")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/event")) {
      await route.fulfill({
        contentType: "text/event-stream",
        body: "",
      });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

test("follow-up composer cannot submit while the task is busy", async ({ page }) => {
  let promptPosts = 0;
  await mockBusyTask(page, () => {
    promptPosts += 1;
  });

  await page.goto("/task/task-1");
  const composer = page.getByPlaceholder("フォローアップを送信…");
  await expect(composer).toBeEditable();
  await composer.fill("draft while running");
  await expect(composer).toHaveAttribute("readonly", "");

  await composer.press("Enter");
  await expect.poll(() => promptPosts).toBe(0);
  await expect(composer).toHaveValue("draft while running");
});

async function mockIdleVariantTask(
  page: Page,
  onPrompt?: (body: Record<string, unknown>) => void,
) {
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
            name: "Project",
            rootPath: "C:\\repo",
            favorite: true,
          },
        ],
      },
    }),
  );
  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/tasks/task-1") {
      await route.fulfill({ json: { task } });
      return;
    }
    await route.fulfill({ json: { tasks: [task], engineOk: true } });
  });
  await page.route("**/api/diff/files**", (route) =>
    route.fulfill({
      json: {
        git: true,
        branch: "main",
        files: [],
        additions: 0,
        deletions: 0,
      },
    }),
  );
  await page.route("**/api/opencode/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === "POST" &&
      url.pathname.endsWith("/session/session-1/prompt_async")
    ) {
      if (onPrompt) {
        onPrompt(route.request().postDataJSON() as Record<string, unknown>);
      }
      await route.fulfill({ json: {} });
      return;
    }
    if (url.pathname.endsWith("/provider")) {
      await route.fulfill({
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
      });
      return;
    }
    if (url.pathname.endsWith("/config")) {
      await route.fulfill({
        json: { model: "openai/gpt-5.6-sol", agent: "build" },
      });
      return;
    }
    if (url.pathname.endsWith("/agent")) {
      await route.fulfill({ json: [{ name: "build" }] });
      return;
    }
    if (url.pathname.endsWith("/session/session-1/message")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/session/status")) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ json: { "session-1": { type: "idle" } } });
      return;
    }
    if (url.pathname.endsWith("/session/session-1/todo")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/session/session-1")) {
      await route.fulfill({ json: {} });
      return;
    }
    if (url.pathname.endsWith("/permission") || url.pathname.endsWith("/question")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname.endsWith("/event")) {
      await route.fulfill({
        contentType: "text/event-stream",
        body: "",
      });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

test("follow-up composer sends variant when non-default is selected", async ({
  page,
}) => {
  let promptBody: Record<string, unknown> | null = null;
  await mockIdleVariantTask(page, (body) => {
    promptBody = body;
  });

  await page.goto("/task/task-1");
  const intelligence = page.getByRole("combobox", {
    name: "インテリジェンス",
  });
  await expect(intelligence).toBeVisible();
  await intelligence.selectOption("low");

  const composer = page.getByPlaceholder("フォローアップを送信…");
  await expect(composer).toBeEditable();
  await composer.fill("follow up with low intelligence");
  await page.getByRole("button", { name: "送信" }).click();
  await expect.poll(() => promptBody).not.toBeNull();
  expect(promptBody).toMatchObject({
    variant: "low",
  });
});

test("follow-up composer omits variant when default is selected", async ({
  page,
}) => {
  let promptBody: Record<string, unknown> | null = null;
  await mockIdleVariantTask(page, (body) => {
    promptBody = body;
  });

  await page.goto("/task/task-1");
  const composer = page.getByPlaceholder("フォローアップを送信…");
  await expect(composer).toBeEditable();
  await composer.fill("follow up with default intelligence");
  await page.getByRole("button", { name: "送信" }).click();
  await expect.poll(() => promptBody).not.toBeNull();
  expect(promptBody).not.toHaveProperty("variant");
});
