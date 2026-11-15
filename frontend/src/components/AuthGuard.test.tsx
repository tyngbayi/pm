import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "@/components/AuthGuard";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

describe("AuthGuard", () => {
  beforeEach(() => {
    replace.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders children after confirming the session", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ username: "user" }), { status: 200 })
    );

    render(
      <AuthGuard>
        <p>Board content</p>
      </AuthGuard>
    );

    expect(await screen.findByText("Board content")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("redirects to login when the session is missing", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    render(
      <AuthGuard>
        <p>Board content</p>
      </AuthGuard>
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("Board content")).not.toBeInTheDocument();
  });
});
