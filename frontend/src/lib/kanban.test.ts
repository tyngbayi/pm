import {
  EMPTY_FILTER,
  boardLabels,
  filterBoard,
  isFiltering,
  moveCard,
  type BoardData,
  type Card,
  type Column,
} from "@/lib/kanban";

describe("moveCard", () => {
  const baseColumns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "B", cardIds: ["card-3"] },
  ];

  it("reorders cards in the same column", () => {
    const result = moveCard(baseColumns, "card-2", "card-1");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("moves cards to another column", () => {
    const result = moveCard(baseColumns, "card-2", "card-3");
    expect(result[0].cardIds).toEqual(["card-1"]);
    expect(result[1].cardIds).toEqual(["card-2", "card-3"]);
  });

  it("drops cards to the end of a column", () => {
    const result = moveCard(baseColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual(["card-2"]);
    expect(result[1].cardIds).toEqual(["card-3", "card-1"]);
  });
});

describe("filterBoard", () => {
  const card = (id: string, extra: Partial<Card>): Card => ({
    id,
    title: id,
    details: "",
    priority: "medium",
    dueDate: "",
    labels: [],
    assigneeId: null,
    ...extra,
  });

  const board: BoardData = {
    columns: [
      { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
      { id: "col-b", title: "B", cardIds: ["card-3"] },
    ],
    cards: {
      "card-1": card("card-1", {
        title: "Ship the API",
        labels: ["backend"],
        assigneeId: "user-1",
      }),
      "card-2": card("card-2", {
        title: "Polish the UI",
        details: "Tidy the API panel",
        labels: ["design"],
      }),
      "card-3": card("card-3", { title: "Write docs", assigneeId: "user-2" }),
    },
  };

  const titles = (result: BoardData) =>
    result.columns.flatMap((column) => column.cardIds);

  it("returns the board untouched when nothing is filtered", () => {
    expect(filterBoard(board, EMPTY_FILTER)).toBe(board);
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
    expect(isFiltering({ ...EMPTY_FILTER, text: "   " })).toBe(false);
  });

  it("matches text against the title, details, and labels", () => {
    expect(titles(filterBoard(board, { ...EMPTY_FILTER, text: " API " }))).toEqual([
      "card-1",
      "card-2",
    ]);
    expect(
      titles(filterBoard(board, { ...EMPTY_FILTER, text: "DESIGN" }))
    ).toEqual(["card-2"]);
  });

  it("combines the text, assignee, and label filters", () => {
    expect(
      titles(
        filterBoard(board, { text: "api", assigneeId: "user-1", label: "backend" })
      )
    ).toEqual(["card-1"]);
    expect(
      titles(
        filterBoard(board, { text: "api", assigneeId: "user-2", label: "" })
      )
    ).toEqual([]);
  });

  it("keeps every column so cards stay findable by status", () => {
    const result = filterBoard(board, { ...EMPTY_FILTER, label: "design" });

    expect(result.columns.map((column) => column.id)).toEqual(["col-a", "col-b"]);
    expect(Object.keys(result.cards)).toEqual(["card-2"]);
  });

  it("lists the board's labels once, in order", () => {
    expect(boardLabels(board)).toEqual(["backend", "design"]);
  });
});
