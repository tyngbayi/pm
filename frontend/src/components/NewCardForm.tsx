import { Check, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

const initialFormState = { title: "", details: "" };

type NewCardFormProps = {
  disabled: boolean;
  onAdd: (title: string, details: string) => Promise<boolean>;
};

export const NewCardForm = ({ disabled, onAdd }: NewCardFormProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [formState, setFormState] = useState(initialFormState);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.title.trim()) {
      return;
    }
    const saved = await onAdd(formState.title.trim(), formState.details.trim());
    if (!saved) {
      return;
    }
    setFormState(initialFormState);
    setIsOpen(false);
  };

  return (
    <div className="mt-4">
      {isOpen ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            value={formState.title}
            disabled={disabled}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, title: event.target.value }))
            }
            placeholder="Card title"
            className="w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
            required
          />
          <textarea
            value={formState.details}
            disabled={disabled}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, details: event.target.value }))
            }
            placeholder="Details"
            rows={3}
            className="w-full resize-none rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--gray-text)] outline-none transition focus:border-[var(--primary-blue)]"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={disabled}
              aria-label="Add card"
              className="rounded-full bg-[var(--secondary-purple)] p-2 text-white transition hover:brightness-110"
            >
              <Check aria-hidden className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setIsOpen(false);
                setFormState(initialFormState);
              }}
              aria-label="Cancel"
              className="rounded-full border border-[var(--stroke)] p-2 text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen(true)}
          aria-label="Add a card"
          className="flex w-full items-center justify-center rounded-full border border-dashed border-[var(--stroke)] px-3 py-2 text-[var(--primary-blue)] transition hover:border-[var(--primary-blue)]"
        >
          <Plus aria-hidden className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
