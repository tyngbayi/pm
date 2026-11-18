import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  addChecklistItem,
  deleteChecklistItem,
  getChecklist,
  setChecklistItemDone,
} from "@/lib/api";
import type { ChecklistItem } from "@/lib/kanban";

type CardChecklistProps = {
  cardId: string;
  /** Keeps the board's card badge in step without refetching the board. */
  onProgressChange: (done: number, total: number) => void;
};

const progressOf = (items: ChecklistItem[]): [number, number] => [
  items.filter((item) => item.done).length,
  items.length,
];

export const CardChecklist = ({
  cardId,
  onProgressChange,
}: CardChecklistProps) => {
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    getChecklist(cardId).then(setItems, () =>
      setError("The checklist could not be loaded.")
    );
  }, [cardId]);

  // Absolute counts rather than a delta: ticking an item changes only one of
  // the two numbers, and the component already holds the whole list.
  const apply = async (next: () => Promise<ChecklistItem[]>) => {
    setIsBusy(true);
    setError("");
    try {
      const updated = await next();
      setItems(updated);
      onProgressChange(...progressOf(updated));
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
    void apply(async () => {
      const added = await addChecklistItem(cardId, body);
      setDraft("");
      return [...(items ?? []), added];
    });
  };

  const toggle = (item: ChecklistItem) =>
    void apply(async () => {
      const updated = await setChecklistItemDone(item.id, !item.done);
      return (items ?? []).map((entry) =>
        entry.id === item.id ? updated : entry
      );
    });

  const remove = (item: ChecklistItem) =>
    void apply(async () => {
      await deleteChecklistItem(item.id);
      return (items ?? []).filter((entry) => entry.id !== item.id);
    });

  const [done, total] = progressOf(items ?? []);

  return (
    <section
      aria-label="Checklist"
      className="flex flex-col gap-3 border-t border-[var(--stroke)] pt-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
          Checklist
        </h3>
        {total > 0 && (
          <span className="text-xs font-semibold text-[var(--primary-blue)]">
            {done} of {total} done
          </span>
        )}
      </div>

      {items === null ? (
        <p className="text-sm text-[var(--gray-text)]">Loading checklist...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--gray-text)]">No checklist yet.</p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-2 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={isBusy}
                  onChange={() => toggle(item)}
                  className="h-4 w-4 shrink-0 accent-[var(--primary-blue)]"
                />
                <span
                  className={
                    item.done
                      ? "text-sm text-[var(--gray-text)] line-through"
                      : "text-sm text-[var(--navy-dark)]"
                  }
                >
                  {item.body}
                </span>
              </label>
              <button
                type="button"
                onClick={() => remove(item)}
                disabled={isBusy}
                aria-label={`Delete ${item.body}`}
                className="shrink-0 rounded-full border border-transparent p-1.5 text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-red-600"
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={draft}
          placeholder="Add a checklist item"
          aria-label="New checklist item"
          onChange={(event) => setDraft(event.target.value)}
          className="w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
        />
        <button
          type="submit"
          disabled={isBusy || !draft.trim()}
          className="shrink-0 rounded-full bg-[var(--primary-blue)] px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          Add item
        </button>
      </form>
    </section>
  );
};
