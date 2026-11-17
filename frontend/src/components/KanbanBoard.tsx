"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import {
  createCard,
  deleteCard,
  getBoard,
  logout,
  moveCard as moveCardApi,
  replaceBoard,
  renameColumn,
} from "@/lib/api";
import { moveCard as calculateMove, type BoardData } from "@/lib/kanban";

export const KanbanBoard = () => {
  const router = useRouter();
  const [board, setBoard] = useState<BoardData | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false);
  const [isAiBusy, setIsAiBusy] = useState(false);
  const isBoardBusy = isSaving || isAiBusy;

  const loadBoard = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      setBoard(await getBoard());
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to load the board."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

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

    if (!board || isBoardBusy || !over || active.id === over.id) {
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

  const handleRenameColumn = (columnId: string, title: string) =>
    runMutation(
      () => renameColumn(columnId, title),
      ({ title: savedTitle }) => {
        setBoard((previous) =>
          previous
            ? {
                ...previous,
                columns: previous.columns.map((column) =>
                  column.id === columnId
                    ? { ...column, title: savedTitle }
                    : column
                ),
              }
            : previous
        );
      }
    );

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

  const handleAiBoardUpdate = async (updatedBoard: BoardData) => {
    setBoard(await replaceBoard(updatedBoard));
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
          onClick={() => void loadBoard()}
          className="mt-4 rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </main>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <div className="relative mx-auto flex min-h-screen max-w-[1900px] flex-col gap-6 px-6 pb-16 pt-12 xl:flex-row">
        <main className="flex min-w-0 flex-1 flex-col gap-10">
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-4">
              <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                  Focus
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                  One board. Five columns. Zero clutter.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAiSidebarOpen((open) => !open)}
                aria-controls="ai-sidebar"
                aria-expanded={isAiSidebarOpen}
                className="rounded-full border border-[var(--primary-blue)] px-5 py-3 text-sm font-semibold text-[var(--primary-blue)] transition hover:bg-[var(--primary-blue)] hover:text-white"
              >
                AI assistant
              </button>
              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {isLoggingOut ? "Signing out..." : "Log out"}
              </button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {isSaving && <p role="status">Saving changes...</p>}
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <section className="grid gap-6 lg:grid-cols-5">
            {board.columns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                cards={column.cardIds.map((cardId) => board.cards[cardId])}
                disabled={isBoardBusy}
                onRename={handleRenameColumn}
                onAddCard={handleAddCard}
                onDeleteCard={handleDeleteCard}
              />
            ))}
          </section>
          <DragOverlay>
            {activeCard ? (
              <div className="w-[260px]">
                <KanbanCardPreview card={activeCard} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        </main>
        <AiSidebar
          isOpen={isAiSidebarOpen}
          isBoardSaving={isSaving}
          board={board}
          onClose={() => setIsAiSidebarOpen(false)}
          onBoardUpdate={handleAiBoardUpdate}
          onBusyChange={setIsAiBusy}
        />
      </div>
    </div>
  );
};
