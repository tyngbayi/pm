import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createCard,
  deleteCard,
  getBoard,
  getCurrentUser,
  getHealth,
  login,
  logout,
  moveCard,
  renameColumn,
  replaceBoard,
  updateCard,
} from "@/lib/api";

const fetchMock = vi.fn<typeof fetch>();
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("API client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input, init) =>
      String(input).endsWith("/logout") || init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : jsonResponse({})
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the backend route contracts for auth and board operations", async () => {
    const board = { columns: [], cards: {} };

    await getHealth();
    await getCurrentUser();
    await login("user", "password");
    await logout();
    await getBoard();
    await replaceBoard(board);
    await renameColumn("column/id", "Renamed");
    await createCard("column-1", "New card", "Details");
    await updateCard("card/id", { details: "Updated" });
    await deleteCard("card/id");
    await moveCard("card/id", "column-1", 2);

    expect(
      fetchMock.mock.calls.map(([url, init]) => [
        String(url),
        init?.method ?? "GET",
      ])
    ).toEqual([
      ["/api/health", "GET"],
      ["/api/auth/me", "GET"],
      ["/api/auth/login", "POST"],
      ["/api/auth/logout", "POST"],
      ["/api/board", "GET"],
      ["/api/board", "PUT"],
      ["/api/columns/column%2Fid", "PATCH"],
      ["/api/cards", "POST"],
      ["/api/cards/card%2Fid", "PATCH"],
      ["/api/cards/card%2Fid", "DELETE"],
      ["/api/cards/card%2Fid/move", "PATCH"],
    ]);

    expect(
      JSON.parse(fetchMock.mock.calls[2][1]?.body as string)
    ).toEqual({ username: "user", password: "password" });
    expect(
      JSON.parse(fetchMock.mock.calls[10][1]?.body as string)
    ).toEqual({ column_id: "column-1", position: 2 });
  });

  it("preserves backend status and detail in API errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Not found" }, 404));

    await expect(getBoard()).rejects.toEqual(
      expect.objectContaining<ApiError>({
        name: "ApiError",
        status: 404,
        message: "Not found",
      })
    );
  });
});
