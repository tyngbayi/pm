import type { BoardData, Card } from "@/lib/kanban";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type User = { username: string };
type HealthStatus = { status: string };
type ColumnUpdate = { id: string; title: string };
type CardChanges = Partial<Pick<Card, "title" | "details">>;

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

export const getHealth = () => requestJson<HealthStatus>("/api/health");

export const getCurrentUser = () => requestJson<User>("/api/auth/me");

export const login = (username: string, password: string) =>
  requestJson<User>(
    "/api/auth/login",
    jsonRequest("POST", { username, password })
  );

export const logout = () =>
  requestVoid("/api/auth/logout", { method: "POST" });

export const getBoard = () => requestJson<BoardData>("/api/board");

export const replaceBoard = (board: BoardData) =>
  requestJson<BoardData>("/api/board", jsonRequest("PUT", board));

export const renameColumn = (columnId: string, title: string) =>
  requestJson<ColumnUpdate>(
    `/api/columns/${encodeURIComponent(columnId)}`,
    jsonRequest("PATCH", { title })
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

export const moveCard = (
  cardId: string,
  columnId: string,
  position: number
) =>
  requestJson<BoardData>(
    `/api/cards/${encodeURIComponent(cardId)}/move`,
    jsonRequest("PATCH", { column_id: columnId, position })
  );
