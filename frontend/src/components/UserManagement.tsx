"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import {
  createUser,
  deleteUser,
  getCurrentUser,
  getUsers,
  updateUser,
  type User,
  type UserRole,
} from "@/lib/api";

const fieldClassName =
  "w-full rounded-xl border border-[var(--stroke)] px-4 py-2.5 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]";
const labelClassName =
  "mb-2 block text-sm font-semibold text-[var(--navy-dark)]";

const byDisplayName = (first: User, second: User) =>
  first.display_name.localeCompare(second.display_name);

const describe = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const UserManagement = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const [user, accounts] = await Promise.all([getCurrentUser(), getUsers()]);
      setCurrentUser(user);
      setUsers(accounts);
    } catch (error) {
      setError(describe(error, "Unable to load accounts."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runMutation = async (request: () => Promise<unknown>) => {
    if (isBusy) {
      return;
    }
    setError(null);
    setIsBusy(true);
    try {
      await request();
      setUsers(await getUsers());
    } catch (error) {
      setError(describe(error, "Unable to save the change."));
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runMutation(async () => {
      await createUser(username, password, displayName, role);
      setUsername("");
      setDisplayName("");
      setPassword("");
      setRole("member");
    });
  };

  if (isLoading) {
    return (
      <main className="p-8">
        <p role="status">Loading accounts...</p>
      </main>
    );
  }

  if (!users) {
    return (
      <main className="p-8">
        <p role="alert">{error ?? "Unable to load accounts."}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
            Administration
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-[var(--navy-dark)]">
            Accounts
          </h1>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--stroke)] px-5 py-2.5 text-sm font-semibold text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)]"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" />
          Back to board
        </Link>
      </header>

      {error && (
        <p role="alert" className="mt-6 text-sm text-red-700">
          {error}
        </p>
      )}

      <table className="mt-8 w-full border-separate border-spacing-y-2 text-left text-sm">
        <thead className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--gray-text)]">
          <tr>
            <th scope="col" className="px-4 py-2 font-semibold">
              Name
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              Username
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              Role
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              Created
            </th>
            <th scope="col" className="px-4 py-2 font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {[...users].sort(byDisplayName).map((user) => (
            <tr key={user.id} className="bg-white shadow-[var(--shadow)]">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-[var(--navy-dark)]">
                {user.display_name || user.username}
              </td>
              <td className="px-4 py-3 text-[var(--gray-text)]">
                {user.username}
              </td>
              <td className="px-4 py-3">
                <select
                  aria-label={`Role for ${user.username}`}
                  value={user.role}
                  disabled={isBusy}
                  onChange={(event) =>
                    void runMutation(() =>
                      updateUser(user.id, {
                        role: event.target.value as UserRole,
                      })
                    )
                  }
                  className={fieldClassName}
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </select>
              </td>
              <td className="px-4 py-3 text-[var(--gray-text)]">
                {user.created_at.slice(0, 10)}
              </td>
              <td className="rounded-r-xl px-4 py-3 text-right">
                <button
                  type="button"
                  aria-label={`Delete ${user.username}`}
                  disabled={isBusy || user.id === currentUser?.id}
                  onClick={() => void runMutation(() => deleteUser(user.id))}
                  className="rounded-full border border-[var(--stroke)] p-2 text-red-700 transition hover:border-red-700 disabled:opacity-40"
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-10 rounded-[28px] border border-[var(--stroke)] bg-white p-6 shadow-[var(--shadow)]">
        <h2 className="font-display text-xl font-semibold text-[var(--navy-dark)]">
          Add an account
        </h2>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={handleCreate}
        >
          <div>
            <label className={labelClassName} htmlFor="new-username">
              Username
            </label>
            <input
              id="new-username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className={fieldClassName}
            />
          </div>
          <div>
            <label className={labelClassName} htmlFor="new-display-name">
              Display name
            </label>
            <input
              id="new-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className={fieldClassName}
            />
          </div>
          <div>
            <label className={labelClassName} htmlFor="new-password">
              Password
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={fieldClassName}
            />
          </div>
          <div>
            <label className={labelClassName} htmlFor="new-role">
              Role
            </label>
            <select
              id="new-role"
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
              className={fieldClassName}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-full bg-[var(--secondary-purple)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60 sm:col-span-2 lg:col-span-1"
          >
            Create account
          </button>
        </form>
      </section>
    </main>
  );
};
