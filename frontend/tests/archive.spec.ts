import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { deleteUser, signUp, uniqueUsername } from "./helpers";

/** Scoped to the card: the sortable article also answers to the button names. */
const cardByTitle = (page: Page, title: string) =>
  page.locator('[data-testid^="card-"]').filter({ hasText: title });

const firstColumn = (page: Page) =>
  page.locator('[data-testid^="column-"]').first();

const addCard = async (page: Page, title: string) => {
  const column = firstColumn(page);
  await column.getByRole("button", { name: /add a card/i }).click();
  await column.getByPlaceholder("Card title").fill(title);
  await column.getByRole("button", { name: /add card/i }).click();
  await expect(column.getByText(title)).toBeVisible();
};

test.describe("archiving a card", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("takes a card off the board and puts it back", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);
    const title = `Archived card ${Date.now()}`;

    await signUp(page, username, `Ada ${username}`);
    await addCard(page, title);

    await cardByTitle(page, title)
      .getByRole("button", { name: `Archive ${title}` })
      .click();

    await expect(page.getByText(title)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(title)).toHaveCount(0);

    await page.getByRole("button", { name: "Archive", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Archive" });
    await expect(dialog.getByText(title)).toBeVisible();

    await dialog.getByRole("button", { name: `Restore ${title}` }).click();

    await expect(dialog.getByText(title)).toHaveCount(0);
    await expect(dialog.getByText("Nothing is archived")).toBeVisible();
    await dialog.getByRole("button", { name: "Close archive" }).click();
    // Restored to the foot of the column it was archived from.
    await expect(
      firstColumn(page).locator('[data-testid^="card-"]').last()
    ).toContainText(title);
  });

  test("keeps an archived card's comments for when it returns", async ({
    page,
  }) => {
    const username = uniqueUsername();
    created.push(username);
    const title = `Commented card ${Date.now()}`;

    await signUp(page, username, `Ada ${username}`);
    await addCard(page, title);

    await cardByTitle(page, title)
      .getByRole("button", { name: `Edit ${title}` })
      .click();
    const card = page.getByRole("dialog", { name: `Edit ${title}` });
    await card.getByLabel("New comment").fill("Waiting on legal");
    await card.getByRole("button", { name: "Add comment" }).click();
    await expect(card.getByText("Waiting on legal")).toBeVisible();
    await card.getByRole("button", { name: "Close card details" }).click();

    await cardByTitle(page, title)
      .getByRole("button", { name: `Archive ${title}` })
      .click();
    await expect(page.getByText(title)).toHaveCount(0);

    await page.getByRole("button", { name: "Archive", exact: true }).click();
    const archive = page.getByRole("dialog", { name: "Archive" });
    await archive.getByRole("button", { name: `Restore ${title}` }).click();
    await archive.getByRole("button", { name: "Close archive" }).click();

    await cardByTitle(page, title)
      .getByRole("button", { name: `Edit ${title}` })
      .click();
    await expect(
      page.getByRole("dialog", { name: `Edit ${title}` }).getByText("Waiting on legal")
    ).toBeVisible();
  });
});
