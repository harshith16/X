"use client";

import { useState, useEffect, useRef } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

interface MessageItem {
  id: string;
  seq: number;
  body: string;
  status: string;
  created_at: string;
  sender_owner_id: string | null;
  sender_agent_id: string | null;
}

interface GuestChatViewProps {
  conversationId: string;
  agentHandle: string;
  guestUserId: string;
}

export function GuestChatView({
  conversationId,
  agentHandle,
  guestUserId,
}: GuestChatViewProps) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isRevoked, setIsRevoked] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll for messages
  useEffect(() => {
    let cancelled = false;

    async function fetchMessages() {
      try {
        const res = await fetch(`/api/guests/conversations/${conversationId}/messages`);
        if (res.status === 403) {
          setIsRevoked(true);
          return;
        }
        if (!res.ok) return;

        const data = await res.json();
        if (!cancelled && data.messages) {
          setMessages(data.messages);
        }
      } catch {}
    }

    fetchMessages();
    const timer = setInterval(fetchMessages, 2500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || sending || isRevoked) return;

    setSending(true);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/guests/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 403) {
          setIsRevoked(true);
          setErrorMsg(data.error?.message ?? "This conversation has been closed by the owner.");
        } else {
          setErrorMsg(data.error?.message ?? "Failed to send message.");
        }
        setSending(false);
        return;
      }

      setInputText("");

      // Optimistic append
      const optimisticMsg: MessageItem = {
        id: data.message_id || `temp_${Date.now()}`,
        seq: data.seq || messages.length + 1,
        body: text,
        status: data.status || "queued",
        created_at: new Date().toISOString(),
        sender_owner_id: guestUserId,
        sender_agent_id: null,
      };

      setMessages((prev) => [...prev, optimisticMsg]);
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-q-bg text-q-text">
      {/* Top Header */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-q-hairline bg-q-panel px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-q-accent/15 text-sm font-semibold text-q-accent">
            @{agentHandle.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h1 className="text-sm font-semibold text-q-text">
              You&apos;re chatting with @{agentHandle}&apos;s agent
            </h1>
            <p className="text-xs text-q-muted">
              Guest conversation • Responses are screened by the owner
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-q-subtle px-2.5 py-1 text-xs font-medium text-q-muted">
            Guest
          </span>
          <ThemeToggle />
        </div>
      </header>

      {/* Revoked Banner */}
      {isRevoked && (
        <div className="border-b border-q-hairline bg-q-subtle px-4 py-2.5 text-center text-xs text-q-danger">
          This conversation has been closed by the owner. Sending is disabled.
        </div>
      )}

      {/* Messages Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 sm:p-6">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <p className="text-xs text-q-muted">
              Send a message to start chatting with @{agentHandle}&apos;s agent.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isGuestSender = m.sender_owner_id === guestUserId;
            return (
              <div
                key={m.id || m.seq}
                className={`flex flex-col ${isGuestSender ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[80%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    isGuestSender
                      ? "bg-q-accent text-white rounded-br-sm"
                      : "bg-q-panel border border-q-hairline text-q-text rounded-bl-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                </div>
                <span className="mt-1 px-1 text-[10px] text-q-muted">
                  {new Date(m.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Send Input Area */}
      <footer className="border-t border-q-hairline bg-q-panel p-4">
        {errorMsg && (
          <p className="mb-2 text-xs text-q-danger text-center">{errorMsg}</p>
        )}
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            id="guest-message-input"
            type="text"
            disabled={isRevoked || sending}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              isRevoked
                ? "This conversation is closed"
                : `Message @${agentHandle}'s agent...`
            }
            className="flex-1 rounded-xl border border-q-hairline bg-q-bg px-4 py-2.5 text-sm text-q-text placeholder-q-muted outline-none transition-all focus:border-q-accent focus:ring-2 focus:ring-q-accent/25 disabled:opacity-50"
          />
          <button
            id="guest-send-btn"
            type="submit"
            disabled={!inputText.trim() || sending || isRevoked}
            className="apple-btn flex h-10 items-center justify-center rounded-xl bg-q-accent px-4 text-sm font-medium text-white transition-all hover:bg-q-accent-hover active:scale-[0.97] disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      </footer>
    </div>
  );
}
