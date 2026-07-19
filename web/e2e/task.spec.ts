import { expect, test, type Page, type Route } from "@playwright/test";

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

const planPrompt = "この計画を承認します。計画に従って実装を開始してください。";

type PlanMockOptions = {
  messages?: unknown[] | (() => unknown[]);
  status?: "idle" | "busy";
  permissions?: unknown[];
  questions?: unknown[];
  onPrompt?: (route: Route, body: unknown, attempt: number) => Promise<void> | void;
  onContent?: (route: Route, attempt: number) => Promise<void> | void;
};

function planMessage(id: string, path: string, completed = true) {
  return {
    info: {
      id,
      sessionID: "session-1",
      role: "assistant",
      agent: "plan",
      time: completed ? { completed: 1 } : {},
    },
    parts: [{ id: `${id}-part`, messageID: id, type: "text", text: path }],
  };
}

async function mockPlanTask(page: Page, options: PlanMockOptions = {}) {
  const planTask = { ...task, status: options.status === "busy" ? "working" : "ready" };
  let promptAttempts = 0;
  let contentAttempts = 0;

  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: {
        projects: [
          { id: "project-1", name: "Project", rootPath: "C:\\repo", favorite: true },
        ],
      },
    }),
  );
  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json:
        url.pathname === "/api/tasks/task-1"
          ? { task: planTask }
          : { tasks: [planTask], engineOk: true },
    });
  });
  await page.route("**/api/diff/files**", (route) =>
    route.fulfill({
      json: { git: true, branch: "main", files: [], additions: 0, deletions: 0 },
    }),
  );
  await page.route("**/api/files/content**", async (route) => {
    contentAttempts += 1;
    if (options.onContent) {
      await options.onContent(route, contentAttempts);
      return;
    }
    await route.fulfill({
      json: { name: "plan.md", content: "# Release Plan\n\n- Ship safely" },
    });
  });
  await page.route("**/api/opencode/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() === "POST" &&
      url.pathname.endsWith("/session/session-1/prompt_async")
    ) {
      promptAttempts += 1;
      const body = route.request().postDataJSON();
      if (options.onPrompt) {
        await options.onPrompt(route, body, promptAttempts);
      } else {
        await route.fulfill({ json: {} });
      }
      return;
    }
    if (url.pathname.endsWith("/provider")) {
      await route.fulfill({
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
      });
      return;
    }
    if (url.pathname.endsWith("/config")) {
      await route.fulfill({ json: { agent: "plan" } });
      return;
    }
    if (url.pathname.endsWith("/agent")) {
      await route.fulfill({ json: [{ name: "plan" }, { name: "build" }] });
      return;
    }
    if (url.pathname.endsWith("/session/session-1/message")) {
      const messages =
        typeof options.messages === "function"
          ? options.messages()
          : options.messages ?? [];
      await route.fulfill({ json: messages });
      return;
    }
    if (url.pathname.endsWith("/session/status")) {
      await route.fulfill({ json: { "session-1": { type: options.status ?? "idle" } } });
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
    if (url.pathname.endsWith("/permission")) {
      await route.fulfill({ json: options.permissions ?? [] });
      return;
    }
    if (url.pathname.endsWith("/question")) {
      await route.fulfill({ json: options.questions ?? [] });
      return;
    }
    if (url.pathname.endsWith("/event")) {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

test("shows consolidated response metadata", async ({ page }) => {
  await mockPlanTask(page, {
    messages: [{
      info: {
        id: "response-1",
        sessionID: "session-1",
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.6-sol",
        cost: 0.0042,
        agent: "build",
        time: { completed: 1 },
      },
      parts: [{
        id: "response-part-1",
        messageID: "response-1",
        type: "text",
        text: "回答本文",
      }],
    }],
  });
  await page.goto("/task/task-1");
  const metadata = page.getByLabel("応答メタデータ").first();
  await expect(metadata).toContainText("GPT-5.6 Sol");
  await expect(metadata).toContainText("cost $0.0042");
  await expect(metadata).not.toContainText("build");
  await expect(page.getByText("cost $0.0042", { exact: true })).toHaveCount(1);
});

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

test("renders Plan Markdown and submits one Build approval for the latest Plan", async ({ page }) => {
  const prompts: unknown[] = [];
  await mockPlanTask(page, {
    messages: [
      planMessage("plan-older", "C:\\repo\\docs\\older-plan.md"),
      planMessage("plan-latest", "C:\\repo\\docs\\plan.md"),
      {
        info: { id: "ordinary", role: "assistant", time: { completed: 1 } },
        parts: [{ id: "ordinary-part", messageID: "ordinary", type: "text", text: "通常の応答" }],
      },
    ],
    onPrompt: async (route, body) => {
      prompts.push(body);
      await route.fulfill({ json: {} });
    },
  });

  await page.goto("/task/task-1");

  await expect(page.getByRole("heading", { name: "Release Plan" })).toHaveCount(2);
  await expect(page.getByText("通常の応答")).toBeVisible();
  await expect(page.getByText("C:\\repo\\docs\\older-plan.md")).toHaveCount(0);
  await expect(page.getByText("C:\\repo\\docs\\plan.md")).toHaveCount(0);

  const approve = page.getByRole("button", { name: "承認して実装" });
  await expect(approve).toHaveCount(1);
  await approve.dblclick();

  await expect.poll(() => prompts).toHaveLength(1);
  expect(prompts[0]).toMatchObject({
    agent: "build",
    parts: [{ type: "text", text: planPrompt }],
  });
  await expect(page.getByRole("button", { name: "実装を開始しました" })).toBeDisabled();
  await expect(page.getByLabel("エージェント")).toHaveValue("build");
});

test("retries a failed Plan document request without exposing its path", async ({ page }) => {
  await mockPlanTask(page, {
    messages: [planMessage("plan", "C:\\repo\\docs\\plan.md")],
    onContent: async (route, attempt) => {
      if (attempt === 1) {
        await route.fulfill({ status: 500, json: { error: "unavailable" } });
        return;
      }
      await route.fulfill({
        json: { name: "plan.md", content: "# Retried Plan\n\n- Continue" },
      });
    },
  });

  await page.goto("/task/task-1");

  await expect(page.locator('[role="alert"]').filter({ hasText: "計画書を読み込めませんでした" })).toBeVisible();
  await expect(page.getByText("C:\\repo\\docs\\plan.md")).toHaveCount(0);
  await page.getByRole("button", { name: "再試行" }).click();
  await expect(page.getByRole("heading", { name: "Retried Plan" })).toBeVisible();
});

test("retries a failed approval and marks the Plan submitted only after success", async ({ page }) => {
  const prompts: unknown[] = [];
  await mockPlanTask(page, {
    messages: [planMessage("plan", "C:\\repo\\docs\\plan.md")],
    onPrompt: async (route, body, attempt) => {
      prompts.push(body);
      await route.fulfill(
        attempt === 1
          ? { status: 500, json: { error: "unavailable" } }
          : { json: {} },
      );
    },
  });

  await page.goto("/task/task-1");
  const approve = page.getByRole("button", { name: "承認して実装" });
  await expect(approve).toBeEnabled();
  await approve.click();

  await expect(page.locator('[role="alert"]').filter({ hasText: "実装開始の送信に失敗しました" })).toBeVisible();
  await expect(approve).toBeEnabled();
  await approve.click();

  await expect.poll(() => prompts).toHaveLength(2);
  await expect(page.getByRole("button", { name: "実装を開始しました" })).toBeDisabled();
});

test("disables approval while the task is busy", async ({ page }) => {
  const prompts: unknown[] = [];
  await mockPlanTask(page, {
    status: "busy",
    messages: [planMessage("plan", "C:\\repo\\docs\\plan.md")],
    onPrompt: async (route, body) => {
      prompts.push(body);
      await route.fulfill({ json: {} });
    },
  });

  await page.goto("/task/task-1");
  const approve = page.getByRole("button", { name: "承認して実装" });
  await expect(approve).toBeDisabled();
  await approve.click({ force: true });
  await expect.poll(() => prompts).toHaveLength(0);
});

test("does not treat an unfinished Plan response as actionable", async ({ page }) => {
  await mockPlanTask(page, {
    messages: [planMessage("unfinished-plan", "C:\\repo\\docs\\plan.md", false)],
  });

  await page.goto("/task/task-1");

  await expect(page.getByRole("button", { name: "承認して実装" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Release Plan" })).toHaveCount(0);
});

function approvalUserMessage(id: string) {
  return {
    info: { id, sessionID: "session-1", role: "user", agent: "build", time: { created: 2 } },
    parts: [{ id: `${id}-part`, messageID: id, type: "text", text: planPrompt }],
  };
}

test("keeps the Plan approved after reload and blocks a duplicate approval POST", async ({ page }) => {
  const prompts: unknown[] = [];
  let approved = false;
  await mockPlanTask(page, {
    messages: () =>
      approved
        ? [planMessage("plan", "C:\\repo\\docs\\plan.md"), approvalUserMessage("approval")]
        : [planMessage("plan", "C:\\repo\\docs\\plan.md")],
    onPrompt: async (route, body) => {
      prompts.push(body);
      approved = true;
      await route.fulfill({ json: {} });
    },
  });

  await page.goto("/task/task-1");
  await page.getByRole("button", { name: "承認して実装" }).click();

  await expect.poll(() => prompts).toHaveLength(1);
  await expect(page.getByRole("button", { name: "実装を開始しました" })).toBeDisabled();

  // Reload: the approval now lives in session history, so the card must stay
  // disabled and expose no way to resubmit the same approval prompt.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Release Plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "実装を開始しました" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "承認して実装" })).toHaveCount(0);

  await page.waitForTimeout(300);
  expect(prompts).toHaveLength(1);
});

test("keeps ordinary Plan Markdown body while suppressing only the path source part", async ({ page }) => {
  await mockPlanTask(page, {
    messages: [
      {
        info: {
          id: "plan",
          sessionID: "session-1",
          role: "assistant",
          agent: "plan",
          time: { completed: 1 },
        },
        parts: [
          { id: "plan-body", messageID: "plan", type: "text", text: "計画の概要はこちらです。" },
          { id: "plan-path", messageID: "plan", type: "text", text: "C:\\repo\\docs\\plan.md" },
        ],
      },
    ],
  });

  await page.goto("/task/task-1");

  await expect(page.getByText("計画の概要はこちらです。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Release Plan" })).toBeVisible();
  await expect(page.getByText("C:\\repo\\docs\\plan.md")).toHaveCount(0);
});

test("requests Plan content with the task directory and path query", async ({ page }) => {
  const contentUrls: string[] = [];
  await mockPlanTask(page, {
    messages: [planMessage("plan", "C:\\repo\\docs\\plan.md")],
    onContent: async (route) => {
      contentUrls.push(route.request().url());
      await route.fulfill({
        json: { name: "plan.md", content: "# Release Plan\n\n- Ship safely" },
      });
    },
  });

  await page.goto("/task/task-1");
  await expect(page.getByRole("heading", { name: "Release Plan" })).toBeVisible();

  expect(contentUrls).toHaveLength(1);
  const query = new URL(contentUrls[0]).searchParams;
  expect(query.get("directory")).toBe("C:\\repo");
  expect(query.get("path")).toBe("C:\\repo\\docs\\plan.md");
});

test("does not replace permission, question, or generic file parts with a Plan card", async ({ page }) => {
  await mockPlanTask(page, {
    messages: [
      {
        info: { id: "generic", sessionID: "session-1", role: "assistant", time: { completed: 1 } },
        parts: [
          { id: "generic-part", messageID: "generic", type: "file", filename: "C:\\repo\\docs\\readme.md" },
        ],
      },
    ],
    permissions: [
      { id: "perm-1", sessionID: "session-1", permission: "bash", patterns: ["ls"] },
    ],
    questions: [
      {
        id: "q-1",
        sessionID: "session-1",
        questions: [{ question: "続行しますか？", header: "確認事項", options: [] }],
      },
    ],
  });

  await page.goto("/task/task-1");

  // Generic file part still renders and is not converted into a Plan card.
  await expect(page.getByRole("button", { name: "C:\\repo\\docs\\readme.md" })).toBeVisible();
  await expect(page.getByRole("button", { name: "承認して実装" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Release Plan" })).toHaveCount(0);
  // Permission and question surfaces are untouched by Plan rendering.
  await expect(page.getByText("権限の承認が必要です")).toBeVisible();
  await expect(page.getByText("確認事項")).toBeVisible();
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
