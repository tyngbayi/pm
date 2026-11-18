import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignUpPage from "@/app/signup/page";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fillForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText("Username"), "ada");
  await user.type(screen.getByLabelText("Display name"), "Ada Lovelace");
  await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
  await user.click(screen.getByRole("button", { name: "Create account" }));
};

describe("SignUpPage", () => {
  beforeEach(() => {
    replace.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers an account and redirects to the board", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          id: "user-1",
          username: "ada",
          display_name: "Ada Lovelace",
          role: "member",
          created_at: "2026-01-01T00:00:00+00:00",
        },
        201
      )
    );
    render(<SignUpPage />);

    await fillForm(user);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "ada",
          password: "hunter2hunter2",
          display_name: "Ada Lovelace",
        }),
      })
    );
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("explains a username collision without redirecting", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "That username is already taken" }, 409)
    );
    render(<SignUpPage />);

    await fillForm(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That username is already taken."
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("explains a validation failure from the API", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ detail: "invalid" }, 422));
    render(<SignUpPage />);

    await fillForm(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at least 8 characters"
    );
    expect(replace).not.toHaveBeenCalled();
  });
});
