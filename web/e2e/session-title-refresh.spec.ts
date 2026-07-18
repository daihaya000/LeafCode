import { expect, test, type Page } from "@playwright/test";

const task = {
  id: "task-1",
  projectId: "project-1",
  projectName: "Project",
  title: "Old title",
  directory: "C:\\repo",
  isolation: "current_folder",
  status: "idle",
  sessionId: "session-1",
  branch: "main",
  additions: 0,
  deletions: 0,
  filesChanged: 0,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};

async function mockShell(page: Page) {
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: {
        projects: [
          {
            id: "project-1",
            name: "Project",
            rootPath: "C:\\repo",
            favorite: false,
          },
        ],
      },
    }),
  );
  await page.route("**/api/tasks**", (route) =>
    route.fulfill({ json: { tasks: [task], engineOk: true } }),
  );
  // Sidebar refresh polls /api/tasks; also silence any stray engine calls.
  await page.route("**/api/opencode/**", (route) =>
    route.fulfill({ json: {} }),
  );
}

test.describe("sidebar session title refresh", () => {
  test("refresh button updates the row title on success without navigating", async ({
    page,
  }) => {
    let currentTitle = "Old title";
    await page.route("**/api/projects", (route) =>
      route.fulfill({
        json: {
          projects: [
            {
              id: "project-1",
              name: "Project",
              rootPath: "C:\\repo",
              favorite: false,
            },
          ],
        },
      }),
    );
    await page.route("**/api/tasks**", (route) => {
      // Stateful: once the refresh-title call succeeds, listTasks reflects the
      // persisted new title — mirroring the real BFF/DB behaviour.
      route.fulfill({
        json: { tasks: [{ ...task, title: currentTitle }], engineOk: true },
      });
    });
    await page.route("**/api/opencode/**", (route) =>
      route.fulfill({ json: {} }),
    );
    await page.route(
      "**/api/workspaces/task-1/sessions/session-1/refresh-title",
      (route) => {
        currentTitle = "New AI title";
        route.fulfill({ json: { title: "New AI title" } });
      },
    );

    await page.goto("/");
    // Expand the project so the task row is rendered.
    await page.getByRole("button", { name: "Project 1", exact: true }).click();

    const row = page.getByRole("button", { name: /Old title/ });
    await expect(row).toBeVisible();

    // Reveal the hover-only refresh button by hovering the row (desktop).
    await row.hover();
    const refresh = page.getByRole("button", {
      name: "会話からタイトルを再生成",
    });
    await refresh.click({ force: true });

    // Title row should update to the generated title.
    await expect(page.getByText("New AI title")).toBeVisible();
    // Still on the home route (no navigation triggered).
    await expect(page).toHaveURL(/\//);
  });

  test("preserves the old title and shows an error on failure", async ({
    page,
  }) => {
    await mockShell(page);
    await page.route(
      "**/api/workspaces/task-1/sessions/session-1/refresh-title",
      (route) => route.fulfill({ json: { error: "boom" }, status: 502 }),
    );

    await page.goto("/");
    await page.getByRole("button", { name: "Project 1", exact: true }).click();
    const row = page.getByRole("button", { name: /Old title/ });
    await row.hover();
    await page
      .getByRole("button", { name: "会話からタイトルを再生成" })
      .click({ force: true });

    // Old title stays.
    await expect(page.getByText("Old title")).toBeVisible();
    // Error region surfaces.
    await expect(page.getByText("boom")).toBeVisible();
  });
});