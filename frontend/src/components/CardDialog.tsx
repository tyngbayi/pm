import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { CardChecklist } from "@/components/CardChecklist";
import { CardComments } from "@/components/CardComments";
import type { CardChanges } from "@/lib/api";
import { PRIORITIES, type Card, type Member, type Priority } from "@/lib/kanban";

type CardDialogProps = {
  card: Card;
  members: Member[];
  currentUserId: string;
  disabled: boolean;
  onSave: (cardId: string, changes: CardChanges) => Promise<boolean>;
  onCommentCountChange: (cardId: string, delta: number) => void;
  onChecklistChange: (cardId: string, done: number, total: number) => void;
  onClose: () => void;
};

const field =
  "w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]";
const label =
  "text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]";

export const parseLabels = (value: string): string[] => [
  ...new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  ),
];

export const CardDialog = ({
  card,
  members,
  currentUserId,
  disabled,
  onSave,
  onCommentCountChange,
  onChecklistChange,
  onClose,
}: CardDialogProps) => {
  const [draft, setDraft] = useState({
    title: card.title,
    details: card.details,
    priority: card.priority,
    dueDate: card.dueDate,
    labels: card.labels.join(", "),
    assigneeId: card.assigneeId ?? "",
  });

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      return;
    }
    const saved = await onSave(card.id, {
      title,
      details: draft.details,
      priority: draft.priority,
      dueDate: draft.dueDate,
      labels: parseLabels(draft.labels),
      assigneeId: draft.assigneeId || null,
    });
    if (saved) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,33,71,0.45)] p-4">
      {/* The dialog is a div, not a form: the checklist and the comment thread
          each have a form of their own, and nesting forms is invalid HTML. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${card.title}`}
        className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-[0_24px_48px_rgba(3,33,71,0.24)]"
      >
        {/* Sticky: the checklist and thread make the dialog scroll, and the
            close button has to stay reachable from the bottom of it. */}
        <div className="sticky top-0 flex items-start justify-between gap-3 bg-white pb-2">
          <h2 className="font-display text-xl font-semibold text-[var(--navy-dark)]">
            Card details
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close card details"
            className="rounded-full border border-transparent p-1.5 text-[var(--gray-text)] transition hover:border-[var(--stroke)]"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4"
        >
        <label className="flex flex-col gap-1.5">
          <span className={label}>Title</span>
          <input
            value={draft.title}
            required
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
            className={field}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={label}>Details</span>
          <textarea
            value={draft.details}
            rows={3}
            onChange={(event) =>
              setDraft({ ...draft, details: event.target.value })
            }
            className={`${field} resize-none`}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={label}>Priority</span>
            <select
              value={draft.priority}
              onChange={(event) =>
                setDraft({ ...draft, priority: event.target.value as Priority })
              }
              className={field}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={label}>Due date</span>
            <input
              type="date"
              value={draft.dueDate}
              onChange={(event) =>
                setDraft({ ...draft, dueDate: event.target.value })
              }
              className={field}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={label}>Assignee</span>
          <select
            value={draft.assigneeId}
            onChange={(event) =>
              setDraft({ ...draft, assigneeId: event.target.value })
            }
            className={field}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.display_name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1.5">
            <span className={label}>Labels</span>
            <input
              value={draft.labels}
              placeholder="design, urgent"
              onChange={(event) =>
                setDraft({ ...draft, labels: event.target.value })
              }
              className={field}
            />
          </label>
          <span className="text-xs text-[var(--gray-text)]">
            Separate labels with commas.
          </span>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--stroke)] px-5 py-2 text-sm font-semibold text-[var(--navy-dark)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={disabled}
            className="rounded-full bg-[var(--secondary-purple)] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            Save card
          </button>
        </div>
        </form>

        <CardChecklist
          cardId={card.id}
          onProgressChange={(done, total) =>
            onChecklistChange(card.id, done, total)
          }
        />

        <CardComments
          cardId={card.id}
          currentUserId={currentUserId}
          onCountChange={(delta) => onCommentCountChange(card.id, delta)}
        />
      </div>
    </div>
  );
};
