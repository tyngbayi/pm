import clsx from "clsx";
import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronLeft, ChevronRight, Gauge, Trash2 } from "lucide-react";
import type { ColumnChanges } from "@/lib/api";
import type { Card, Column } from "@/lib/kanban";
import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";

type KanbanColumnProps = {
  column: Column;
  cards: Card[];
  index: number;
  columnCount: number;
  disabled: boolean;
  dragDisabled: boolean;
  assigneeNames: Record<string, string>;
  onUpdate: (columnId: string, changes: ColumnChanges) => Promise<boolean>;
  onMove: (columnId: string, position: number) => Promise<boolean>;
  onDelete: (columnId: string) => Promise<boolean>;
  onAddCard: (
    columnId: string,
    title: string,
    details: string
  ) => Promise<boolean>;
  onEditCard: (cardId: string) => void;
  onDeleteCard: (columnId: string, cardId: string) => Promise<boolean>;
};

const columnButton =
  "shrink-0 rounded-full border border-transparent p-1.5 text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--primary-blue)] disabled:opacity-30";

/** Matches the API's cap; the limit is an agreement, not a quota. */
const MAX_WIP_LIMIT = 99;

export const KanbanColumn = ({
  column,
  cards,
  index,
  columnCount,
  disabled,
  dragDisabled,
  assigneeNames,
  onUpdate,
  onMove,
  onDelete,
  onAddCard,
  onEditCard,
  onDeleteCard,
}: KanbanColumnProps) => {
  const [titleDraft, setTitleDraft] = useState({
    base: column.title,
    value: column.title,
  });
  const currentTitleDraft =
    titleDraft.base === column.title ? titleDraft.value : column.title;
  // Null while the editor is closed, so opening it always reseeds from the
  // column and there is no stale draft to reconcile.
  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const overLimit = column.wipLimit > 0 && cards.length > column.wipLimit;

  const saveTitle = async () => {
    const title = currentTitleDraft.trim();
    if (!title || title === column.title) {
      setTitleDraft({ base: column.title, value: column.title });
      return;
    }
    if (!(await onUpdate(column.id, { title }))) {
      setTitleDraft({ base: column.title, value: column.title });
    }
  };

  const saveLimit = async () => {
    const wipLimit = Number(limitDraft);
    setLimitDraft(null);
    if (
      Number.isInteger(wipLimit) &&
      wipLimit >= 0 &&
      wipLimit <= MAX_WIP_LIMIT &&
      wipLimit !== column.wipLimit
    ) {
      await onUpdate(column.id, { wipLimit });
    }
  };

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        "flex min-h-[420px] w-[280px] min-w-[280px] flex-1 flex-col rounded-3xl border border-[var(--stroke)] bg-[var(--surface-strong)] p-4 shadow-[var(--shadow)] transition",
        isOver && "ring-2 ring-[var(--accent-yellow)]"
      )}
      data-testid={`column-${column.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-full">
          <div className="flex items-center gap-3">
            <div className="h-2 w-10 rounded-full bg-[var(--accent-yellow)]" />
            <span
              className={clsx(
                "text-xs font-semibold uppercase tracking-[0.2em]",
                overLimit ? "text-red-700" : "text-[var(--gray-text)]"
              )}
              aria-label={
                column.wipLimit > 0
                  ? `${cards.length} of ${column.wipLimit} cards${
                      overLimit ? ", over the limit" : ""
                    }`
                  : `${cards.length} cards`
              }
            >
              {column.wipLimit > 0
                ? `${cards.length}/${column.wipLimit} cards`
                : `${cards.length} cards`}
            </span>
            <div className="ml-auto flex items-center">
              <button
                type="button"
                onClick={() =>
                  setLimitDraft((open) =>
                    open === null ? String(column.wipLimit) : null
                  )
                }
                disabled={disabled}
                aria-label={`Set ${column.title} limit`}
                className={columnButton}
              >
                <Gauge aria-hidden className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void onMove(column.id, index - 1)}
                disabled={disabled || index === 0}
                aria-label={`Move ${column.title} left`}
                className={columnButton}
              >
                <ChevronLeft aria-hidden className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void onMove(column.id, index + 1)}
                disabled={disabled || index === columnCount - 1}
                aria-label={`Move ${column.title} right`}
                className={columnButton}
              >
                <ChevronRight aria-hidden className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void onDelete(column.id)}
                disabled={disabled}
                aria-label={`Delete ${column.title} column`}
                className={`${columnButton} hover:text-red-600`}
              >
                <Trash2 aria-hidden className="h-4 w-4" />
              </button>
            </div>
          </div>
          <input
            value={currentTitleDraft}
            disabled={disabled}
            onChange={(event) =>
              setTitleDraft({ base: column.title, value: event.target.value })
            }
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            className="mt-3 w-full bg-transparent font-display text-lg font-semibold text-[var(--navy-dark)] outline-none"
            aria-label="Column title"
          />
          {limitDraft !== null && (
            <label className="mt-2 flex items-center gap-2 text-xs text-[var(--gray-text)]">
              <input
                type="number"
                min={0}
                max={MAX_WIP_LIMIT}
                autoFocus
                value={limitDraft}
                disabled={disabled}
                onChange={(event) => setLimitDraft(event.target.value)}
                onBlur={() => void saveLimit()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                className="w-16 rounded-lg border border-[var(--stroke)] bg-white px-2 py-1 text-[var(--navy-dark)] outline-none"
                aria-label="WIP limit"
              />
              0 for no limit
            </label>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-1 flex-col gap-3">
        <SortableContext items={column.cardIds} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              assigneeName={
                card.assigneeId ? (assigneeNames[card.assigneeId] ?? "") : ""
              }
              disabled={disabled}
              dragDisabled={dragDisabled}
              onEdit={onEditCard}
              onDelete={(cardId) => onDeleteCard(column.id, cardId)}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--stroke)] px-3 py-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
            Drop a card here
          </div>
        )}
      </div>
      <NewCardForm
        disabled={disabled}
        onAdd={(title, details) => onAddCard(column.id, title, details)}
      />
    </section>
  );
};
