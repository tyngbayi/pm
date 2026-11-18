import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { deleteUser, signUp, uniqueUsername } from "./helpers";

const boardSelect = (page: Page) => page.getByLabel("Board", { exact: true });

/** The board the switcher is currently showing. */
const selectedBoard = (page: Page) => boardSelect(page).locator("option:checked");

const addCard = async (page: Page, title: string) => {
  const column = page.locator('[data-testid^="column-"]').first();
  await column.getByRole("button", { name: /add a card/i }).click();
  await column.getByPlaceholder("Card title").fill(title);
  await column.getByRole("button", { name: /add card/i }).click();
  await expect(column.getByText(title)).toBeVisible();
};

const createBoard = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "New board" }).click();
  await page.getByLabel("New board name").fill(name);
  await page.getByRole("button", { name: "Create board" }).click();
  await expect(selectedBoard(page)).toHaveText(name);
};

test.describe("boards", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("keeps cards separate across a user's boards", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);
    const firstCard = `First board card ${Date.now()}`;
    const secondCard = `Second board card ${Date.now()}`;

    await signUp(page, username, "Ada Lovelace");
    await expect(boardSelect(page)).toBeVisible();
    await addCard(page, firstCard);

    await createBoard(page, "Roadmap");
    // A new board is seeded with its own columns and none of the other's cards.
    await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
    await expect(page.getByText(firstCard)).toHaveCount(0);
    await addCard(page, secondCard);

    await boardSelect(page).selectOption({ label: "My board" });

    await expect(page.getByText(firstCard)).toBeVisible();
    await expect(page.getByText(secondCard)).toHaveCount(0);
  });

  test("renames a board and refuses to delete the last one", async ({
    page,
  }) => {
    const username = uniqueUsername();
    created.push(username);

    await signUp(page, username, "Ada Lovelace");
    await expect(boardSelect(page)).toBeVisible();

    // A single board is the whole account, so removing it is not offered.
    await expect(page.getByRole("button", { name: "Delete board" })).toBeDisabled();

    await page.getByRole("button", { name: "Rename board" }).click();
    await page
      .getByRole("textbox", { name: "Board name", exact: true })
      .fill("Delivery plan");
    await page.getByRole("button", { name: "Save board name" }).click();

    await expect(selectedBoard(page)).toHaveText("Delivery plan");

    await page.reload();
    await expect(selectedBoard(page)).toHaveText("Delivery plan");
  });

  test("deletes a board and falls back to the remaining one", async ({
    page,
  }) => {
    const username = uniqueUsername();
    created.push(username);

    await signUp(page, username, "Ada Lovelace");
    await expect(boardSelect(page)).toBeVisible();
    await createBoard(page, "Scratch");

    await page.getByRole("button", { name: "Delete board" }).click();

    await expect(selectedBoard(page)).toHaveText("My board");
    await expect(
      boardSelect(page).getByRole("option", { name: "Scratch" })
    ).toHaveCount(0);
  });
});
