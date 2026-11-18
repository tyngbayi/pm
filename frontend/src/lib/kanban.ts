export const PRIORITIES = ["low", "medium", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Card = {
  id: string;
  title: string;
  details: string;
  priority: Priority;
  dueDate: string;
  labels: string[];
  assigneeId: string | null;
  /** Counted from the card's thread by the API; never sent back. */
  commentCount: number;
};

export type Member = {
  id: string;
  display_name: string;
};

export type Comment = {
  id: string;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
};

/** One entry in a board's history of who changed what. */
export type Activity = {
  id: string;
  summary: string;
  author_name: string;
  created_at: string;
};

/** One card assigned to the signed-in user, placed in the board it sits on. */
export type Assignment = {
  card_id: string;
  title: string;
  priority: Priority;
  dueDate: string;
  board_id: string;
  board_name: string;
  column_title: string;
};

export type Column = {
  id: string;
  title: string;
  cardIds: string[];
};

export type BoardData = {
  columns: Column[];
  cards: Record<string, Card>;
};

export type BoardFilter = {
  text: string;
  assigneeId: string;
  label: string;
};

/** An empty value in any field means "match anything". */
export const EMPTY_FILTER: BoardFilter = { text: "", assigneeId: "", label: "" };

export const isFiltering = (filter: BoardFilter) =>
  Boolean(filter.text.trim() || filter.assigneeId || filter.label);

export const boardLabels = (board: BoardData): string[] =>
  [
    ...new Set(Object.values(board.cards).flatMap((card) => card.labels)),
  ].sort((a, b) => a.localeCompare(b));

const matchesFilter = (card: Card, filter: BoardFilter) => {
  const needle = filter.text.trim().toLowerCase();
  const haystack = [card.title, card.details, ...card.labels]
    .join(" ")
    .toLowerCase();
  return (
    (!needle || haystack.includes(needle)) &&
    (!filter.assigneeId || card.assigneeId === filter.assigneeId) &&
    (!filter.label || card.labels.includes(filter.label))
  );
};

/** Narrow a board to the matching cards, keeping every column visible. */
export const filterBoard = (board: BoardData, filter: BoardFilter): BoardData => {
  if (!isFiltering(filter)) {
    return board;
  }
  const cards = Object.fromEntries(
    Object.values(board.cards)
      .filter((card) => matchesFilter(card, filter))
      .map((card) => [card.id, card])
  );
  return {
    columns: board.columns.map((column) => ({
      ...column,
      cardIds: column.cardIds.filter((cardId) => cardId in cards),
    })),
    cards,
  };
};

const isColumnId = (columns: Column[], id: string) =>
  columns.some((column) => column.id === id);

const findColumnId = (columns: Column[], id: string) => {
  if (isColumnId(columns, id)) {
    return id;
  }
  return columns.find((column) => column.cardIds.includes(id))?.id;
};

export const moveCard = (
  columns: Column[],
  activeId: string,
  overId: string
): Column[] => {
  const activeColumnId = findColumnId(columns, activeId);
  const overColumnId = findColumnId(columns, overId);

  if (!activeColumnId || !overColumnId) {
    return columns;
  }

  const activeColumn = columns.find((column) => column.id === activeColumnId);
  const overColumn = columns.find((column) => column.id === overColumnId);

  if (!activeColumn || !overColumn) {
    return columns;
  }

  const isOverColumn = isColumnId(columns, overId);

  if (activeColumnId === overColumnId) {
    if (isOverColumn) {
      const nextCardIds = activeColumn.cardIds.filter(
        (cardId) => cardId !== activeId
      );
      nextCardIds.push(activeId);
      return columns.map((column) =>
        column.id === activeColumnId
          ? { ...column, cardIds: nextCardIds }
          : column
      );
    }

    const oldIndex = activeColumn.cardIds.indexOf(activeId);
    const newIndex = activeColumn.cardIds.indexOf(overId);

    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      return columns;
    }

    const nextCardIds = [...activeColumn.cardIds];
    nextCardIds.splice(oldIndex, 1);
    nextCardIds.splice(newIndex, 0, activeId);

    return columns.map((column) =>
      column.id === activeColumnId
        ? { ...column, cardIds: nextCardIds }
        : column
    );
  }

  const activeIndex = activeColumn.cardIds.indexOf(activeId);
  if (activeIndex === -1) {
    return columns;
  }

  const nextActiveCardIds = [...activeColumn.cardIds];
  nextActiveCardIds.splice(activeIndex, 1);

  const nextOverCardIds = [...overColumn.cardIds];
  if (isOverColumn) {
    nextOverCardIds.push(activeId);
  } else {
    const overIndex = overColumn.cardIds.indexOf(overId);
    const insertIndex = overIndex === -1 ? nextOverCardIds.length : overIndex;
    nextOverCardIds.splice(insertIndex, 0, activeId);
  }

  return columns.map((column) => {
    if (column.id === activeColumnId) {
      return { ...column, cardIds: nextActiveCardIds };
    }
    if (column.id === overColumnId) {
      return { ...column, cardIds: nextOverCardIds };
    }
    return column;
  });
};
