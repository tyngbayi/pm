import { useEffect, useState } from "react";
import clsx from "clsx";
import { CalendarDays, X } from "lucide-react";
import { getAssignments } from "@/lib/api";
import type { Assignment } from "@/lib/kanban";

type MyWorkDialogProps = {
  onOpenCard: (boardId: string, cardId: string) => void;
  onClose: () => void;
};

/** ISO dates sort lexicographically, so a string compare is enough. */
const isOverdue = (dueDate: string) =>
  Boolean(dueDate) && dueDate < new Date().toISOString().slice(0, 10);

export const MyWorkDialog = ({ onOpenCard, onClose }: MyWorkDialogProps) => {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAssignments().then(setAssignments, (reason: unknown) =>
      setError(
        reason instanceof Error ? reason.message : "Unable to load your work."
      )
    );
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,33,71,0.45)] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="My work"
        className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-[0_24px_48px_rgba(3,33,71,0.24)]"
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 bg-white pb-2">
          <h2 className="font-display text-xl font-semibold text-[var(--navy-dark)]">
            My work
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close my work"
            className="rounded-full border border-transparent p-1.5 text-[var(--gray-text)] transition hover:border-[var(--stroke)]"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {!error && assignments === null && (
          <p className="text-sm text-[var(--gray-text)]">Loading your work...</p>
        )}
        {assignments?.length === 0 && (
          <p className="text-sm text-[var(--gray-text)]">
            Nothing is assigned to you yet.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {assignments?.map((assignment) => (
            <li key={assignment.card_id}>
              <button
                type="button"
                onClick={() =>
                  onOpenCard(assignment.board_id, assignment.card_id)
                }
                className="flex w-full flex-col gap-1 rounded-xl border border-[var(--stroke)] px-3 py-2 text-left transition hover:border-[var(--primary-blue)]"
              >
                <span className="font-semibold text-[var(--navy-dark)]">
                  {assignment.title}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--gray-text)]">
                  <span>
                    {assignment.board_name} / {assignment.column_title}
                  </span>
                  <span className="uppercase tracking-[0.1em]">
                    {assignment.priority}
                  </span>
                  {assignment.dueDate && (
                    <span
                      className={clsx(
                        "inline-flex items-center gap-1.5",
                        isOverdue(assignment.dueDate) &&
                          "font-semibold text-red-700"
                      )}
                    >
                      <CalendarDays aria-hidden className="h-3.5 w-3.5" />
                      {assignment.dueDate}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
