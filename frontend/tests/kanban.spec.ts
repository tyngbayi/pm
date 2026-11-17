import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { BoardData } from "../src/lib/kanban";

const signIn = async (page: Page) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
};

test("redirects unauthenticated visitors to the login page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("shows an error for incorrect credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.locator('p[role="alert"]')).toHaveText(
    "Invalid username or password."
  );
  await expect(page).toHaveURL(/\/login$/);
});

test("signs in and logs out", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test.describe("authenticated board", () => {
  let originalBoard: BoardData | null = null;

  test.beforeEach(async ({ page }) => {
    originalBoard = null;
    await signIn(page);
    const response = await page.request.get("/api/board");
    expect(response.ok()).toBeTruthy();
    originalBoard = (await response.json()) as BoardData;
  });

  test.afterEach(async ({ page }) => {
    if (originalBoard) {
      const response = await page.request.put("/api/board", {
        data: originalBoard,
      });
      expect(response.ok()).toBeTruthy();
      originalBoard = null;
    }
  });

  test("loads the kanban board", async ({ page }) => {
    await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  });

  test("applies a board update returned by the AI sidebar", async ({
    page,
  }) => {
    const boardResponse = await page.request.get("/api/board");
    expect(boardResponse.ok()).toBeTruthy();
    const board = (await boardResponse.json()) as BoardData;
    const doneColumn = board.columns[board.columns.length - 1];
    if (!doneColumn) {
      throw new Error("Unable to identify the Done column.");
    }
    const updatedBoard: BoardData = {
      columns: board.columns.map((column, index) =>
        index < board.columns.length - 1
          ? { ...column, cardIds: [] }
          : {
              ...column,
              cardIds: [
                ...column.cardIds,
                ...board.columns
                  .slice(0, -1)
                  .flatMap((source) => source.cardIds),
              ],
            }
      ),
      cards: board.cards,
    };
    await page.route("**/api/ai/chat", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: "I moved all cards to Done.",
          board_update: updatedBoard,
        }),
      })
    );

    await page.getByRole("button", { name: "AI assistant" }).click();
    const sidebar = page.locator("#ai-sidebar");
    await expect(sidebar.getByRole("heading", { name: "AI chat" })).toBeVisible();
    await sidebar
      .getByRole("textbox", { name: "Message the AI" })
      .fill("Move all cards to Done");
    await sidebar.getByRole("button", { name: "Send" }).click();

    await expect(sidebar.getByTestId("assistant-message")).toContainText(
      "I moved all cards to Done."
    );
    const cardLocator = '[data-testid^="card-"]';
    for (const column of board.columns.slice(0, -1)) {
      await expect(
        page.getByTestId(`column-${column.id}`).locator(cardLocator)
      ).toHaveCount(0);
    }
    await expect(
      page
        .getByTestId(`column-${doneColumn.id}`)
        .locator(cardLocator)
    ).toHaveCount(Object.keys(board.cards).length);
    await sidebar.getByRole("button", { name: "Close AI assistant" }).click();
    await expect(
      page.getByRole("button", { name: "AI assistant" })
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("adds a card to a column", async ({ page }) => {
    const firstColumn = page.locator('[data-testid^="column-"]').first();
    const title = `Playwright card ${Date.now()}`;
    await firstColumn.getByRole("button", { name: /add a card/i }).click();
    await firstColumn.getByPlaceholder("Card title").fill(title);
    await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
    await firstColumn.getByRole("button", { name: /add card/i }).click();
    await expect(firstColumn.getByText(title)).toBeVisible();
    await page.reload();
    await expect(page.getByText(title)).toBeVisible();
  });

  test("renames a column", async ({ page }) => {
    const firstColumn = page.locator('[data-testid^="column-"]').first();
    const title = firstColumn.getByRole("textbox", { name: "Column title" });

    await title.fill("Renamed column");
    await title.press("Enter");

    await expect(title).toHaveValue("Renamed column");
    await page.reload();
    await expect(
      page
        .locator('[data-testid^="column-"]')
        .first()
        .getByRole("textbox", { name: "Column title" })
    ).toHaveValue("Renamed column");
  });

  test("deletes a card", async ({ page }) => {
    const firstCard = page.locator('[data-testid^="card-"]').first();
    const cardId = await firstCard.getAttribute("data-testid");
    if (!cardId) {
      throw new Error("Unable to identify a card to delete.");
    }
    const card = page.getByTestId(cardId);

    await card.getByRole("button", { name: /^delete /i }).click();

    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId(cardId)).toHaveCount(0);
  });

  test("moves a card between columns", async ({ page }) => {
    const sourceColumn = page.locator('[data-testid^="column-"]').first();
    const card = sourceColumn.locator('[data-testid^="card-"]').first();
    const cardId = await card.getAttribute("data-testid");
    const targetColumn = page.locator('[data-testid^="column-"]').nth(3);
    if (!cardId) {
      throw new Error("Unable to identify a card to move.");
    }
    const cardBox = await card.boundingBox();
    const columnBox = await targetColumn.boundingBox();
    if (!cardBox || !columnBox) {
      throw new Error("Unable to resolve drag coordinates.");
    }

    await page.mouse.move(
      cardBox.x + cardBox.width / 2,
      cardBox.y + cardBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      columnBox.x + columnBox.width / 2,
      columnBox.y + 120,
      { steps: 12 }
    );
    await page.mouse.up();
    await expect(targetColumn.getByTestId(cardId)).toBeVisible();
    await page.reload();
    await expect(
      page
        .locator('[data-testid^="column-"]')
        .nth(3)
        .getByTestId(cardId)
    ).toBeVisible();
  });
});
