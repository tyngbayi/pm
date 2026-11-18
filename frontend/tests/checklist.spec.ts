import { expect, test } from "@playwright/test";
import { deleteUser, signUp, uniqueUsername } from "./helpers";

test.describe("card checklists", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("tracks subtasks on a card and shows the progress on the board", async ({
    page,
  }) => {
    const username = uniqueUsername();
    created.push(username);
    await signUp(page, username, `Ada ${username}`);

    const card = page.locator('[data-testid^="card-"]').first();
    const title = await card.locator("h4").innerText();
    await card.getByRole("button", { name: `Edit ${title}` }).click();
    const checklist = page
      .getByRole("dialog")
      .getByRole("region", { name: "Checklist" });
    await expect(checklist.getByText("No checklist yet.")).toBeVisible();

    for (const item of ["Draft the spec", "Review it"]) {
      await checklist.getByLabel("New checklist item").fill(item);
      await checklist.getByRole("button", { name: "Add item" }).click();
      await expect(checklist.getByText(item)).toBeVisible();
    }
    // Not check(): the box only ticks once the PATCH returns, and it is
    // disabled until then, so Playwright cannot re-assert the state itself.
    await checklist.getByRole("checkbox").first().click();
    await expect(checklist.getByText("1 of 2 done")).toBeVisible();
    await page.getByRole("button", { name: "Close card details" }).click();

    await expect(card.getByLabel("1 of 2 checklist items done")).toBeVisible();

    // The checklist is the card's own content, so it survives a reload.
    await page.reload();
    await expect(card.getByLabel("1 of 2 checklist items done")).toBeVisible();
    await card.getByRole("button", { name: `Edit ${title}` }).click();
    await expect(checklist.getByRole("checkbox").first()).toBeChecked();

    await checklist.getByRole("button", { name: "Delete Review it" }).click();
    await expect(checklist.getByText("2 of 2 done")).toBeHidden();
    await expect(checklist.getByText("1 of 1 done")).toBeVisible();
  });
});
