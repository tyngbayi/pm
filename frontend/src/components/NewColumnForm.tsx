import { Check, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

type NewColumnFormProps = {
  disabled: boolean;
  onAdd: (title: string) => Promise<boolean>;
};

export const NewColumnForm = ({ disabled, onAdd }: NewColumnFormProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !(await onAdd(trimmed))) {
      return;
    }
    setTitle("");
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        aria-label="Add a column"
        className="flex min-h-[420px] w-[72px] min-w-[72px] items-center justify-center rounded-3xl border border-dashed border-[var(--stroke)] text-[var(--primary-blue)] transition hover:border-[var(--primary-blue)] disabled:opacity-40"
      >
        <Plus aria-hidden className="h-5 w-5" />
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-h-[420px] w-[280px] min-w-[280px] flex-col gap-3 rounded-3xl border border-dashed border-[var(--stroke)] p-4"
    >
      <input
        autoFocus
        required
        maxLength={80}
        value={title}
        disabled={disabled}
        onChange={(event) => setTitle(event.target.value)}
        aria-label="New column title"
        placeholder="Column title"
        className="w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={disabled}
          aria-label="Add column"
          className="rounded-full bg-[var(--secondary-purple)] p-2 text-white transition hover:brightness-110 disabled:opacity-40"
        >
          <Check aria-hidden className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setIsOpen(false);
            setTitle("");
          }}
          aria-label="Cancel"
          className="rounded-full border border-[var(--stroke)] p-2 text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
};
