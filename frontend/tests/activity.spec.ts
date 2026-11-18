import { expect, test } from "@playwright/test";
import { deleteUser, signUp, uniqueUsername } from "./helpers";

test.describe("board history", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("shows one member's changes to another, newest first", async ({
    page,
    browser,
  }) => {
    const owner = uniqueUsername();
    const guest = uniqueUsername();
    created.push(owner, guest);
    const guestName = `Grace ${guest}`;
    const title = `Guest card ${guest}`;

    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    await signUp(guestPage, guest, guestName);
    await expect(guestPage.getByLabel("Board", { exact: true })).toBeVisible();

    await signUp(page, owner, `Ada ${owner}`);
    await page.getByRole("button", { name: "Share board" }).click();
    const share = page.getByRole("dialog");
    await share.getByLabel("Username to share with").fill(guest);
    await share.getByRole("button", { name: "Add member" }).click();
    await expect(share.getByText(guestName)).toBeVisible();
    await share.getByRole("button", { name: "Close sharing" }).click();

    // The guest adds a card on the shared board.
    await guestPage.reload();
    const shared = guestPage.getByRole("option", { name: /\(shared\)$/ });
    await guestPage
      .getByLabel("Board", { exact: true })
      .selectOption((await shared.getAttribute("value")) ?? "");
    const column = guestPage.locator('[data-testid^="column-"]').first();
    await column.getByRole("button", { name: /add a card/i }).click();
    await column.getByPlaceholder("Card title").fill(title);
    await column.getByRole("button", { name: /add card/i }).click();
    await expect(column.getByText(title)).toBeVisible();
    await guestContext.close();

    await page.getByRole("button", { name: "Board history" }).click();
    const history = page.getByRole("dialog", { name: "Board history" });
    const entries = history.getByRole("listitem");
    await expect(entries.first()).toContainText(`Added card "${title}"`);
    await expect(entries.first()).toContainText(guestName);
    await expect(entries.nth(1)).toContainText(
      `Shared the board with ${guestName}`
    );
  });

  test("a new board has nothing in its history", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);
    await signUp(page, username, `Ada ${username}`);

    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel("New board name").fill(`Roadmap ${username}`);
    await page.getByRole("button", { name: "Create board" }).click();
    await page.getByRole("button", { name: "Board history" }).click();

    await expect(
      page.getByText("Nothing has changed on this board yet.")
    ).toBeVisible();
  });
});
