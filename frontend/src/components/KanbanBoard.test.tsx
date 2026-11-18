import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import type { BoardData, Card } from "@/lib/kanban";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();

const card = (
  id: string,
  title: string,
  details: string,
  extra: Partial<Card> = {}
): Card => ({
  id,
  title,
  details,
  priority: "medium",
  dueDate: "",
  labels: [],
  assigneeId: null,
  commentCount: 0,
  ...extra,
});

const sampleBoard: BoardData = {
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    { id: "col-progress", title: "In Progress", cardIds: ["card-4"] },
    { id: "col-review", title: "Review", cardIds: ["card-5"] },
    { id: "col-done", title: "Done", cardIds: ["card-6"] },
  ],
  cards: {
    "card-1": card("card-1", "Align roadmap themes", "Plan the next release.", {
      priority: "high",
      labels: ["planning"],
      assigneeId: "user-1",
    }),
    "card-2": card("card-2", "Gather customer signals", "Review feedback.", {
      labels: ["research"],
    }),
    // One comment already, matching the thread the mock serves for it.
    "card-3": card("card-3", "Prototype analytics view", "Sketch the dashboard.", {
      commentCount: 1,
    }),
    "card-4": card("card-4", "Refine status language", "Standardize labels."),
    "card-5": card("card-5", "QA micro-interactions", "Verify interactions."),
    "card-6": card("card-6", "Ship marketing page", "Publish the page."),
  },
};

const members = [
  { id: "user-1", display_name: "Ada Lovelace" },
  { id: "user-2", display_name: "Grace Hopper" },
];

// Authored by user-2, so the signed-in user-1 may not delete it.
const comments = [
  {
    id: "comment-1",
    body: "Blocked on the API review",
    author_id: "user-2",
    author_name: "Grace Hopper",
    created_at: "2026-01-01T00:00:00+00:00",
  },
];

const boardSummary = (id: string, name: string, owned = true) => ({
  id,
  name,
  created_at: "2026-01-01T00:00:00+00:00",
  owned,
});

const sampleBoards = [
  boardSummary("board-1", "My board"),
  boardSummary("board-2", "Roadmap"),
];

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const member = {
  id: "user-1",
  username: "ada",
  display_name: "Ada Lovelace",
  role: "member",
  created_at: "2026-01-01T00:00:00+00:00",
};

