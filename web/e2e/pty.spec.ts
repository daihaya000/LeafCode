import { expect, test, type Page } from "@playwright/test";

const task = {
  id: "task-1",
  projectId: "project-1",
  projectName: "Project",
  title: "Pty task",
  directory: "C:\\repo",
  isolation: "current_folder",
  status: "ready",
  sessionId: "session-1",
  branch: "main",
  additions: 0,
  deletions: 0,
  filesChanged: 0,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};

async function mockTaskShell(page: Page) {
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
          ? { task }
          : { tasks: [task], engineOk: true },
    });
  });
  await page.route("**/api/diff/files**", (route) =>
    route.fulfill({
      json: { git: true, branch: "main", files: [], additions: 0, deletions: 0 },
    }),
  );
    await page.route("**/api/roots", (route) =>
    route.fulfill({
      json: {
        roots: [{ id: "root-1", path: "C:\\repo", createdAt: "2026-07-17T00:00:00.000Z" }],
      },
    }),
  );
  await page.route("**/api/files/content**", (route) =>
    route.fulfill({
      json: { name: "readme.md", content: "# Project" },
    }),
  );
  await page.route("**/api/skill-permission", (route) =>
    route.fulfill({ json: { skills: [] } }),
  );
  await page.route("**/api/subagent-permission", (route) =>
    route.fulfill({ json: { subagents: [] } }),
  );
  await page.route("**/api/opencode/**", async (route) => {
    const url = new URL(route.request().url());
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
        },
      });
      return;
    }
    if (url.pathname.endsWith("/config")) {
      await route.fulfill({ json: { agent: "build" } });
      return;
    }
    if (url.pathname.endsWith("/agent")) {
      await route.fulfill({ json: [{ name: "build" }] });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

test("pty panel shows the terminal section and new button", async ({ page }) => {
  await mockTaskShell(page);

  await page.goto("/task/task-1");
  // Open the side-panel menu and select the terminal panel.
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await page.getByRole("menuitem", { name: "ターミナル" }).click();

  await expect(page.getByText("ターミナル", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新規", exact: true }),
  ).toBeVisible();
});
