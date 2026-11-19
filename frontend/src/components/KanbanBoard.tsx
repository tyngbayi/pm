"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  History,
  ListChecks,
  LogOut,
  Sparkles,
  Users,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "@/components/KanbanColumn";
import { AiSidebar } from "@/components/AiSidebar";
import { BoardFilters } from "@/components/BoardFilters";
import { BoardSwitcher } from "@/components/BoardSwitcher";
import { CardDialog } from "@/components/CardDialog";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { MyWorkDialog } from "@/components/MyWorkDialog";
import { ActivityDialog } from "@/components/ActivityDialog";
import { ArchiveDialog } from "@/components/ArchiveDialog";
import { NewColumnForm } from "@/components/NewColumnForm";
import { ShareDialog } from "@/components/ShareDialog";
import {
  addBoardMember,
  createBoard,
  createCard,
  createColumn,
  deleteBoard,
  deleteCard,
  deleteColumn,
  getBoard,
  getBoardMembers,
  getBoards,
  getCurrentUser,
  logout,
  removeBoardMember,
  moveCard as moveCardApi,
  moveCardToBoard,
  moveColumn,
  renameBoard,
  setCardArchived,
  updateCard,
  updateColumn,
  type BoardSummary,
  type CardChanges,
  type ColumnChanges,
  type User,
} from "@/lib/api";
import {
  EMPTY_FILTER,
  boardLabels,
  filterBoard,
  isFiltering,
  moveCard as calculateMove,
  type BoardData,
  type Member,
} from "@/lib/kanban";

