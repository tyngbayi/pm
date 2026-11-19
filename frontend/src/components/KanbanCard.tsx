import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import {
  Archive,
  CalendarDays,
  CircleSlash,
  ListChecks,
  MessageSquare,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";
import type { Card, Priority } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  assigneeName: string;
  disabled: boolean;
  dragDisabled: boolean;
  onEdit: (cardId: string) => void;
  onArchive: (cardId: string) => Promise<boolean>;
  onDelete: (cardId: string) => Promise<boolean>;
};

const priorityStyles: Record<Priority, string> = {
  low: "bg-[var(--surface)] text-[var(--gray-text)]",
  medium: "bg-[rgba(32,157,215,0.12)] text-[var(--primary-blue)]",
  high: "bg-[rgba(236,173,10,0.18)] text-[#8a6200]",
};

const cardButton =
  "shrink-0 rounded-full border border-transparent p-1.5 text-[var(--gray-text)] transition hover:border-[var(--stroke)]";

/** ISO dates sort lexicographically, so a string compare is enough. */
const isOverdue = (dueDate: string) =>
  Boolean(dueDate) && dueDate < new Date().toISOString().slice(0, 10);

export const KanbanCard = ({
  card,
  assigneeName,
  disabled,
  dragDisabled,
  onEdit,
  onArchive,
  onDelete,
}: KanbanCardProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: dragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "rounded-2xl border border-transparent bg-white px-4 py-4 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      {...attributes}
      {...listeners}
      data-testid={`card-${card.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
            {card.title}
          </h4>
          <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
            {card.details}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => onEdit(card.id)}
            disabled={disabled}
            className={`${cardButton} hover:text-[var(--primary-blue)]`}
            aria-label={`Edit ${card.title}`}
          >
            <Pencil aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void onArchive(card.id)}
            disabled={disabled}
            className={`${cardButton} hover:text-[var(--secondary-purple)]`}
            aria-label={`Archive ${card.title}`}
          >
            <Archive aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void onDelete(card.id)}
            disabled={disabled}
            className={`${cardButton} hover:text-red-600`}
            aria-label={`Delete ${card.title}`}
          >
            <Trash2 aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={clsx(
            "rounded-full px-2.5 py-1 font-semibold uppercase tracking-[0.1em]",
            priorityStyles[card.priority]
          )}
        >
          {card.priority}
        </span>
        {card.dueDate && (
          <span
            className={clsx(
              "inline-flex items-center gap-1.5",
              isOverdue(card.dueDate)
                ? "font-semibold text-red-700"
                : "text-[var(--gray-text)]"
            )}
          >
            <CalendarDays aria-hidden className="h-3.5 w-3.5" />
            {card.dueDate}
          </span>
        )}
        {assigneeName && (
          <span className="inline-flex items-center gap-1.5 text-[var(--gray-text)]">
            <UserRound aria-hidden className="h-3.5 w-3.5" />
            {assigneeName}
          </span>
        )}
        {card.blockerCount > 0 && (
          <span
            className="inline-flex items-center gap-1.5 font-semibold text-red-700"
            aria-label={`Blocked by ${card.blockerCount} card${
              card.blockerCount === 1 ? "" : "s"
            }`}
          >
            <CircleSlash aria-hidden className="h-3.5 w-3.5" />
            Blocked
          </span>
        )}
        {card.commentCount > 0 && (
          <span
            className="inline-flex items-center gap-1.5 text-[var(--gray-text)]"
            aria-label={`${card.commentCount} comment${
              card.commentCount === 1 ? "" : "s"
            }`}
          >
            <MessageSquare aria-hidden className="h-3.5 w-3.5" />
            {card.commentCount}
          </span>
        )}
        {card.checklistTotal > 0 && (
          <span
            className="inline-flex items-center gap-1.5 text-[var(--gray-text)]"
            aria-label={`${card.checklistDone} of ${card.checklistTotal} checklist items done`}
          >
            <ListChecks aria-hidden className="h-3.5 w-3.5" />
            {card.checklistDone}/{card.checklistTotal}
          </span>
        )}
        {card.labels.map((cardLabel) => (
          <span
            key={cardLabel}
            className="rounded-full border border-[var(--stroke)] px-2.5 py-1 text-[var(--navy-dark)]"
          >
            {cardLabel}
          </span>
        ))}
      </div>
    </article>
  );
};
