import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserManagement } from "@/components/UserManagement";

const fetchMock = vi.fn<typeof fetch>();

const admin = {
  id: "user-1",
  username: "root",
  display_name: "Root Admin",
  role: "admin",
  created_at: "2026-01-01T00:00:00+00:00",
};
const member = {
  id: "user-2",
  username: "ada",
  display_name: "Ada Lovelace",
  role: "member",
  created_at: "2026-02-03T00:00:00+00:00",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("UserManagement", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path === "/api/auth/me") {
        return jsonResponse(admin);
      }
      if (path === "/api/users" && method === "GET") {
        return jsonResponse([admin, member]);
      }
      if (path === "/api/users" && method === "POST") {
        return jsonResponse({ ...member, id: "user-3" }, 201);
      }
      if (path === "/api/users/user-2" && method === "PATCH") {
        return jsonResponse({ ...member, role: "admin" });
      }
      if (path === "/api/users/user-2" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ detail: "Unexpected API request" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists every account with its role and creation date", async () => {
    render(<UserManagement />);

    const row = within(await screen.findByRole("row", { name: /ada/ }));
    expect(row.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(row.getByText("2026-02-03")).toBeInTheDocument();
    expect(row.getByLabelText("Role for ada")).toHaveValue("member");
  });

  it("promotes a member and reloads the roster", async () => {
    const user = userEvent.setup();
    render(<UserManagement />);
    await screen.findByRole("row", { name: /ada/ });

    await user.selectOptions(screen.getByLabelText("Role for ada"), "admin");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users/user-2",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
      })
    );
    // The roster is re-fetched so the table reflects what the server stored.
    expect(
      fetchMock.mock.calls.filter(
        ([path, init]) =>
          path === "/api/users" && (init?.method ?? "GET") === "GET"
      )
    ).toHaveLength(2);
  });

  it("surfaces the guard against demoting the last admin", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/auth/me") {
        return jsonResponse(admin);
      }
      if (path === "/api/users" && (init?.method ?? "GET") === "GET") {
        return jsonResponse([admin]);
      }
      return jsonResponse(
        { detail: "The last administrator cannot be demoted" },
        409
      );
    });
    render(<UserManagement />);
    await screen.findByRole("row", { name: /root/ });

    await user.selectOptions(screen.getByLabelText("Role for root"), "member");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The last administrator cannot be demoted"
    );
  });

  it("refuses to let an admin delete their own account", async () => {
    render(<UserManagement />);
    await screen.findByRole("row", { name: /root/ });

    expect(screen.getByLabelText("Delete root")).toBeDisabled();
    expect(screen.getByLabelText("Delete ada")).toBeEnabled();
  });

  it("deletes another account", async () => {
    const user = userEvent.setup();
    render(<UserManagement />);
    await screen.findByRole("row", { name: /ada/ });

    await user.click(screen.getByLabelText("Delete ada"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users/user-2",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("creates an account and clears the form", async () => {
    const user = userEvent.setup();
    render(<UserManagement />);
    await screen.findByRole("row", { name: /ada/ });

    await user.type(screen.getByLabelText("Username"), "grace");
    await user.type(screen.getByLabelText("Display name"), "Grace Hopper");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.selectOptions(screen.getByLabelText("Role"), "admin");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "grace",
          password: "hunter2hunter2",
          display_name: "Grace Hopper",
          role: "admin",
        }),
      })
    );
    expect(screen.getByLabelText("Username")).toHaveValue("");
    expect(screen.getByLabelText("Role")).toHaveValue("member");
  });

  it("explains that a member may not manage accounts", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input) === "/api/auth/me"
        ? jsonResponse(member)
        : jsonResponse({ detail: "Administrator access required" }, 403)
    );
    render(<UserManagement />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Administrator access required"
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
