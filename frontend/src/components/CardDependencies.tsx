import { useEffect, useState } from "react";
import { CircleSlash, X } from "lucide-react";
import { addCardLink, deleteCardLink, getCardLinks } from "@/lib/api";
import type { Card, CardLink, CardLinks } from "@/lib/kanban";

type CardDependenciesProps = {
  cardId: string;
  /** Every card on the board, so the picker can offer the candidates. */
  boardCards: Card[];
  /** Keeps the board's blocked badge in step without refetching the board. */
  onBlockerCountChange: (count: number) => void;
};

const EMPTY: CardLinks = { blocked_by: [], blocks: [] };

export const CardDependencies = ({
  cardId,
  boardCards,
  onBlockerCountChange,
}: CardDependenciesProps) => {
  const [links, setLinks] = useState<CardLinks | null>(null);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    getCardLinks(cardId).then(setLinks, () =>
      setError("The dependencies could not be loaded.")
    );
  }, [cardId]);

  const apply = async (next: () => Promise<CardLinks>) => {
    setIsBusy(true);
    setError("");
    try {
      const updated = await next();
      setLinks(updated);
      onBlockerCountChange(updated.blocked_by.length);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Something went wrong."
      );
    } finally {
      setIsBusy(false);
    }
  };

  const add = (blockerId: string) =>
    void apply(async () => {
      const added = await addCardLink(cardId, blockerId);
      const current = links ?? EMPTY;
      return { ...current, blocked_by: [...current.blocked_by, added] };
    });

  const remove = (link: CardLink) =>
    void apply(async () => {
      await deleteCardLink(link.id);
      const current = links ?? EMPTY;
      return {
        ...current,
        blocked_by: current.blocked_by.filter((entry) => entry.id !== link.id),
      };
    });

  const blockedBy = links?.blocked_by ?? [];
  const blocks = links?.blocks ?? [];
  // A card already in either list, and the card itself, cannot be added: the
  // API refuses both, and offering them would only produce an error.
  const taken = new Set([
    cardId,
    ...blockedBy.map((link) => link.card_id),
    ...blocks.map((link) => link.card_id),
  ]);
  const candidates = boardCards.filter((card) => !taken.has(card.id));

  return (
    <section
      aria-label="Dependencies"
      className="flex flex-col gap-3 border-t border-[var(--stroke)] pt-4"
    >
      <h3 className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
        Dependencies
      </h3>

      {links === null ? (
        <p className="text-sm text-[var(--gray-text)]">
          Loading dependencies...
        </p>
      ) : (
        <>
          {blockedBy.length === 0 ? (
            <p className="text-sm text-[var(--gray-text)]">
              Nothing is blocking this card.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {blockedBy.map((link) => (
                <li key={link.id} className="flex items-center gap-2">
                  <CircleSlash
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 text-red-700"
                  />
                  <span className="min-w-0 flex-1 text-sm text-[var(--navy-dark)]">
                    {link.title}
                    <span className="text-[var(--gray-text)]">
                      {" "}
                      &middot; {link.column_title}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(link)}
                    disabled={isBusy}
                    aria-label={`Stop ${link.title} blocking this card`}
                    className="shrink-0 rounded-full border border-transparent p-1.5 text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-red-600"
                  >
                    <X aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {blocks.length > 0 && (
            <p className="text-sm text-[var(--gray-text)]">
              This card is blocking{" "}
              {blocks.map((link) => link.title).join(", ")}.
            </p>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      {candidates.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
            Blocked by
          </span>
          <select
            value={choice}
            disabled={isBusy}
            onChange={(event) => {
              // Reset to the placeholder so the same card can be picked again
              // after a refusal, and so the control never claims a selection.
              setChoice("");
              add(event.target.value);
            }}
            className="w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
          >
            <option value="">Add a blocking card</option>
            {candidates.map((card) => (
              <option key={card.id} value={card.id}>
                {card.title}
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
};