export const KanbanBoard = () => {
  const router = useRouter();
  const [board, setBoard] = useState<BoardData | null>(null);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [activeBoardId, setActiveBoardId] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isMyWorkOpen, setIsMyWorkOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false);
  const [isAiBusy, setIsAiBusy] = useState(false);
  const isBoardBusy = isSaving || isAiBusy;

  /** Refresh the board list and show `boardId`, falling back to the first. */
  const openBoard = useCallback(async (boardId: string) => {
    setError(null);
    setIsLoading(true);
    try {
      const summaries = await getBoards();
      const target =
        summaries.find((summary) => summary.id === boardId) ?? summaries[0];
      setBoards(summaries);
      setActiveBoardId(target.id);
      setBoard(await getBoard(target.id));
      // The roster is per board, so it is reloaded alongside it. Without it
      // assignees render as ids and the picker is empty, which is not worth
      // failing the whole board over.
      setMembers(await getBoardMembers(target.id).catch(() => []));
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to load the board."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void openBoard("");
  }, [openBoard]);

  useEffect(() => {
    // AuthGuard already redirects on an invalid session, so a failure here
    // only means the header renders without a name.
    void getCurrentUser().then(setUser, () => undefined);
  }, []);

  const runMutation = async <T,>(
    request: () => Promise<T>,
    apply: (result: T) => void
  ): Promise<boolean> => {
    if (isBoardBusy) {
      return false;
    }
    setError(null);
    setIsSaving(true);
    try {
      apply(await request());
      return true;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to save the change."
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (!isBoardBusy) {
      setActiveCardId(String(event.active.id));
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (
      !board ||
      isBoardBusy ||
      isFiltering(filter) ||
      !over ||
      active.id === over.id
    ) {
      return;
    }

    const cardId = String(active.id);
    const nextColumns = calculateMove(
      board.columns,
      cardId,
      String(over.id)
    );
    if (nextColumns === board.columns) {
      return;
    }
    const destination = nextColumns.find((column) =>
      column.cardIds.includes(cardId)
    );
    const position = destination?.cardIds.indexOf(cardId) ?? -1;
    if (!destination || position < 0) {
      return;
    }
    await runMutation(
      () => moveCardApi(cardId, destination.id, position),
      setBoard
    );
  };

  const handleUpdateColumn = (columnId: string, changes: ColumnChanges) =>
    runMutation(
      () => updateColumn(columnId, changes),
      ({ id, ...saved }) => {
        setBoard((previous) =>
          previous
            ? {
                ...previous,
                columns: previous.columns.map((column) =>
                  column.id === id ? { ...column, ...saved } : column
                ),
              }
            : previous
        );
      }
    );

  // Column writes reshape the whole board, so the server's copy replaces ours.
  const handleAddColumn = (title: string) =>
    runMutation(() => createColumn(activeBoardId, title), setBoard);

  const handleDeleteColumn = (columnId: string) =>
    runMutation(() => deleteColumn(columnId), setBoard);

  const handleMoveColumn = (columnId: string, position: number) =>
    runMutation(() => moveColumn(columnId, position), setBoard);

  const handleAddCard = (
    columnId: string,
    title: string,
    details: string
  ) =>
    runMutation(
      () => createCard(columnId, title, details || "No details yet."),
      (card) => {
        setBoard((previous) =>
          previous
            ? {
                ...previous,
                cards: { ...previous.cards, [card.id]: card },
                columns: previous.columns.map((column) =>
                  column.id === columnId
                    ? { ...column, cardIds: [...column.cardIds, card.id] }
                    : column
                ),
              }
            : previous
        );
      }
    );

  const handleUpdateCard = (cardId: string, changes: CardChanges) =>
    runMutation(
      () => updateCard(cardId, changes),
      (card) => {
        setBoard((previous) =>
          previous
            ? { ...previous, cards: { ...previous.cards, [card.id]: card } }
            : previous
        );
      }
    );

  // The thread owns its own requests, so only the card's badge count is
  // adjusted here rather than refetching the board for each comment.
  const handleCommentCountChange = (cardId: string, delta: number) =>
    setBoard((previous) => {
      const card = previous?.cards[cardId];
      if (!previous || !card) {
        return previous;
      }
      return {
        ...previous,
        cards: {
          ...previous.cards,
          [cardId]: { ...card, commentCount: card.commentCount + delta },
        },
      };
    });

  const handleChecklistChange = (
    cardId: string,
    done: number,
    total: number
  ) =>
    setBoard((previous) => {
      const card = previous?.cards[cardId];
      if (!previous || !card) {
        return previous;
      }
      return {
        ...previous,
        cards: {
          ...previous.cards,
          [cardId]: { ...card, checklistDone: done, checklistTotal: total },
        },
      };
    });

  const handleBlockerCountChange = (cardId: string, count: number) =>
    setBoard((previous) => {
      const card = previous?.cards[cardId];
      if (!previous || !card) {
        return previous;
      }
      return {
        ...previous,
        cards: {
          ...previous.cards,
          [cardId]: { ...card, blockerCount: count },
        },
      };
    });

  const handleDeleteCard = (columnId: string, cardId: string) =>
    runMutation(
      () => deleteCard(cardId),
      () => {
        setBoard((previous) =>
          previous
            ? {
                ...previous,
                cards: Object.fromEntries(
                  Object.entries(previous.cards).filter(
                    ([id]) => id !== cardId
                  )
                ),
                columns: previous.columns.map((column) =>
                  column.id === columnId
                    ? {
                        ...column,
                        cardIds: column.cardIds.filter((id) => id !== cardId),
                      }
                    : column
                ),
              }
            : previous
        );
      }
    );

  const handleArchiveCard = (cardId: string) =>
    runMutation(() => setCardArchived(cardId, true), setBoard);

  const handleRestoreCard = (cardId: string) =>
    runMutation(() => setCardArchived(cardId, false), setBoard);

  // The response is the board the card left, which is the one on screen; the
  // dialog then has no card to show, so the editor closes with it.
  const handleMoveCardToBoard = (cardId: string, boardId: string) =>
    runMutation(
      () => moveCardToBoard(cardId, boardId),
      (source) => {
        setBoard(source);
        setEditingCardId(null);
      }
    );

  const handleCreateBoard = (name: string) =>
    runMutation(
      () => createBoard(name),
      (created) => {
        void openBoard(created.id);
      }
    );

  const handleRenameBoard = (name: string) =>
    runMutation(
      () => renameBoard(activeBoardId, name),
      (renamed) => {
        setBoards((previous) =>
          previous.map((board) =>
            board.id === renamed.id ? renamed : board
          )
        );
      }
    );

  const handleDeleteBoard = () =>
    runMutation(
      () => deleteBoard(activeBoardId),
      () => {
        void openBoard("");
      }
    );

  const handleAddMember = (username: string) =>
    runMutation(
      () => addBoardMember(activeBoardId, username),
      (member) => setMembers((previous) => [...previous, member])
    );

  const handleRemoveMember = (memberId: string) =>
    runMutation(
      async () => {
        await removeBoardMember(activeBoardId, memberId);
        // Their cards are unassigned server-side, so the board is refetched
        // rather than patched locally.
        return getBoard(activeBoardId);
      },
      (refreshed) => {
        setBoard(refreshed);
        setMembers((previous) =>
          previous.filter((member) => member.id !== memberId)
        );
      }
    );

  // An assignment may sit on another board, so that board is opened first.
  const handleOpenAssignment = async (boardId: string, cardId: string) => {
    setIsMyWorkOpen(false);
    if (boardId !== activeBoardId) {
      await openBoard(boardId);
    }
    setEditingCardId(cardId);
  };

  const handleLogout = async () => {
    setError(null);
    setIsLoggingOut(true);

    try {
      await logout();
      router.replace("/login");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to log out."
      );
    } finally {
      setIsLoggingOut(false);
    }
  };

  const activeCard = activeCardId ? board?.cards[activeCardId] : null;

  if (isLoading) {
    return (
      <main className="p-8">
        <p role="status">Loading board...</p>
      </main>
    );
  }

  if (!board) {
    return (
      <main className="p-8">
        <p role="alert">{error ?? "Unable to load the board."}</p>
        <button
          type="button"
          onClick={() => void openBoard(activeBoardId)}
          className="mt-4 rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </main>
    );
  }

  const activeBoard = boards.find((summary) => summary.id === activeBoardId);
  const assigneeNames = Object.fromEntries(
    members.map((member) => [member.id, member.display_name])
  );
  const visibleBoard = filterBoard(board, filter);
  const visibleCardCount = Object.keys(visibleBoard.cards).length;
  const editingCard = editingCardId ? board.cards[editingCardId] : null;
  // Positions are absolute, so dragging a filtered board would persist the
  // wrong index.
  const isDragDisabled = isBoardBusy || isFiltering(filter);

  const lastColumn = board.columns[board.columns.length - 1];
  const stats = [
    { label: "Columns", value: board.columns.length },
    { label: "Cards", value: Object.keys(board.cards).length },
    ...(lastColumn
      ? [{ label: lastColumn.title, value: lastColumn.cardIds.length }]
      : []),
  ];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[2400px] flex-col gap-6 px-5 pb-10 pt-8 xl:flex-row xl:gap-8 xl:px-8">
        <main className="flex min-w-0 flex-1 flex-col gap-6">
          <header className="flex flex-col gap-4 rounded-[28px] border border-[var(--stroke)] bg-white/80 px-6 py-5 shadow-[var(--shadow)] backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
              <div className="min-w-0">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                  {user ? `Signed in as ${user.display_name}` : "Kanban"}
                </p>
                <h1 className="mt-1 font-display text-3xl font-semibold leading-tight text-[var(--navy-dark)]">
                  Kanban Studio
                </h1>
              </div>

              <BoardSwitcher
                boards={boards}
                activeBoardId={activeBoardId}
                disabled={isBoardBusy}
                onSelect={(boardId) => void openBoard(boardId)}
                onCreate={handleCreateBoard}
                onRename={handleRenameBoard}
                onDelete={handleDeleteBoard}
                onShare={() => setIsSharing(true)}
              />

              <div className="flex flex-wrap items-center gap-3">
                <dl className="flex items-center divide-x divide-[var(--stroke)] rounded-2xl border border-[var(--stroke)] bg-[var(--surface)]">
                  {stats.map((stat) => (
                    <div key={stat.label} className="px-5 py-2 text-center">
                      <dt className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
                        {stat.label}
                      </dt>
                      <dd className="font-display text-xl font-semibold text-[var(--primary-blue)]">
                        {stat.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  onClick={() => setIsMyWorkOpen(true)}
                  aria-label="My work"
                  className="rounded-full border border-[var(--stroke)] p-2.5 text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
                >
                  <ListChecks aria-hidden className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsActivityOpen(true)}
                  aria-label="Board history"
                  className="rounded-full border border-[var(--stroke)] p-2.5 text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
                >
                  <History aria-hidden className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsArchiveOpen(true)}
                  aria-label="Archive"
                  className="rounded-full border border-[var(--stroke)] p-2.5 text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
                >
                  <Archive aria-hidden className="h-5 w-5" />
                </button>
                {user?.role === "admin" && (
                  <Link
                    href="/admin"
                    aria-label="Manage accounts"
                    className="rounded-full border border-[var(--stroke)] p-2.5 text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
                  >
                    <Users aria-hidden className="h-5 w-5" />
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => setIsAiSidebarOpen((open) => !open)}
                  aria-controls="ai-sidebar"
                  aria-expanded={isAiSidebarOpen}
                  aria-label="AI assistant"
                  className="rounded-full border border-[var(--primary-blue)] p-2.5 text-[var(--primary-blue)] transition hover:bg-[var(--primary-blue)] hover:text-white"
                >
                  <Sparkles aria-hidden className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  aria-label="Log out"
                  className="rounded-full bg-[var(--secondary-purple)] p-2.5 text-white transition hover:brightness-110 disabled:opacity-60"
                >
                  <LogOut aria-hidden className="h-5 w-5" />
                </button>
              </div>
            </div>
            <BoardFilters
              filter={filter}
              labels={boardLabels(board)}
              members={members}
              matchCount={visibleCardCount}
              onChange={setFilter}
            />
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            {isSaving && (
              <p role="status" className="text-sm text-[var(--gray-text)]">
                Saving changes...
              </p>
            )}
          </header>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <section className="flex items-stretch gap-5 overflow-x-auto pb-3">
              {visibleBoard.columns.map((column, index) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  cards={column.cardIds.map(
                    (cardId) => visibleBoard.cards[cardId]
                  )}
                  index={index}
                  columnCount={visibleBoard.columns.length}
                  disabled={isBoardBusy}
                  dragDisabled={isDragDisabled}
                  assigneeNames={assigneeNames}
                  onUpdate={handleUpdateColumn}
                  onMove={handleMoveColumn}
                  onDelete={handleDeleteColumn}
                  onAddCard={handleAddCard}
                  onEditCard={setEditingCardId}
                  onArchiveCard={handleArchiveCard}
                  onDeleteCard={handleDeleteCard}
                />
              ))}
              <NewColumnForm disabled={isBoardBusy} onAdd={handleAddColumn} />
            </section>
            <DragOverlay>
              {activeCard ? (
                <div className="w-[280px]">
                  <KanbanCardPreview card={activeCard} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </main>
        <AiSidebar
          isOpen={isAiSidebarOpen}
          boardId={activeBoardId}
          isBoardSaving={isSaving}
          onClose={() => setIsAiSidebarOpen(false)}
          onBoardUpdate={setBoard}
          onBusyChange={setIsAiBusy}
        />
      </div>
      {isSharing && user && (
        <ShareDialog
          boardName={activeBoard?.name ?? "board"}
          ownerId={user.id}
          members={members}
          disabled={isBoardBusy}
          onAdd={handleAddMember}
          onRemove={handleRemoveMember}
          onClose={() => setIsSharing(false)}
        />
      )}
      {isMyWorkOpen && (
        <MyWorkDialog
          onOpenCard={(boardId, cardId) =>
            void handleOpenAssignment(boardId, cardId)
          }
          onClose={() => setIsMyWorkOpen(false)}
        />
      )}
      {isActivityOpen && activeBoardId && (
        <ActivityDialog
          boardId={activeBoardId}
          onClose={() => setIsActivityOpen(false)}
        />
      )}
      {isArchiveOpen && activeBoardId && (
        <ArchiveDialog
          boardId={activeBoardId}
          disabled={isBoardBusy}
          onRestore={handleRestoreCard}
          onClose={() => setIsArchiveOpen(false)}
        />
      )}
      {editingCard && user && (
        <CardDialog
          card={editingCard}
          members={members}
          otherBoards={boards.filter((summary) => summary.id !== activeBoardId)}
          boardCards={Object.values(board.cards)}
          currentUserId={user.id}
          disabled={isBoardBusy}
          onSave={handleUpdateCard}
          onMoveToBoard={handleMoveCardToBoard}
          onCommentCountChange={handleCommentCountChange}
          onChecklistChange={handleChecklistChange}
          onBlockerCountChange={handleBlockerCountChange}
          onClose={() => setEditingCardId(null)}
        />
      )}
    </div>
  );
};
