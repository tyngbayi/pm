import { expect, test } from "@playwright/test";
import { deleteUser, signUp, uniqueUsername } from "./helpers";

test.describe("column WIP limits", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("flags a column that is over its limit without blocking the work", async ({
    page,
  }) => {
    const username = uniqueUsername();
    created.push(username);
    await signUp(page, username, `Ada ${username}`);

    const column = page.locator('[data-testid^="column-"]').first();
    const title = await column
      .getByRole("textbox", { name: "Column title" })
      .inputValue();
    await expect(column.getByLabel("2 cards", { exact: true })).toBeVisible();

    await column.getByRole("button", { name: `Set ${title} limit` }).click();
    const limit = column.getByRole("spinbutton", { name: "WIP limit" });
    await limit.fill("3");
    await limit.press("Enter");
    await expect(column.getByLabel("2 of 3 cards", { exact: true })).toBeVisible();

    // The limit is advisory, so the column still accepts another card.
    await column.getByRole("button", { name: "Add a card" }).click();
    await column.getByPlaceholder("Card title").fill("One too many");
    await column.getByRole("button", { name: "Add card", exact: true }).click();
    await expect(column.getByText("One too many")).toBeVisible();

    await column.getByRole("button", { name: `Set ${title} limit` }).click();
    await limit.fill("1");
    await limit.press("Enter");
    await expect(
      column.getByLabel("3 of 1 cards, over the limit")
    ).toBeVisible();

    await page.reload();
    await expect(
      column.getByLabel("3 of 1 cards, over the limit")
    ).toBeVisible();

    await column.getByRole("button", { name: `Set ${title} limit` }).click();
    await limit.fill("0");
    await limit.press("Enter");
    await expect(column.getByLabel("3 cards", { exact: true })).toBeVisible();
  });
});
