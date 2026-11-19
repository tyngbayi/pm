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

const openDependencies = async (page: Page, title: string) => {
  await cardByTitle(page, title)
    .getByRole("button", { name: `Edit ${title}` })
    .click();
  return page
    .getByRole("dialog", { name: `Edit ${title}` })
    .getByRole("region", { name: "Dependencies" });
};

const closeCard = (page: Page, title: string) =>
  page
    .getByRole("dialog", { name: `Edit ${title}` })
    .getByRole("button", { name: "Close card details" })
    .click();

test.describe("card dependencies", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("blocks a card on another and then lifts it", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);
    const stamp = Date.now();
    const blocked = `Blocked card ${stamp}`;
    const blocker = `Blocking card ${stamp}`;

    await signUp(page, username, `Ada ${username}`);
    await addCard(page, blocker);
    await addCard(page, blocked);

    const dependencies = await openDependencies(page, blocked);
    await expect(
      dependencies.getByText("Nothing is blocking this card.")
    ).toBeVisible();
    await dependencies.getByLabel("Blocked by").selectOption({ label: blocker });
    await expect(dependencies.getByText(blocker)).toBeVisible();
    await closeCard(page, blocked);

    const badge = cardByTitle(page, blocked).getByLabel("Blocked by 1 card");
    await expect(badge).toBeVisible();
    await page.reload();
    await expect(badge).toBeVisible();

    // The far side names the same dependency from the other direction.
    const other = await openDependencies(page, blocker);
    await expect(
      other.getByText(`This card is blocking ${blocked}.`)
    ).toBeVisible();
    await closeCard(page, blocker);

    const again = await openDependencies(page, blocked);
    await again
      .getByRole("button", { name: `Stop ${blocker} blocking this card` })
      .click();
    await expect(
      again.getByText("Nothing is blocking this card.")
    ).toBeVisible();
    await closeCard(page, blocked);

    await expect(
      cardByTitle(page, blocked).getByLabel("Blocked by 1 card")
    ).toHaveCount(0);
  });

  test("stops offering a card that is already downstream", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);
    const stamp = Date.now();
    const first = `Cycle first ${stamp}`;
    const second = `Cycle second ${stamp}`;

    await signUp(page, username, `Ada ${username}`);
    await addCard(page, first);
    await addCard(page, second);

    const dependencies = await openDependencies(page, second);
    await dependencies.getByLabel("Blocked by").selectOption({ label: first });
    await expect(dependencies.getByText(first)).toBeVisible();
    await closeCard(page, second);

    // `second` is now downstream of `first`, so it cannot also block it.
    const other = await openDependencies(page, first);
    await expect(
      other.getByRole("option", { name: second })
    ).toHaveCount(0);
  });
});
