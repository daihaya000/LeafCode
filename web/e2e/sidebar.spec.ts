import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: {
        projects: [
          { id: "project-a", name: "Project A", rootPath: "C:\\repo-a", favorite: true },
          { id: "project-b", name: "Project B", rootPath: "C:\\repo-b", favorite: false },
        ],
      },
    }),
  );
  await page.route("**/api/tasks", (route) =>
    route.fulfill({ json: { tasks: [], engineOk: true } }),
  );
  await page.route("**/api/git/branches**", (route) =>
    route.fulfill({
      json: { branches: ["main"], current: "main", defaultTarget: "main" },
    }),
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
});

test("keeps project actions always visible", async ({ page }) => {
  const expand = page.getByRole("button", { name: "Project Aを展開" });
  await expect(expand).toBeVisible();

  for (const name of [
    "Project Aをお気に入りから外す",
    "Project Aに新規タスクを作成",
    "Project Aを削除",
    "Project Bをお気に入りに追加",
    "Project Bに新規タスクを作成",
    "Project Bを削除",
  ]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
});

test("keeps mobile project actions visible and focusable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "メニュー" }).click();

  for (const name of [
    "Project Bをお気に入りに追加",
    "Project Bに新規タスクを作成",
    "Project Bを削除",
  ]) {
    const action = page.getByRole("button", { name });
    await expect(action).toBeVisible();
    await expect(action).toHaveClass(/focus-visible:outline-primary/);
  }
});

test("renders enabled plugins below the sidebar add-project action without overflow", async ({
  page,
}) => {
  const sidebar = page.locator("aside").first();
  const addProject = sidebar
    .locator("button")
    .filter({ hasText: "プロジェクトを追加" });
  const pluginHost = sidebar.getByTestId("plugin-host");

  await expect(addProject).toBeVisible();
  await expect(pluginHost).toBeVisible();
  const [addBox, pluginBox] = await Promise.all([
    addProject.boundingBox(),
    pluginHost.boundingBox(),
  ]);

  expect(pluginBox?.y).toBeGreaterThan(addBox?.y ?? 0);
  await expect(pluginHost).not.toHaveClass(/\bfixed\b/);
  const sidebarBox = await sidebar.boundingBox();
  if (!pluginBox || !sidebarBox) throw new Error("sidebar or plugin host is not measurable");
  expect(pluginBox.x).toBeGreaterThanOrEqual(sidebarBox.x);
  expect(pluginBox.x + pluginBox.width).toBeLessThanOrEqual(
    sidebarBox.x + sidebarBox.width,
  );
  expect(
    await pluginHost.locator("..").evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

test("keeps enabled plugins in the mobile sidebar drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "メニュー" }).click();

  const sidebar = page.getByRole("complementary");
  const addProject = sidebar
    .locator("button")
    .filter({ hasText: "プロジェクトを追加" });
  const pluginHost = sidebar.getByTestId("plugin-host");

  await expect(page.getByTestId("plugin-host")).toHaveCount(1);
  await pluginHost.scrollIntoViewIfNeeded();
  await expect(addProject).toBeVisible();
  await expect(pluginHost).toBeVisible();
  const [addBox, pluginBox] = await Promise.all([
    addProject.boundingBox(),
    pluginHost.boundingBox(),
  ]);

  expect(pluginBox?.y).toBeGreaterThan(addBox?.y ?? 0);
  await expect(pluginHost).not.toHaveClass(/\bfixed\b/);
  const sidebarBox = await sidebar.boundingBox();
  if (!pluginBox || !sidebarBox) throw new Error("sidebar or plugin host is not measurable");
  expect(pluginBox.x).toBeGreaterThanOrEqual(sidebarBox.x);
  expect(pluginBox.x + pluginBox.width).toBeLessThanOrEqual(
    sidebarBox.x + sidebarBox.width,
  );
  expect(
    await pluginHost.locator("..").evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

test("does not show the empty state before projects load", async ({ page }) => {
  await page.unroute("**/api/projects");
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/projects", async (route) => {
    await blocked;
    await route.fulfill({
      json: {
        projects: [],
      },
    });
  });

  await page.reload();
  await expect(
    page.getByRole("status", { name: "プロジェクトを読み込み中" }),
  ).toBeVisible();
  await expect(page.getByText("プロジェクトがありません")).toHaveCount(0);

  release?.();
  await expect(page.getByText("プロジェクトがありません")).toBeVisible();
});

test("does not show a false empty state when projects fail to load", async ({
  page,
}) => {
  await page.unroute("**/api/projects");
  await page.route("**/api/projects", (route) => route.fulfill({ status: 500 }));

  await page.reload();
  await expect(
    page.getByRole("status", { name: "プロジェクトを読み込めませんでした" }),
  ).toBeVisible();
  await expect(page.getByText("プロジェクトがありません")).toHaveCount(0);
});

test("opens task creation with the selected project", async ({ page }) => {
  await page
    .getByRole("button", { name: "Project Bに新規タスクを作成" })
    .click();
  await expect(page).toHaveURL(/\?projectId=project-b$/);
  await expect(page.getByRole("combobox", { name: "プロジェクト" })).toHaveValue(
    "project-b",
  );
});

test("selects the project for task creation when the engine is unavailable", async ({
  page,
}) => {
  await page.route("**/api/tasks", (route) =>
    route.fulfill({ json: { tasks: [], engineOk: false } }),
  );

  await page
    .getByRole("button", { name: "Project Bに新規タスクを作成" })
    .click();
  await expect(page).toHaveURL(/\?projectId=project-b$/);
  await expect(page.getByRole("combobox", { name: "プロジェクト" })).toHaveValue(
    "project-b",
  );
});
