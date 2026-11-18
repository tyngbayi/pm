import { Check, Pencil, Plus, Share2, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { BoardSummary } from "@/lib/api";

type Draft = { mode: "create" | "rename"; name: string };

type BoardSwitcherProps = {
  boards: BoardSummary[];
  activeBoardId: string;
  disabled: boolean;
  onSelect: (boardId: string) => void;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => void;
  onShare: () => void;
};

const iconButton =
  "rounded-full border border-[var(--stroke)] p-2 text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)] disabled:opacity-40";

export const BoardSwitcher = ({
  boards,
  activeBoardId,
  disabled,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onShare,
}: BoardSwitcherProps) => {
  const [draft, setDraft] = useState<Draft | null>(null);
  const activeBoard = boards.find((board) => board.id === activeBoardId);
  // Renaming, deleting, and sharing belong to the owner; the API refuses the
  // rest with a 404, so hiding them keeps the controls honest.
  const owned = activeBoard?.owned ?? false;
  const ownedBoardCount = boards.filter((board) => board.owned).length;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft?.name.trim();
    if (!draft || !name) {
      return;
    }
    const saved =
      draft.mode === "create" ? await onCreate(name) : await onRename(name);
    if (saved) {
      setDraft(null);
    }
  };

  if (draft) {
    return (
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          autoFocus
          required
          maxLength={80}
          value={draft.name}
          disabled={disabled}
          aria-label={draft.mode === "create" ? "New board name" : "Board name"}
          placeholder="Board name"
          onChange={(event) =>
            setDraft({ ...draft, name: event.target.value })
          }
          className="w-44 rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-medium text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
        />
        <button
          type="submit"
          disabled={disabled}
          aria-label={draft.mode === "create" ? "Create board" : "Save board name"}
          className="rounded-full bg-[var(--secondary-purple)] p-2 text-white transition hover:brightness-110 disabled:opacity-40"
        >
          <Check aria-hidden className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setDraft(null)}
          aria-label="Cancel"
          className={iconButton}
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Board"
        value={activeBoardId}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
        className="rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-semibold text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
      >
        {boards.map((board) => (
          <option key={board.id} value={board.id}>
            {board.owned ? board.name : `${board.name} (shared)`}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setDraft({ mode: "create", name: "" })}
        aria-label="New board"
        className={iconButton}
      >
        <Plus aria-hidden className="h-4 w-4" />
      </button>
      {owned && (
        <>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              setDraft({ mode: "rename", name: activeBoard?.name ?? "" })
            }
            aria-label="Rename board"
            className={iconButton}
          >
            <Pencil aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onShare}
            aria-label="Share board"
            className={iconButton}
          >
            <Share2 aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disabled || ownedBoardCount < 2}
            onClick={onDelete}
            aria-label="Delete board"
            className={`${iconButton} text-red-700 hover:border-red-700 hover:text-red-700`}
          >
            <Trash2 aria-hidden className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
};
