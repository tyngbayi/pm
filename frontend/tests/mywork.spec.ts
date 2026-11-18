import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { deleteUser, signUp, uniqueUsername } from "./helpers";

const boardSelect = (page: Page) => page.getByLabel("Board", { exact: true });

const addCard = async (page: Page, title: string) => {
  const column = page.locator('[data-testid^="column-"]').first();
  await column.getByRole("button", { name: /add a card/i }).click();
  await column.getByPlaceholder("Card title").fill(title);
  await column.getByRole("button", { name: /add card/i }).click();
  await expect(column.getByText(title)).toBeVisible();
};

const assignToSelf = async (page: Page, title: string, name: string) => {
  // The card itself is a dnd-kit button whose name contains the edit control's.
  await page
    .getByRole("button", { name: `Edit ${title}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Assignee").selectOption({ label: name });
  await dialog.getByRole("button", { name: "Save card" }).click();
  await expect(dialog).toHaveCount(0);
};

test.describe("my work", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("gathers assigned cards from every board and opens one", async ({
    page,
  }) => {
    const username = uniqueUsername();
    created.push(username);
    const name = `Ada ${username}`;
    const first = `Home card ${username}`;
    const second = `Roadmap card ${username}`;

    await signUp(page, username, name);
    await expect(boardSelect(page)).toBeVisible();
    await addCard(page, first);
    await assignToSelf(page, first, name);

    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel("New board name").fill(`Roadmap ${username}`);
    await page.getByRole("button", { name: "Create board" }).click();
    await addCard(page, second);
    await assignToSelf(page, second, name);

    await page.getByRole("button", { name: "My work" }).click();
    const myWork = page.getByRole("dialog", { name: "My work" });
    await expect(myWork.getByRole("button", { name: new RegExp(first) })).toBeVisible();

    // Selecting a card from the other board switches to it and opens the card.
    await myWork.getByRole("button", { name: new RegExp(first) }).click();
    await expect(
      page.getByRole("dialog", { name: `Edit ${first}` })
    ).toBeVisible();
    await expect(boardSelect(page).locator("option:checked")).toHaveText(
      "My board"
    );
  });

  test("says so when nothing is assigned", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);

    await signUp(page, username, `Grace ${username}`);
    await expect(boardSelect(page)).toBeVisible();

    await page.getByRole("button", { name: "My work" }).click();

    await expect(
      page.getByRole("dialog", { name: "My work" })
    ).toContainText("Nothing is assigned to you yet.");
  });
});
