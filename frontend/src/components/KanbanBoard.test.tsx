import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import type { BoardData } from "@/lib/kanban";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();

const sampleBoard: BoardData = {
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    { id: "col-progress", title: "In Progress", cardIds: ["card-4"] },
    { id: "col-review", title: "Review", cardIds: ["card-5"] },
    { id: "col-done", title: "Done", cardIds: ["card-6"] },
  ],
  cards: {
    "card-1": {
      id: "card-1",
      title: "Align roadmap themes",
      details: "Plan the next release.",
    },
    "card-2": {
      id: "card-2",
      title: "Gather customer signals",
      details: "Review customer feedback.",
    },
    "card-3": {
      id: "card-3",
      title: "Prototype analytics view",
      details: "Sketch the dashboard.",
    },
    "card-4": {
      id: "card-4",
      title: "Refine status language",
      details: "Standardize labels.",
    },
    "card-5": {
      id: "card-5",
      title: "QA micro-interactions",
      details: "Verify interactions.",
    },
    "card-6": {
      id: "card-6",
      title: "Ship marketing page",
      details: "Publish the page.",
    },
  },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

describe("KanbanBoard", () => {
  beforeEach(() => {
    replace.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path === "/api/board" && method === "GET") {
        return jsonResponse(sampleBoard);
      }
      if (path === "/api/columns/col-backlog" && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as { title: string };
        return jsonResponse({ id: "col-backlog", title: body.title });
      }
      if (path === "/api/cards" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          title: string;
          details: string;
        };
        return jsonResponse(
          { id: "card-new", ...body },
          201
        );
      }
      if (path === "/api/cards/card-new" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ detail: "Unexpected API request" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the board from the backend", async () => {
    render(<KanbanBoard />);

    expect(await screen.findByText("Align roadmap themes")).toBeInTheDocument();
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/board",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("shows AI chat and persists a returned board update", async () => {
    const user = userEvent.setup();
    const updatedBoard: BoardData = {
      ...sampleBoard,
      columns: sampleBoard.columns.map((column, index) =>
        index === 0
          ? { ...column, cardIds: ["card-2"] }
          : index === 4
            ? { ...column, cardIds: ["card-6", "card-1"] }
            : column
      ),
    };
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    await user.click(screen.getByRole("button", { name: "AI assistant" }));
    await user.type(
      screen.getByRole("textbox", { name: "Message the AI" }),
      "Move this card to Done"
    );
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ message: "I moved the card.", board_update: updatedBoard })
      )
      .mockResolvedValueOnce(jsonResponse(updatedBoard));
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("I moved the card.")).toBeInTheDocument();
    expect(screen.getByText("Move this card to Done")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("column-col-done")).getByText(
        "Align roadmap themes"
      )
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "Move this card to Done" }],
          board: sampleBoard,
        }),
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/board",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(updatedBoard),
      })
    );
  });

  it("persists a renamed column when editing ends", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);

    const column = await screen.findByTestId("column-col-backlog");
    const input = within(column).getByRole("textbox", { name: "Column title" });
    await user.clear(input);
    await user.type(input, "New Name");
    await user.tab();

    expect(input).toHaveValue("New Name");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/columns/col-backlog",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "New Name" }),
      })
    );
  });

  it("persists card creation and deletion", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);

    const column = await screen.findByTestId("column-col-backlog");
    await user.click(within(column).getByRole("button", { name: /add a card/i }));
    await user.type(within(column).getByPlaceholderText("Card title"), "New card");
    await user.type(within(column).getByPlaceholderText("Details"), "Notes");
    await user.click(within(column).getByRole("button", { name: /add card/i }));

    expect(await within(column).findByText("New card")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cards",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          column_id: "col-backlog",
          title: "New card",
          details: "Notes",
        }),
      })
    );

    await user.click(
      within(column).getByRole("button", { name: "Delete New card" })
    );
    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cards/card-new",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("shows a mutation error and restores the unsaved title", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    const column = await screen.findByTestId("column-col-backlog");
    const input = within(column).getByRole("textbox", { name: "Column title" });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Database unavailable" }, 503)
    );

    await user.clear(input);
    await user.type(input, "Unsaved title");
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Database unavailable"
    );
    expect(input).toHaveValue("Backlog");
  });

  it("shows API failures and allows retrying the initial load", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Database unavailable" }, 503)
    );
    render(<KanbanBoard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Database unavailable"
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Align roadmap themes")).toBeInTheDocument();
  });
});
