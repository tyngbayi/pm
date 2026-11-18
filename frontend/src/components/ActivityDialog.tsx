import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getBoardActivity } from "@/lib/api";
import type { Activity } from "@/lib/kanban";

type ActivityDialogProps = {
  boardId: string;
  onClose: () => void;
};

/** The API stores a UTC ISO timestamp; minutes are enough to read a history. */
const when = (createdAt: string) => createdAt.slice(0, 16).replace("T", " ");

export const ActivityDialog = ({ boardId, onClose }: ActivityDialogProps) => {
  const [entries, setEntries] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBoardActivity(boardId).then(setEntries, (reason: unknown) =>
      setError(
        reason instanceof Error ? reason.message : "Unable to load the history."
      )
    );
  }, [boardId]);

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
        aria-label="Board history"
        className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-[0_24px_48px_rgba(3,33,71,0.24)]"
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 bg-white pb-2">
          <h2 className="font-display text-xl font-semibold text-[var(--navy-dark)]">
            Board history
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close board history"
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
        {!error && entries === null && (
          <p className="text-sm text-[var(--gray-text)]">
            Loading the history...
          </p>
        )}
        {entries?.length === 0 && (
          <p className="text-sm text-[var(--gray-text)]">
            Nothing has changed on this board yet.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {entries?.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-1 rounded-xl border border-[var(--stroke)] px-3 py-2"
            >
              <span className="text-sm text-[var(--navy-dark)]">
                {entry.summary}
              </span>
              <span className="text-xs text-[var(--gray-text)]">
                {entry.author_name} &middot; {when(entry.created_at)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
