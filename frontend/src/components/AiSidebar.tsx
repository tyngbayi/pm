"use client";

import { Send, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { chatWithAi, type AiChatMessage } from "@/lib/api";
import type { BoardData } from "@/lib/kanban";

type AiSidebarProps = {
  isOpen: boolean;
  boardId: string;
  isBoardSaving: boolean;
  onClose: () => void;
  onBoardUpdate: (board: BoardData) => void;
  onBusyChange: (isBusy: boolean) => void;
};

export const AiSidebar = ({
  isOpen,
  boardId,
  isBoardSaving,
  onClose,
  onBoardUpdate,
  onBusyChange,
}: AiSidebarProps) => {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSending || isBoardSaving) {
      return;
    }

    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setDraft("");
    setError(null);
    setIsSending(true);
    onBusyChange(true);

    try {
      const response = await chatWithAi(boardId, nextMessages);
      setMessages([
        ...nextMessages,
        { role: "assistant", content: response.message },
      ]);
      if (response.board_update) {
        onBoardUpdate(response.board_update);
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to get an AI response."
      );
    } finally {
      setIsSending(false);
      onBusyChange(false);
    }
  };

  return (
    <aside
      id="ai-sidebar"
      aria-labelledby="ai-sidebar-title"
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={`w-full shrink-0 overflow-hidden transition-[max-height,width,opacity] duration-300 ease-in-out ${
        isOpen
          ? "max-h-[calc(100vh-4rem)] opacity-100 xl:w-[380px]"
          : "max-h-0 opacity-0 xl:w-0"
      }`}
    >
      <div className="flex h-[calc(100vh-4rem)] min-h-[420px] w-full flex-col overflow-hidden rounded-[28px] border border-[var(--stroke)] bg-white/90 shadow-[var(--shadow)] backdrop-blur xl:sticky xl:top-8">
        <header className="flex items-center justify-between border-b border-[var(--stroke)] px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
              Project assistant
            </p>
            <h2
              id="ai-sidebar-title"
              className="mt-1 font-display text-xl font-semibold text-[var(--navy-dark)]"
            >
              AI chat
            </h2>
            <p className="mt-1 text-xs text-[var(--gray-text)]">
              AI requests may incur charges.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--stroke)] p-2 text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)]"
            aria-label="Close AI assistant"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </header>

        <div
          className="flex-1 space-y-4 overflow-y-auto p-5"
          aria-label="Conversation"
          aria-live="polite"
          role="log"
        >
          {messages.length === 0 && (
            <p className="text-sm leading-6 text-[var(--gray-text)]">
              Ask a question about your board or request card changes.
            </p>
          )}
          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              data-testid={
                message.role === "assistant" ? "assistant-message" : undefined
              }
              className={`rounded-2xl px-4 py-3 ${
                message.role === "user"
                  ? "ml-6 bg-[var(--navy-dark)] text-white"
                  : "mr-6 bg-[var(--surface)] text-[var(--navy-dark)]"
              }`}
            >
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">
                {message.role === "user" ? "You" : "Assistant"}
              </p>
              <p className="whitespace-pre-wrap text-sm leading-6">
                {message.content}
              </p>
            </article>
          ))}
          {isSending && (
            <p role="status" className="text-sm text-[var(--gray-text)]">
              Thinking...
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-3 border-t border-[var(--stroke)] p-5"
        >
          <label
            htmlFor="ai-message"
            className="text-sm font-semibold text-[var(--navy-dark)]"
          >
            Message
          </label>
          <textarea
            id="ai-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about your project..."
            rows={3}
            disabled={isSending || isBoardSaving}
            className="w-full resize-none rounded-2xl border border-[var(--stroke)] bg-white px-4 py-3 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)] disabled:opacity-60"
            aria-label="Message the AI"
          />
          <button
            type="submit"
            disabled={isSending || isBoardSaving || !draft.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send aria-hidden className="h-4 w-4" />
            {isSending ? "Sending..." : "Send"}
          </button>
        </form>
      </div>
    </aside>
  );
};
