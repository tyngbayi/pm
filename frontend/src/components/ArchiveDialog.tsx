import { useEffect, useState } from "react";
import { ArchiveRestore, X } from "lucide-react";
import { getBoardArchive, type ArchivedCard } from "@/lib/api";

type ArchiveDialogProps = {
  boardId: string;
  disabled: boolean;
  onRestore: (cardId: string) => Promise<boolean>;
  onClose: () => void;
};

/** The API stores a UTC ISO timestamp; minutes are enough to read an archive. */
const when = (archivedAt: string) => archivedAt.slice(0, 16).replace("T", " ");

export const ArchiveDialog = ({
  boardId,
  disabled,
  onRestore,
  onClose,
}: ArchiveDialogProps) => {
  const [cards, setCards] = useState<ArchivedCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBoardArchive(boardId).then(setCards, (reason: unknown) =>
      setError(
        reason instanceof Error ? reason.message : "Unable to load the archive."
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

  // The board behind the dialog is replaced by the restore response, so the
  // row only has to leave this list.
  const restore = async (cardId: string) => {
    if (await onRestore(cardId)) {
      setCards((previous) =>
        (previous ?? []).filter((card) => card.id !== cardId)
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,33,71,0.45)] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Archive"
        className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-3xl bg-white p-6 shadow-[0_24px_48px_rgba(3,33,71,0.24)]"
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 bg-white pb-2">
          <h2 className="font-display text-xl font-semibold text-[var(--navy-dark)]">
            Archive
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close archive"
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
        {!error && cards === null && (
          <p className="text-sm text-[var(--gray-text)]">
            Loading the archive...
          </p>
        )}
        {cards?.length === 0 && (
          <p className="text-sm text-[var(--gray-text)]">
            Nothing is archived on this board.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {cards?.map((card) => (
            <li
              key={card.id}
              className="flex items-center gap-3 rounded-xl border border-[var(--stroke)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--navy-dark)]">{card.title}</p>
                <p className="text-xs text-[var(--gray-text)]">
                  {card.column_title} &middot; {when(card.archived_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void restore(card.id)}
                disabled={disabled}
                aria-label={`Restore ${card.title}`}
                className="shrink-0 rounded-full border border-transparent p-1.5 text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--primary-blue)]"
              >
                <ArchiveRestore aria-hidden className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
