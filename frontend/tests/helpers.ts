import { expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

export const PASSWORD = "hunter2hunter2";

export const uniqueUsername = () =>
  `e2e-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/** Remove accounts created by a test so repeated runs stay isolated. */
export const deleteUser = async (
  request: APIRequestContext,
  username: string
) => {
  const login = await request.post("/api/auth/login", {
    data: { username: "user", password: "password" },
  });
  expect(login.ok()).toBeTruthy();
  const users = await request.get("/api/users");
  expect(users.ok()).toBeTruthy();
  const match = (
    (await users.json()) as { id: string; username: string }[]
  ).find((user) => user.username === username);
  if (match) {
    expect((await request.delete(`/api/users/${match.id}`)).ok()).toBeTruthy();
  }
};

export const signUp = async (
  page: Page,
  username: string,
  displayName: string
) => {
  await page.goto("/signup");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Display name").fill(displayName);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
};
