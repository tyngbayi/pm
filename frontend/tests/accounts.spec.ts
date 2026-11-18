import { expect, test } from "@playwright/test";
import { PASSWORD, deleteUser, signUp, uniqueUsername } from "./helpers";

test.describe("accounts", () => {
  const created: string[] = [];

  test.afterEach(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    for (const username of created.splice(0)) {
      await deleteUser(request, username);
    }
    await request.dispose();
  });

  test("signs up, lands on a seeded board, and signs back in", async ({
    page,
  }) => {
    const username = uniqueUsername();
    created.push(username);

    await signUp(page, username, "Ada Lovelace");

    await expect(
      page.getByRole("heading", { name: "Kanban Studio" })
    ).toBeVisible();
    await expect(page.getByText("Signed in as Ada Lovelace")).toBeVisible();
    // A brand new account starts with its own seeded board.
    await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Signed in as Ada Lovelace")).toBeVisible();
  });

  test("rejects a username that is already taken", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);

    await signUp(page, username, "First");
    await expect(
      page.getByRole("heading", { name: "Kanban Studio" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Log out" }).click();

    await signUp(page, username, "Second");

    await expect(page.locator('p[role="alert"]')).toHaveText(
      "That username is already taken."
    );
    await expect(page).toHaveURL(/\/signup$/);
  });

  test("keeps each account's board private", async ({ page, browser }) => {
    const username = uniqueUsername();
    created.push(username);
    const title = `Private card ${Date.now()}`;

    await signUp(page, username, "Ada Lovelace");
    const column = page.locator('[data-testid^="column-"]').first();
    await column.getByRole("button", { name: /add a card/i }).click();
    await column.getByPlaceholder("Card title").fill(title);
    await column.getByRole("button", { name: /add card/i }).click();
    await expect(column.getByText(title)).toBeVisible();

    // The demo account must not see the new account's card.
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await otherPage.goto("/login");
    await otherPage.getByLabel("Username").fill("user");
    await otherPage.getByLabel("Password").fill("password");
    await otherPage.getByRole("button", { name: "Sign in" }).click();
    await expect(
      otherPage.getByRole("heading", { name: "Kanban Studio" })
    ).toBeVisible();

    await expect(otherPage.getByText(title)).toHaveCount(0);
    await otherContext.close();
  });

  test("lets an admin create, promote, and delete an account", async ({
    page,
  }) => {
    const username = uniqueUsername();
    created.push(username);

    await page.goto("/login");
    await page.getByLabel("Username").fill("user");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("link", { name: "Manage accounts" }).click();
    await expect(
      page.getByRole("heading", { name: "Accounts" })
    ).toBeVisible();

    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Display name").fill("Grace Hopper");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    const row = page.getByRole("row", { name: new RegExp(username) });
    await expect(row.getByText("Grace Hopper")).toBeVisible();

    await row.getByLabel(`Role for ${username}`).selectOption("admin");
    await expect(row.getByLabel(`Role for ${username}`)).toHaveValue("admin");

    // The demo admin cannot remove itself, so the instance stays administrable.
    await expect(
      page.getByLabel("Delete user", { exact: true })
    ).toBeDisabled();

    await row.getByLabel(`Delete ${username}`).click();
    await expect(row).toHaveCount(0);
  });

  test("keeps the accounts screen away from members", async ({ page }) => {
    const username = uniqueUsername();
    created.push(username);

    await signUp(page, username, "Ada Lovelace");
    await expect(
      page.getByRole("heading", { name: "Kanban Studio" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Manage accounts" })
    ).toHaveCount(0);

    await page.goto("/admin");

    await expect(page.locator('p[role="alert"]')).toHaveText(
      "Administrator access required"
    );
  });

  test("hides admin-only data from a member account", async ({ request }) => {
    const username = uniqueUsername();
    created.push(username);
    const registered = await request.post("/api/auth/register", {
      data: { username, password: PASSWORD, display_name: "Member" },
    });
    expect(registered.status()).toBe(201);

    const response = await request.get("/api/users");

    expect(response.status()).toBe(403);
  });
});