describe("KanbanBoard", () => {
  // Null stands for a session the backend rejects with a 401.
  let signedInUser: object | null = member;

  beforeEach(() => {
    signedInUser = member;
    replace.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input, init) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path === "/api/boards" && method === "GET") {
        return jsonResponse(sampleBoards);
      }
      if (path === "/api/boards/board-1" && method === "GET") {
        return jsonResponse(sampleBoard);
      }
      if (path.endsWith("/members") && method === "GET") {
        return jsonResponse(members);
      }
      if (path === "/api/auth/me" && method === "GET") {
        return signedInUser
          ? jsonResponse(signedInUser)
          : jsonResponse({ detail: "Not authenticated" }, 401);
      }
      if (path === "/api/columns/col-backlog" && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as { title: string };
        return jsonResponse({ id: "col-backlog", title: body.title });
      }
      if (path === "/api/columns" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { title: string };
        return jsonResponse(
          {
            ...sampleBoard,
            columns: [
              ...sampleBoard.columns,
              { id: "col-new", title: body.title, cardIds: [] },
            ],
          },
          201
        );
      }
      if (path === "/api/columns/col-backlog" && method === "DELETE") {
        // The backend cascades the column's cards away with it.
        const [removed, ...rest] = sampleBoard.columns;
        return jsonResponse({
          columns: rest,
          cards: Object.fromEntries(
            Object.entries(sampleBoard.cards).filter(
              ([id]) => !removed.cardIds.includes(id)
            )
          ),
        });
      }
      if (path === "/api/columns/col-backlog/move" && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as { position: number };
        const columns = [...sampleBoard.columns];
        columns.splice(body.position, 0, ...columns.splice(0, 1));
        return jsonResponse({ ...sampleBoard, columns });
      }
      if (path === "/api/cards" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          title: string;
          details: string;
        };
        return jsonResponse(card("card-new", body.title, body.details), 201);
      }
      if (path === "/api/cards/card-new" && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (path === "/api/cards/card-3" && method === "PATCH") {
        const changes = JSON.parse(String(init?.body)) as Partial<Card>;
        return jsonResponse({ ...sampleBoard.cards["card-3"], ...changes });
      }
      if (path.endsWith("/comments") && method === "GET") {
        return jsonResponse(comments);
      }
      if (path.endsWith("/comments") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { body: string };
        return jsonResponse(
          {
            id: "comment-2",
            body: body.body,
            author_id: "user-1",
            author_name: "Ada Lovelace",
            created_at: "2026-01-02T00:00:00+00:00",
          },
          201
        );
      }
      if (path.startsWith("/api/comments/") && method === "DELETE") {
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
      "/api/boards/board-1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("names the signed-in account in the header", async () => {
    render(<KanbanBoard />);

    expect(
      await screen.findByText("Signed in as Ada Lovelace")
    ).toBeInTheDocument();
  });

  it("still renders the board when the account lookup fails", async () => {
    signedInUser = null;
    render(<KanbanBoard />);

    expect(await screen.findByText("Align roadmap themes")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("switches to another board and loads its cards", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");
    expect(screen.getByLabelText("Board")).toHaveValue("board-1");

    fetchMock.mockResolvedValueOnce(jsonResponse(sampleBoards));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        columns: [{ id: "col-only", title: "Ideas", cardIds: ["card-9"] }],
        cards: { "card-9": card("card-9", "Second board card", "") },
      })
    );
    await user.selectOptions(screen.getByLabelText("Board"), "board-2");

    expect(await screen.findByText("Second board card")).toBeInTheDocument();
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Board")).toHaveValue("board-2");
  });

  it("creates a board and opens it", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    await user.click(screen.getByRole("button", { name: "New board" }));
    await user.type(screen.getByLabelText("New board name"), "Roadmap");
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleBoards[1], 201));
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleBoards));
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleBoard));
    await user.click(screen.getByRole("button", { name: "Create board" }));

    await screen.findByText("Align roadmap themes");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/boards",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Roadmap" }),
      })
    );
    expect(screen.getByLabelText("Board")).toHaveValue("board-2");
  });

  it("renames the open board without reloading its cards", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    await user.click(screen.getByRole("button", { name: "Rename board" }));
    const field = screen.getByLabelText("Board name");
    expect(field).toHaveValue("My board");
    await user.clear(field);
    await user.type(field, "Quarterly plan");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...sampleBoards[0], name: "Quarterly plan" })
    );
    await user.click(screen.getByRole("button", { name: "Save board name" }));

    expect(
      await screen.findByRole("option", { name: "Quarterly plan" })
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/boards/board-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Quarterly plan" }),
      })
    );
  });

  it("surfaces a refused board deletion", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Your last board cannot be deleted" }, 409)
    );
    await user.click(screen.getByRole("button", { name: "Delete board" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your last board cannot be deleted"
    );
  });

  it("disables deletion while only one board exists", async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(sampleBoards.slice(0, 1))
    );
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    expect(screen.getByRole("button", { name: "Delete board" })).toBeDisabled();
  });

  it("marks a shared board and hides the owner-only controls", async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse([boardSummary("board-1", "My board", false)])
    );
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    expect(
      screen.getByRole("option", { name: "My board (shared)" })
    ).toBeInTheDocument();
    for (const name of ["Rename board", "Share board", "Delete board"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    // Creating a board of their own is still theirs to do.
    expect(screen.getByRole("button", { name: "New board" })).toBeEnabled();
  });

  it("shares the open board with another account", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    await user.click(screen.getByRole("button", { name: "Share board" }));
    await user.type(
      screen.getByLabelText("Username to share with"),
      "grace"
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "user-3", display_name: "Grace Hopper II" }, 201)
    );
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const roster = within(screen.getByRole("dialog"));
    expect(await roster.findByText("Grace Hopper II")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/boards/board-1/members",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "grace" }),
      })
    );
  });

  it("surfaces a refused share without closing the dialog", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    await user.click(screen.getByRole("button", { name: "Share board" }));
    await user.type(screen.getByLabelText("Username to share with"), "ghost");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "User not found" }, 404)
    );
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "User not found"
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Username to share with")).toHaveValue(
      "ghost"
    );
  });

  it("removes a member and refetches the board they were assigned on", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    await user.click(screen.getByRole("button", { name: "Share board" }));
    // The signed-in account owns this board, so only the other is removable.
    expect(
      screen.queryByRole("button", { name: "Remove Ada Lovelace" })
    ).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleBoard));
    await user.click(
      screen.getByRole("button", { name: "Remove Grace Hopper" })
    );

    await waitFor(() =>
      expect(screen.queryByText("Grace Hopper")).not.toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/boards/board-1/members/user-2",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("hides the accounts link from a member", async () => {
    render(<KanbanBoard />);

    expect(await screen.findByText("Align roadmap themes")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Manage accounts" })
    ).not.toBeInTheDocument();
  });

  it("links an admin to the accounts screen", async () => {
    signedInUser = { ...member, role: "admin" };
    render(<KanbanBoard />);

    expect(
      await screen.findByRole("link", { name: "Manage accounts" })
    ).toHaveAttribute("href", "/admin");
  });

  it("gives every icon-only control an accessible name", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);

    const column = await screen.findByTestId("column-col-backlog");
    // Mount the controls that are only rendered once a panel is open.
    await user.click(within(column).getByRole("button", { name: /add a card/i }));
    await user.click(screen.getByRole("button", { name: "AI assistant" }));

    const buttons = screen.getAllByRole("button");
    expect(screen.getAllByRole("button", { name: /\S/ })).toHaveLength(
      buttons.length
    );
    expect(
      within(column).getByRole("button", { name: "Delete Align roadmap themes" })
    ).toBeInTheDocument();
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
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "I moved the card.", board_update: updatedBoard })
    );
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
          board_id: "board-1",
          messages: [{ role: "user", content: "Move this card to Done" }],
        }),
      })
    );
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init?.method ?? "GET") === "PUT"
      )
    ).toBe(false);
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

  const columnTitles = () =>
    screen
      .getAllByRole("textbox", { name: "Column title" })
      .map((input) => (input as HTMLInputElement).value);

  it("adds a column and renders the board the backend returns", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    await user.click(screen.getByRole("button", { name: "Add a column" }));
    await user.type(
      screen.getByRole("textbox", { name: "New column title" }),
      "Blocked"
    );
    await user.click(screen.getByRole("button", { name: "Add column" }));

    expect(await screen.findByDisplayValue("Blocked")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/columns",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ board_id: "board-1", title: "Blocked" }),
      })
    );
  });

  it("deletes a column along with its cards", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    const column = await screen.findByTestId("column-col-backlog");

    await user.click(
      within(column).getByRole("button", { name: "Delete Backlog column" })
    );

    expect(await screen.findByText("Prototype analytics view")).toBeVisible();
    expect(screen.queryByTestId("column-col-backlog")).not.toBeInTheDocument();
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
  });

  it("moves a column and reorders the board", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");
    expect(columnTitles()[0]).toBe("Backlog");

    await user.click(screen.getByRole("button", { name: "Move Backlog right" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/columns/col-backlog/move",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ position: 1 }),
      })
    );
    expect(columnTitles().slice(0, 2)).toEqual(["Discovery", "Backlog"]);
  });

  it("disables the move controls at each end of the board", async () => {
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    expect(
      screen.getByRole("button", { name: "Move Backlog left" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Done right" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Backlog right" })
    ).toBeEnabled();
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

  it("renders a card's priority, assignee, and labels", async () => {
    render(<KanbanBoard />);

    const card = await screen.findByTestId("card-card-1");
    expect(within(card).getByText("high")).toBeInTheDocument();
    expect(within(card).getByText("planning")).toBeInTheDocument();
    expect(await within(card).findByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("edits every card field through the detail dialog", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Prototype analytics view");

    await user.click(
      screen.getByRole("button", { name: "Edit Prototype analytics view" })
    );
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Priority"), "high");
    await user.type(within(dialog).getByLabelText("Due date"), "2026-12-24");
    await user.selectOptions(
      within(dialog).getByLabelText("Assignee"),
      "user-2"
    );
    await user.type(within(dialog).getByLabelText("Labels"), "design, design, ux");
    await user.click(within(dialog).getByRole("button", { name: "Save card" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cards/card-3",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          title: "Prototype analytics view",
          details: "Sketch the dashboard.",
          priority: "high",
          dueDate: "2026-12-24",
          labels: ["design", "ux"],
          assigneeId: "user-2",
        }),
      })
    );
    const updated = await screen.findByTestId("card-card-3");
    expect(within(updated).getByText("2026-12-24")).toBeInTheDocument();
    expect(within(updated).getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a card's comment thread and adds to it", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Prototype analytics view");

    await user.click(
      screen.getByRole("button", { name: "Edit Prototype analytics view" })
    );
    const dialog = screen.getByRole("dialog");
    // Scoped to the thread: "Grace Hopper" is also an Assignee option.
    const thread = within(dialog).getByRole("region", { name: "Comments" });
    expect(
      await within(thread).findByText("Blocked on the API review")
    ).toBeInTheDocument();
    expect(within(thread).getByText("Grace Hopper")).toBeInTheDocument();

    await user.type(
      within(dialog).getByLabelText("New comment"),
      "Review is done"
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add comment" })
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cards/card-3/comments",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "Review is done" }),
      })
    );
    expect(
      await within(dialog).findByText("Review is done")
    ).toBeInTheDocument();
  });

  it("counts a new comment on the card without refetching the board", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Prototype analytics view");
    const beforeBoardLoads = fetchMock.mock.calls.length;

    await user.click(
      screen.getByRole("button", { name: "Edit Prototype analytics view" })
    );
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Blocked on the API review");
    await user.type(within(dialog).getByLabelText("New comment"), "Noted");
    await user.click(
      within(dialog).getByRole("button", { name: "Add comment" })
    );
    await within(dialog).findByText("Noted");
    await user.click(
      within(dialog).getByRole("button", { name: "Close card details" })
    );

    // The board reported one comment and the reply makes two.
    expect(
      await within(screen.getByTestId("card-card-3")).findByLabelText(
        "2 comments"
      )
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls
        .slice(beforeBoardLoads)
        .map(([input]) => String(input))
    ).not.toContain("/api/boards/board-1");
  });

  it("only offers to delete one's own comment", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Prototype analytics view");

    await user.click(
      screen.getByRole("button", { name: "Edit Prototype analytics view" })
    );
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Blocked on the API review");

    // comment-1 belongs to Grace Hopper; the signed-in account is Ada.
    expect(
      within(dialog).queryByRole("button", {
        name: "Delete comment by Grace Hopper",
      })
    ).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("New comment"), "Mine");
    await user.click(
      within(dialog).getByRole("button", { name: "Add comment" })
    );
    const remove = await within(dialog).findByRole("button", {
      name: "Delete comment by Ada Lovelace",
    });
    await user.click(remove);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/comments/comment-2",
      expect.objectContaining({ method: "DELETE" })
    );
    await waitFor(() =>
      expect(within(dialog).queryByText("Mine")).not.toBeInTheDocument()
    );
  });

  it("closes the detail dialog without saving", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Prototype analytics view");

    await user.click(
      screen.getByRole("button", { name: "Edit Prototype analytics view" })
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === "/api/cards/card-3")
    ).toBe(false);
  });

  it("keeps the dialog open when saving fails", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Prototype analytics view");

    await user.click(
      screen.getByRole("button", { name: "Edit Prototype analytics view" })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Unknown assignee" }, 422)
    );
    await user.click(screen.getByRole("button", { name: "Save card" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unknown assignee"
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("filters the board by text, assignee, and label", async () => {
    const user = userEvent.setup();
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    await user.type(screen.getByLabelText("Search cards"), "customer");
    expect(screen.getByText("Gather customer signals")).toBeInTheDocument();
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
    // Every column stays on screen so cards can still be located by status.
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await user.selectOptions(
      screen.getByLabelText("Filter by assignee"),
      "user-1"
    );
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();
    expect(
      screen.queryByText("Gather customer signals")
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await user.selectOptions(screen.getByLabelText("Filter by label"), "research");
    expect(screen.getByText("Gather customer signals")).toBeInTheDocument();
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
  });

  it("offers only the labels present on the board", async () => {
    render(<KanbanBoard />);
    await screen.findByText("Align roadmap themes");

    expect(
      within(screen.getByLabelText("Filter by label"))
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["Any label", "planning", "research"]);
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
