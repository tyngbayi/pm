import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { deleteUser, signUp, uniqueUsername } from "./helpers";

/**
 * The assignee roster is instance-wide, so a display name shared with a spec
 * running in parallel would let `selectOption` pick that spec's account, which
 * its cleanup then deletes out from under the save.
 */
const uniqueDisplayName = (username: string) => `Ada ${username}`;

/** Titles of the cards currently on the board, retried while the board saves. */
const visibleTitles = (page: Page) =>
  page
    .locator('[data-testid^="card-"] h4')
    .evaluateAll((headings) => headings.map((heading) => heading.textContent));

test.describe("card details", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("edits a card's fields and keeps them after a reload", async ({
    page,
  }) => {
    const username = uniqueUsername();
    created.push(username);
    const displayName = uniqueDisplayName(username);
    await signUp(page, username, displayName);

    const card = page.locator('[data-testid^="card-"]').first();
    const title = await card.locator("h4").innerText();
    await card.getByRole("button", { name: `Edit ${title}` }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Priority").selectOption("high");
    await dialog.getByLabel("Due date").fill("2027-05-06");
    await dialog.getByLabel("Assignee").selectOption({ label: displayName });
    await dialog.getByLabel("Labels").fill("design, urgent");
    await dialog.getByRole("button", { name: "Save card" }).click();

    await expect(dialog).toBeHidden();
    await expect(card.getByText("high")).toBeVisible();
    await expect(card.getByText("2027-05-06")).toBeVisible();
    await expect(card.getByText("urgent")).toBeVisible();

    await page.reload();
    const reloaded = page.locator('[data-testid^="card-"]').first();
    await expect(reloaded.getByText(displayName)).toBeVisible();
    await expect(reloaded.getByText("design")).toBeVisible();
  });

  test("filters the board by text, assignee, and label", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);
    const displayName = uniqueDisplayName(username);
    await signUp(page, username, displayName);

    const card = page.locator('[data-testid^="card-"]').first();
    const title = await card.locator("h4").innerText();
    await card.getByRole("button", { name: `Edit ${title}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Assignee").selectOption({ label: displayName });
    await dialog.getByLabel("Labels").fill("spotlight");
    await dialog.getByRole("button", { name: "Save card" }).click();
    await expect(dialog).toBeHidden();

    await page.getByLabel("Filter by label").selectOption("spotlight");
    await expect.poll(() => visibleTitles(page)).toEqual([title]);
    // Columns stay put so a filtered card is still readable in context.
    await expect(page.getByRole("textbox", { name: "Column title" })).toHaveCount(5);

    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Filter by assignee").selectOption({ label: displayName });
    await expect.poll(() => visibleTitles(page)).toEqual([title]);

    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Search cards").fill(title);
    await expect.poll(() => visibleTitles(page)).toEqual([title]);

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect.poll(async () => (await visibleTitles(page)).length).toBe(8);
  });

  // Card positions are absolute, so a drop inside a filtered column would
  // persist the index among the visible cards instead of among all of them.
  test("ignores a drag while a filter is active", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);
    await signUp(page, username, uniqueDisplayName(username));

    const source = page.locator('[data-testid^="column-"]').first();
    const card = source.locator('[data-testid^="card-"]').first();
    const cardId = await card.getAttribute("data-testid");
    const title = await card.locator("h4").innerText();

    await page.getByLabel("Search cards").fill(title);
    await expect.poll(() => visibleTitles(page)).toEqual([title]);
    // Not getByRole("status"): dnd-kit mounts its own live region with that role.
    await expect(page.getByText("Drag is paused while filtering")).toBeVisible();

    const target = page.locator('[data-testid^="column-"]').nth(3);
    const cardBox = await card.boundingBox();
    const targetBox = await target.boundingBox();
    if (!cardId || !cardBox || !targetBox) {
      throw new Error("Unable to resolve drag coordinates.");
    }
    await page.mouse.move(
      cardBox.x + cardBox.width / 2,
      cardBox.y + cardBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + 120,
      { steps: 12 }
    );
    await page.mouse.up();

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(source.getByTestId(cardId)).toBeVisible();
    await page.reload();
    await expect(
      page.locator('[data-testid^="column-"]').first().getByTestId(cardId)
    ).toBeVisible();
  });
});
