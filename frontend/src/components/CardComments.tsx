import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { addCardComment, deleteCardComment, getCardComments } from "@/lib/api";
import type { Comment } from "@/lib/kanban";

type CardCommentsProps = {
  cardId: string;
  currentUserId: string;
  /** Keeps the board's card badge in step without refetching the board. */
  onCountChange: (delta: number) => void;
};

export const CardComments = ({
  cardId,
  currentUserId,
  onCountChange,
}: CardCommentsProps) => {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    getCardComments(cardId).then(setComments, () =>
      setError("Comments could not be loaded.")
    );
  }, [cardId]);

  const run = async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Something went wrong."
      );
    } finally {
      setIsBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) {
      return;
    }
    void run(async () => {
      const added = await addCardComment(cardId, body);
      setComments((previous) => [...(previous ?? []), added]);
      setDraft("");
      onCountChange(1);
    });
  };

  const remove = (commentId: string) =>
    void run(async () => {
      await deleteCardComment(commentId);
      setComments((previous) =>
        (previous ?? []).filter((entry) => entry.id !== commentId)
      );
      onCountChange(-1);
    });

  return (
    <section
      aria-label="Comments"
      className="flex flex-col gap-3 border-t border-[var(--stroke)] pt-4"
    >
      <h3 className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
        Comments
      </h3>

      {comments === null ? (
        <p className="text-sm text-[var(--gray-text)]">Loading comments...</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-[var(--gray-text)]">No comments yet.</p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-3 overflow-y-auto">
          {comments.map((comment) => (
            <li key={comment.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[var(--navy-dark)]">
                  {comment.author_name}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--gray-text)]">
                  {comment.body}
                </p>
              </div>
              {comment.author_id === currentUserId && (
                <button
                  type="button"
                  onClick={() => remove(comment.id)}
                  disabled={isBusy}
                  aria-label={`Delete comment by ${comment.author_name}`}
                  className="shrink-0 rounded-full border border-transparent p-1.5 text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-red-600"
                >
                  <Trash2 aria-hidden className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      <form onSubmit={submit} className="flex flex-col gap-2">
        <textarea
          value={draft}
          rows={2}
          placeholder="Leave a comment"
          aria-label="New comment"
          onChange={(event) => setDraft(event.target.value)}
          className="w-full resize-none rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
        />
        <button
          type="submit"
          disabled={isBusy || !draft.trim()}
          className="self-end rounded-full bg-[var(--primary-blue)] px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          Add comment
        </button>
      </form>
    </section>
  );
};
