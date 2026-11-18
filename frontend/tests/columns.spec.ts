import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { deleteUser, signUp, uniqueUsername } from "./helpers";

const columnTitles = (page: Page) =>
  page.getByRole("textbox", { name: "Column title" });

/** Current column order, retried by expect.poll while the board saves. */
const titleValues = (page: Page) =>
  columnTitles(page).evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value)
  );

test.describe("columns", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("adds, reorders, and deletes a column", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);

    await signUp(page, username, "Ada Lovelace");
    await expect(columnTitles(page)).toHaveCount(5);
    const seeded = await titleValues(page);

    await page.getByRole("button", { name: "Add a column" }).click();
    await page.getByRole("textbox", { name: "New column title" }).fill("Blocked");
    await page.getByRole("button", { name: "Add column", exact: true }).click();

    await expect.poll(() => titleValues(page)).toEqual([...seeded, "Blocked"]);

    await page.getByRole("button", { name: "Move Blocked left" }).click();
    const reordered = [...seeded];
    reordered.splice(4, 0, "Blocked");
    await expect.poll(() => titleValues(page)).toEqual(reordered);

    await page.reload();
    await expect.poll(() => titleValues(page)).toEqual(reordered);

    await page.getByRole("button", { name: "Delete Blocked column" }).click();
    await expect.poll(() => titleValues(page)).toEqual(seeded);

    await page.reload();
    await expect.poll(() => titleValues(page)).toEqual(seeded);
  });

  test("deleting a column removes its cards", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);
    const title = `Doomed card ${Date.now()}`;

    await signUp(page, username, "Ada Lovelace");
    const column = page.locator('[data-testid^="column-"]').first();
    await column.getByRole("button", { name: /add a card/i }).click();
    await column.getByPlaceholder("Card title").fill(title);
    await column.getByRole("button", { name: /add card/i }).click();
    await expect(column.getByText(title)).toBeVisible();

    const columnName = await column
      .getByRole("textbox", { name: "Column title" })
      .inputValue();
    await column
      .getByRole("button", { name: `Delete ${columnName} column` })
      .click();

    await expect(columnTitles(page)).toHaveCount(4);
    await expect(page.getByText(title)).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(title)).toHaveCount(0);
  });
});
