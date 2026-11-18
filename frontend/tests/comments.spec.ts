import { expect, test } from "@playwright/test";
import { deleteUser, signUp, uniqueUsername } from "./helpers";

test.describe("card comments", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("adds a comment, counts it on the card, then deletes it", async ({
    page,
  }) => {
    const username = uniqueUsername();
    created.push(username);
    await signUp(page, username, `Ada ${username}`);

    const card = page.locator('[data-testid^="card-"]').first();
    const title = await card.locator("h4").innerText();
    await card.getByRole("button", { name: `Edit ${title}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("No comments yet.")).toBeVisible();

    await dialog.getByLabel("New comment").fill("Blocked on the API review");
    await dialog.getByRole("button", { name: "Add comment" }).click();
    const thread = dialog.getByRole("region", { name: "Comments" });
    await expect(thread.getByText("Blocked on the API review")).toBeVisible();

    await dialog.getByRole("button", { name: "Close card details" }).click();
    await expect(card.getByLabel("1 comment")).toBeVisible();

    // The thread is persisted, not just held in the dialog's state.
    await page.reload();
    await expect(card.getByLabel("1 comment")).toBeVisible();
    await card.getByRole("button", { name: `Edit ${title}` }).click();
    const reopened = page.getByRole("dialog");
    await expect(
      reopened.getByText("Blocked on the API review")
    ).toBeVisible();

    await reopened
      .getByRole("button", { name: `Delete comment by Ada ${username}` })
      .click();
    await expect(reopened.getByText("No comments yet.")).toBeVisible();
    await reopened.getByRole("button", { name: "Close card details" }).click();
    await expect(card.getByLabel("1 comment")).toBeHidden();
  });

  test("a shared board's members hold one conversation", async ({
    page,
    browser,
  }) => {
    const owner = uniqueUsername();
    const guest = uniqueUsername();
    created.push(owner, guest);
    const guestName = `Grace ${guest}`;

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await signUp(guestPage, guest, guestName);
    await expect(guestPage.getByLabel("Board", { exact: true })).toBeVisible();

    await signUp(page, owner, `Ada ${owner}`);
    await page.getByRole("button", { name: "Share board" }).click();
    const shareDialog = page.getByRole("dialog");
    await shareDialog.getByLabel("Username to share with").fill(guest);
    await shareDialog.getByRole("button", { name: "Add member" }).click();
    await expect(shareDialog.getByText(guestName)).toBeVisible();
    await shareDialog.getByRole("button", { name: "Close sharing" }).click();

    const card = page.locator('[data-testid^="card-"]').first();
    const title = await card.locator("h4").innerText();
    await card.getByRole("button", { name: `Edit ${title}` }).click();
    const ownerDialog = page.getByRole("dialog");
    await ownerDialog.getByLabel("New comment").fill("Can you take this?");
    await ownerDialog.getByRole("button", { name: "Add comment" }).click();
    await expect(ownerDialog.getByText("Can you take this?")).toBeVisible();

    // The guest opens the shared board and replies in the same thread.
    await guestPage.reload();
    const shared = guestPage.getByRole("option", { name: /\(shared\)$/ });
    await guestPage
      .getByLabel("Board", { exact: true })
      .selectOption((await shared.getAttribute("value")) ?? "");
    const guestCard = guestPage.locator('[data-testid^="card-"]').first();
    await guestCard.getByRole("button", { name: `Edit ${title}` }).click();
    const guestDialog = guestPage.getByRole("dialog");
    await expect(guestDialog.getByText("Can you take this?")).toBeVisible();
    await guestDialog.getByLabel("New comment").fill("On it");
    await guestDialog.getByRole("button", { name: "Add comment" }).click();
    await expect(guestDialog.getByText("On it")).toBeVisible();

    // Each may delete only their own, so the owner sees no control on "On it".
    await expect(
      guestDialog.getByRole("button", { name: `Delete comment by Ada ${owner}` })
    ).toHaveCount(0);
    await guestDialog
      .getByRole("button", { name: "Close card details" })
      .click();

    await page.reload();
    await card.getByRole("button", { name: `Edit ${title}` }).click();
    const reopened = page.getByRole("dialog");
    await expect(reopened.getByText("On it")).toBeVisible();
    await expect(
      reopened.getByRole("button", { name: `Delete comment by ${guestName}` })
    ).toHaveCount(0);

    await guestContext.close();
  });
});
