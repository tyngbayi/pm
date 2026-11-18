import { Search, X } from "lucide-react";
import { EMPTY_FILTER, isFiltering, type BoardFilter, type Member } from "@/lib/kanban";

type BoardFiltersProps = {
  filter: BoardFilter;
  labels: string[];
  members: Member[];
  matchCount: number;
  onChange: (filter: BoardFilter) => void;
};

const control =
  "rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]";

export const BoardFilters = ({
  filter,
  labels,
  members,
  matchCount,
  onChange,
}: BoardFiltersProps) => {
  const active = isFiltering(filter);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gray-text)]"
        />
        <input
          type="search"
          value={filter.text}
          aria-label="Search cards"
          placeholder="Search cards"
          onChange={(event) => onChange({ ...filter, text: event.target.value })}
          className={`${control} w-56 pl-9`}
        />
      </div>

      <select
        value={filter.assigneeId}
        aria-label="Filter by assignee"
        onChange={(event) =>
          onChange({ ...filter, assigneeId: event.target.value })
        }
        className={control}
      >
        <option value="">Any assignee</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.display_name}
          </option>
        ))}
      </select>

      <select
        value={filter.label}
        aria-label="Filter by label"
        onChange={(event) => onChange({ ...filter, label: event.target.value })}
        className={control}
      >
        <option value="">Any label</option>
        {labels.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>

      {active && (
        <>
          <p role="status" className="text-sm text-[var(--gray-text)]">
            {matchCount} matching {matchCount === 1 ? "card" : "cards"}. Drag is
            paused while filtering.
          </p>
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTER)}
            aria-label="Clear filters"
            className="rounded-full border border-[var(--stroke)] p-2 text-[var(--gray-text)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
};
