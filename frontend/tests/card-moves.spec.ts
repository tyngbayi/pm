import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { deleteUser, signUp, uniqueUsername } from "./helpers";

const boardSelect = (page: Page) => page.getByLabel("Board", { exact: true });

const selectedBoard = (page: Page) =>
  boardSelect(page).locator("option:checked");

/** Scoped to the card: the sortable article also answers to the edit name. */
const cardByTitle = (page: Page, title: string) =>
  page.locator('[data-testid^="card-"]').filter({ hasText: title });

const openCard = (page: Page, title: string) =>
  cardByTitle(page, title)
    .getByRole("button", { name: `Edit ${title}` })
    .click();

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

test.describe("moving a card between boards", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("moves a card to another board with its comments", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);
    const title = `Travelling card ${Date.now()}`;

    await signUp(page, username, `Ada ${username}`);
    await expect(boardSelect(page)).toBeVisible();
    await createBoard(page, "Roadmap");
    await boardSelect(page).selectOption({ label: "My board" });
    await addCard(page, title);

    await openCard(page, title);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("New comment").fill("Comes with the card");
    await dialog.getByRole("button", { name: "Add comment" }).click();
    await expect(dialog.getByText("Comes with the card")).toBeVisible();

    await dialog.getByLabel("Move to board").selectOption({ label: "Roadmap" });

    // The card left the board on screen, so the dialog has nothing to show.
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(title)).toHaveCount(0);

    await boardSelect(page).selectOption({ label: "Roadmap" });
    await expect(page.getByText(title)).toBeVisible();
    await openCard(page, title);
    await expect(
      page.getByRole("dialog").getByText("Comes with the card")
    ).toBeVisible();
  });

  test("offers no destination when the account has one board", async ({
    page,
  }) => {
    const username = uniqueUsername();
    created.push(username);
    const title = `Only board card ${Date.now()}`;

    await signUp(page, username, `Ada ${username}`);
    await expect(boardSelect(page)).toBeVisible();
    await addCard(page, title);

    await openCard(page, title);

    await expect(
      page.getByRole("dialog").getByLabel("Move to board")
    ).toHaveCount(0);
  });
});
