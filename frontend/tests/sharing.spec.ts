import { expect, test } from "@playwright/test";
import { PASSWORD, deleteUser, signUp, uniqueUsername } from "./helpers";

test.describe("board sharing", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("shares a board, assigns its member, then revokes access", async ({
    page,
    browser,
  }) => {
    const owner = uniqueUsername();
    const guest = uniqueUsername();
    created.push(owner, guest);
    const guestName = `Grace ${guest}`;

    // The guest signs up first so the owner has a username to share with.
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await signUp(guestPage, guest, guestName);
    await expect(guestPage.getByLabel("Board", { exact: true })).toBeVisible();

    await signUp(page, owner, `Ada ${owner}`);
    await page.getByRole("button", { name: "Share board" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Username to share with").fill(guest);
    await dialog.getByRole("button", { name: "Add member" }).click();
    await expect(dialog.getByText(guestName)).toBeVisible();
    await dialog.getByRole("button", { name: "Close sharing" }).click();

    // The owner can now assign a card to someone who can open the board.
    const card = page.locator('[data-testid^="card-"]').first();
    const title = await card.locator("h4").innerText();
    await card.getByRole("button", { name: `Edit ${title}` }).click();
    const cardDialog = page.getByRole("dialog");
    await cardDialog.getByLabel("Assignee").selectOption({ label: guestName });
    await cardDialog.getByRole("button", { name: "Save card" }).click();
    await expect(cardDialog).toBeHidden();
    await expect(card.getByText(guestName)).toBeVisible();

    // The guest sees it as a shared board without the owner's controls.
    await guestPage.reload();
    const shared = guestPage.getByRole("option", { name: /\(shared\)$/ });
    await expect(shared).toHaveCount(1);
    await guestPage
      .getByLabel("Board", { exact: true })
      .selectOption((await shared.getAttribute("value")) ?? "");
    await expect(guestPage.getByText(title)).toBeVisible();
    for (const name of ["Rename board", "Share board", "Delete board"]) {
      await expect(guestPage.getByRole("button", { name })).toHaveCount(0);
    }

    // Removing them unassigns their cards rather than leaving a blank name.
    await page.getByRole("button", { name: "Share board" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: `Remove ${guestName}` })
      .click();
    await expect(page.getByRole("dialog").getByText(guestName)).toBeHidden();
    await page.reload();
    await expect(
      page.locator('[data-testid^="card-"]').first().getByText(guestName)
    ).toBeHidden();

    await guestPage.reload();
    await expect(guestPage.getByRole("option", { name: /\(shared\)$/ })).toHaveCount(0);
    await guestContext.close();
  });

  test("refuses to share with an account that does not exist", async ({
    page,
  }) => {
    const owner = uniqueUsername();
    created.push(owner);
    await signUp(page, owner, `Ada ${owner}`);

    await page.getByRole("button", { name: "Share board" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Username to share with").fill("no-such-account");
    await dialog.getByRole("button", { name: "Add member" }).click();

    // Not getByRole("alert"): Next mounts a route announcer with that role.
    await expect(page.getByText("User not found")).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("a non-member cannot reach the board through the API", async ({
    page,
    playwright,
    baseURL,
  }) => {
    const owner = uniqueUsername();
    const outsider = uniqueUsername();
    created.push(owner, outsider);
    await signUp(page, owner, `Ada ${owner}`);
    const boardId = await page.getByLabel("Board", { exact: true }).inputValue();

    const request = await playwright.request.newContext({ baseURL });
    await request.post("/api/auth/register", {
      data: { username: outsider, password: PASSWORD },
    });

    expect((await request.get(`/api/boards/${boardId}`)).status()).toBe(404);
    expect(
      (await request.get(`/api/boards/${boardId}/members`)).status()
    ).toBe(404);
    await request.dispose();
  });
});
