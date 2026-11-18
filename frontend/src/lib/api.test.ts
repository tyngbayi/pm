import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  addBoardMember,
  addCardComment,
  chatWithAi,
  createBoard,
  createCard,
  createColumn,
  deleteBoard,
  deleteCard,
  deleteCardComment,
  deleteColumn,
  getAssignments,
  getBoard,
  getBoards,
  getCardComments,
  getCurrentUser,
  getBoardMembers,
  getHealth,
  login,
  logout,
  moveCard,
  moveColumn,
  renameBoard,
  removeBoardMember,
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
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      // Deleting a column answers with the reshaped board; the other deletes
      // and logout answer 204.
      const noContent =
        url.endsWith("/logout") ||
        (init?.method === "DELETE" && !url.startsWith("/api/columns/"));
      return noContent ? new Response(null, { status: 204 }) : jsonResponse({});
    });
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
    await getBoards();
    await createBoard("Roadmap");
    await renameBoard("board/id", "Renamed");
    await deleteBoard("board/id");
    await getBoard("board/id");
    await getBoardMembers("board/id");
    await addBoardMember("board/id", "teammate");
    await removeBoardMember("board/id", "member/id");
    await replaceBoard("board/id", board);
    await renameColumn("column/id", "Renamed");
    await createColumn("board-1", "Blocked");
    await deleteColumn("column/id");
    await moveColumn("column/id", 1);
    await createCard("column-1", "New card", "Details");
    await updateCard("card/id", { details: "Updated" });
    await deleteCard("card/id");
    await getCardComments("card/id");
    await addCardComment("card/id", "Looks good");
    await deleteCardComment("comment/id");
    await moveCard("card/id", "column-1", 2);
    await getAssignments();

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
      ["/api/boards", "GET"],
      ["/api/boards", "POST"],
      ["/api/boards/board%2Fid", "PATCH"],
      ["/api/boards/board%2Fid", "DELETE"],
      ["/api/boards/board%2Fid", "GET"],
      ["/api/boards/board%2Fid/members", "GET"],
      ["/api/boards/board%2Fid/members", "POST"],
      ["/api/boards/board%2Fid/members/member%2Fid", "DELETE"],
      ["/api/boards/board%2Fid", "PUT"],
      ["/api/columns/column%2Fid", "PATCH"],
      ["/api/columns", "POST"],
      ["/api/columns/column%2Fid", "DELETE"],
      ["/api/columns/column%2Fid/move", "PATCH"],
      ["/api/cards", "POST"],
      ["/api/cards/card%2Fid", "PATCH"],
      ["/api/cards/card%2Fid", "DELETE"],
      ["/api/cards/card%2Fid/comments", "GET"],
      ["/api/cards/card%2Fid/comments", "POST"],
      ["/api/comments/comment%2Fid", "DELETE"],
      ["/api/cards/card%2Fid/move", "PATCH"],
      ["/api/assignments", "GET"],
    ]);

    const bodyOf = (index: number) =>
      JSON.parse(fetchMock.mock.calls[index][1]?.body as string);

    expect(bodyOf(2)).toEqual({ username: "user", password: "password" });
    expect(bodyOf(10)).toEqual({ username: "teammate" });
    expect(bodyOf(14)).toEqual({ board_id: "board-1", title: "Blocked" });
    expect(bodyOf(16)).toEqual({ position: 1 });
    expect(bodyOf(21)).toEqual({ body: "Looks good" });
    expect(bodyOf(23)).toEqual({ column_id: "column-1", position: 2 });
  });

  it("sends only the changed card fields", async () => {
    await updateCard("card-1", { priority: "high", assigneeId: null });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cards/card-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ priority: "high", assigneeId: null }),
      })
    );
  });

  it("preserves backend status and detail in API errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Not found" }, 404));

    await expect(getBoard("board-1")).rejects.toEqual(
      expect.objectContaining<ApiError>({
        name: "ApiError",
        status: 404,
        message: "Not found",
      })
    );
  });

  it("sends only the target board and conversation to AI chat", async () => {
    const messages = [{ role: "user" as const, content: "Move this card." }];

    await chatWithAi("board-1", messages);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ board_id: "board-1", messages }),
      })
    );
  });
});
