import { useEffect, useState } from "react";
import { UserMinus, UserPlus, X } from "lucide-react";
import type { Member } from "@/lib/kanban";

type ShareDialogProps = {
  boardName: string;
  ownerId: string;
  members: Member[];
  disabled: boolean;
  onAdd: (username: string) => Promise<boolean>;
  onRemove: (memberId: string) => Promise<boolean>;
  onClose: () => void;
};

const field =
  "w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]";

export const ShareDialog = ({
  boardName,
  ownerId,
  members,
  disabled,
  onAdd,
  onRemove,
  onClose,
}: ShareDialogProps) => {
  const [username, setUsername] = useState("");

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
    const trimmed = username.trim();
    if (trimmed && (await onAdd(trimmed))) {
      setUsername("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,33,71,0.45)] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${boardName}`}
        className="flex w-full max-w-md flex-col gap-4 rounded-3xl bg-white p-6 shadow-[0_24px_48px_rgba(3,33,71,0.24)]"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-[var(--navy-dark)]">
            Share {boardName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sharing"
            className="rounded-full border border-transparent p-1.5 text-[var(--gray-text)] transition hover:border-[var(--stroke)]"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(event) => void submit(event)} className="flex gap-2">
          <input
            value={username}
            required
            maxLength={40}
            aria-label="Username to share with"
            placeholder="Username"
            onChange={(event) => setUsername(event.target.value)}
            className={field}
          />
          <button
            type="submit"
            disabled={disabled}
            aria-label="Add member"
            className="rounded-full bg-[var(--secondary-purple)] p-2.5 text-white transition hover:brightness-110 disabled:opacity-60"
          >
            <UserPlus aria-hidden className="h-4 w-4" />
          </button>
        </form>

        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--stroke)] px-3 py-2 text-sm text-[var(--navy-dark)]"
            >
              <span>{member.display_name}</span>
              {member.id === ownerId ? (
                <span className="text-xs uppercase tracking-[0.2em] text-[var(--gray-text)]">
                  Owner
                </span>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void onRemove(member.id)}
                  aria-label={`Remove ${member.display_name}`}
                  className="rounded-full border border-[var(--stroke)] p-1.5 text-red-700 transition hover:border-red-700 disabled:opacity-40"
                >
                  <UserMinus aria-hidden className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
