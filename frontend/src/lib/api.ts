import type {
  Assignment,
  BoardData,
  Card,
  Comment,
  Member,
} from "@/lib/kanban";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type UserRole = "admin" | "member";
export type User = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  created_at: string;
};
export type UserChanges = {
  display_name?: string;
  role?: UserRole;
  password?: string;
};
export type BoardSummary = {
  id: string;
  name: string;
  created_at: string;
  /** False for a board someone else owns and shared with this user. */
  owned: boolean;
};
type HealthStatus = { status: string };
type ColumnUpdate = { id: string; title: string };
export type CardChanges = Partial<Omit<Card, "id" | "commentCount">>;
export type AiChatMessage = { role: "user" | "assistant"; content: string };
export type AiChatResponse = {
  message: string;
  board_update: BoardData | null;
};

const getApiError = async (response: Response) => {
  let message = `Request failed (${response.status}).`;
  try {
    const body: unknown = await response.json();
    if (
      body !== null &&
      typeof body === "object" &&
      "detail" in body &&
      typeof body.detail === "string"
    ) {
      message = body.detail;
    }
  } catch {
    // Keep the HTTP status as the error when the response is not JSON.
  }
  return new ApiError(response.status, message);
};

const requestJson = async <T>(
  path: string,
  init: RequestInit = { method: "GET" }
): Promise<T> => {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
  });
  if (!response.ok) {
    throw await getApiError(response);
  }
  return (await response.json()) as T;
};

const requestVoid = async (path: string, init: RequestInit): Promise<void> => {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
  });
  if (!response.ok) {
    throw await getApiError(response);
  }
};

const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const boardPath = (boardId: string) =>
  `/api/boards/${encodeURIComponent(boardId)}`;

export const getHealth = () => requestJson<HealthStatus>("/api/health");

export const getCurrentUser = () => requestJson<User>("/api/auth/me");

export const login = (username: string, password: string) =>
  requestJson<User>(
    "/api/auth/login",
    jsonRequest("POST", { username, password })
  );

export const register = (
  username: string,
  password: string,
  displayName: string
) =>
  requestJson<User>(
    "/api/auth/register",
    jsonRequest("POST", { username, password, display_name: displayName })
  );

export const logout = () =>
  requestVoid("/api/auth/logout", { method: "POST" });

export const getUsers = () => requestJson<User[]>("/api/users");

export const createUser = (
  username: string,
  password: string,
  displayName: string,
  role: UserRole
) =>
  requestJson<User>(
    "/api/users",
    jsonRequest("POST", {
      username,
      password,
      display_name: displayName,
      role,
    })
  );

export const updateUser = (userId: string, changes: UserChanges) =>
  requestJson<User>(
    `/api/users/${encodeURIComponent(userId)}`,
    jsonRequest("PATCH", changes)
  );

export const deleteUser = (userId: string) =>
  requestVoid(`/api/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });

export const getBoards = () => requestJson<BoardSummary[]>("/api/boards");

export const createBoard = (name: string) =>
  requestJson<BoardSummary>("/api/boards", jsonRequest("POST", { name }));

export const renameBoard = (boardId: string, name: string) =>
  requestJson<BoardSummary>(boardPath(boardId), jsonRequest("PATCH", { name }));

export const deleteBoard = (boardId: string) =>
  requestVoid(boardPath(boardId), { method: "DELETE" });

export const getBoardMembers = (boardId: string) =>
  requestJson<Member[]>(`${boardPath(boardId)}/members`);

export const addBoardMember = (boardId: string, username: string) =>
  requestJson<Member>(
    `${boardPath(boardId)}/members`,
    jsonRequest("POST", { username })
  );

export const removeBoardMember = (boardId: string, memberId: string) =>
  requestVoid(
    `${boardPath(boardId)}/members/${encodeURIComponent(memberId)}`,
    { method: "DELETE" }
  );

export const getBoard = (boardId: string) =>
  requestJson<BoardData>(boardPath(boardId));

export const replaceBoard = (boardId: string, board: BoardData) =>
  requestJson<BoardData>(boardPath(boardId), jsonRequest("PUT", board));

const columnPath = (columnId: string) =>
  `/api/columns/${encodeURIComponent(columnId)}`;

export const renameColumn = (columnId: string, title: string) =>
  requestJson<ColumnUpdate>(columnPath(columnId), jsonRequest("PATCH", { title }));

export const createColumn = (boardId: string, title: string) =>
  requestJson<BoardData>(
    "/api/columns",
    jsonRequest("POST", { board_id: boardId, title })
  );

export const deleteColumn = (columnId: string) =>
  requestJson<BoardData>(columnPath(columnId), { method: "DELETE" });

export const moveColumn = (columnId: string, position: number) =>
  requestJson<BoardData>(
    `${columnPath(columnId)}/move`,
    jsonRequest("PATCH", { position })
  );

export const createCard = (
  columnId: string,
  title: string,
  details: string
) =>
  requestJson<Card>(
    "/api/cards",
    jsonRequest("POST", { column_id: columnId, title, details })
  );

export const updateCard = (cardId: string, changes: CardChanges) =>
  requestJson<Card>(
    `/api/cards/${encodeURIComponent(cardId)}`,
    jsonRequest("PATCH", changes)
  );

export const deleteCard = (cardId: string) =>
  requestVoid(`/api/cards/${encodeURIComponent(cardId)}`, {
    method: "DELETE",
  });

const cardPath = (cardId: string) => `/api/cards/${encodeURIComponent(cardId)}`;

export const getCardComments = (cardId: string) =>
  requestJson<Comment[]>(`${cardPath(cardId)}/comments`);

export const addCardComment = (cardId: string, body: string) =>
  requestJson<Comment>(
    `${cardPath(cardId)}/comments`,
    jsonRequest("POST", { body })
  );

export const deleteCardComment = (commentId: string) =>
  requestVoid(`/api/comments/${encodeURIComponent(commentId)}`, {
    method: "DELETE",
  });

export const moveCard = (
  cardId: string,
  columnId: string,
  position: number
) =>
  requestJson<BoardData>(
    `/api/cards/${encodeURIComponent(cardId)}/move`,
    jsonRequest("PATCH", { column_id: columnId, position })
  );

export const getAssignments = () =>
  requestJson<Assignment[]>("/api/assignments");

export const chatWithAi = (boardId: string, messages: AiChatMessage[]) =>
  requestJson<AiChatResponse>(
    "/api/ai/chat",
    jsonRequest("POST", { board_id: boardId, messages })
  );
