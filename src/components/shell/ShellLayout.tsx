"use client";

import { useState, useEffect } from "react";
import { Rail } from "./Rail";
import { ListColumn, ChatItem } from "./ListColumn";
import { ConversationColumn, ActiveChat, Message } from "./ConversationColumn";
import { ApprovalSheet } from "./ApprovalSheet";
import { GuardrailsView } from "./GuardrailsView";
import { ContactsView } from "./ContactsView";

interface ShellLayoutProps {
  ownerEmail: string;
  agent: {
    id: string;
    handle: string;
    status: string;
    isOnline?: boolean;
  };
  initialConversations?: ChatItem[];
}

export function ShellLayout({
  ownerEmail,
  agent,
  initialConversations = [],
}: ShellLayoutProps) {
  const [conversations, setConversations] = useState<ChatItem[]>(initialConversations);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [activeView, setActiveView] = useState<"chats" | "contacts" | "guardrails" | "knowledge">("chats");

  function handleOpenConversation(targetHandle: string) {
    const clean = targetHandle.replace(/^@/, "").toLowerCase();
    const existing = conversations.find(
      (c) => c.handle.toLowerCase() === clean,
    );
    if (existing) {
      setSelectedChatId(existing.id);
    }
    setActiveView("chats");
  }

  async function handleAcceptRequest(id: string) {
    try {
      const res = await fetch(`/api/conversations/${id}/accept`, { method: "POST" });
      if (res.ok) {
        setConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, is_request: false } : c)),
        );
      }
    } catch {}
  }

  function handleIgnoreRequest(id: string) {
    if (selectedChatId === id) {
      setSelectedChatId(null);
    }
  }

  async function handleRevokeGuest(inviteId: string) {
    try {
      const res = await fetch(`/api/guests/${inviteId}/revoke`, { method: "POST" });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.guest_invite_id !== inviteId));
        if (rawChat?.guest_invite_id === inviteId) {
          setSelectedChatId(null);
        }
      }
    } catch {}
  }

  useEffect(() => {
    if (!selectedChatId) return;
    let isCancelled = false;

    fetch(`/api/conversations/${selectedChatId}/messages`)
      .then((res) => res.json())
      .then((data) => {
        if (!isCancelled && data.ok && data.messages) {
          setMessagesByChat((prev) => ({
            ...prev,
            [selectedChatId]: data.messages,
          }));
        }
      })
      .catch(() => {});

    return () => {
      isCancelled = true;
    };
  }, [selectedChatId]);

  const rawChat = selectedChatId
    ? conversations.find((c) => c.id === selectedChatId) ?? null
    : null;

  const selectedChat: ActiveChat | null = rawChat
    ? {
        ...rawChat,
        presence: rawChat.presence === "online" ? "online" : "offline — messages will be delivered when it reconnects",
        messages: messagesByChat[rawChat.id] || [],
      }
    : null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-q-bg text-q-text">
      {/* 1) RAIL: 60px wide, panel colour, hairline right border */}
      <Rail
        ownerEmail={ownerEmail}
        activeView={activeView}
        onSelectView={(v) => setActiveView(v)}
      />

      {activeView === "contacts" ? (
        /* Contacts view */
        <ContactsView
          onBack={() => setActiveView("chats")}
          onOpenConversation={handleOpenConversation}
        />
      ) : activeView === "guardrails" || activeView === "knowledge" ? (
        /* Guardrails view */
        <GuardrailsView onBack={() => setActiveView("chats")} />
      ) : (
        <>
          {/* 2) LIST COLUMN: 340px (min 320, max 380), bg colour */}
          <ListColumn
            agent={agent}
            conversations={conversations}
            selectedChatId={selectedChatId}
            onSelectChat={(id) => setSelectedChatId(id)}
          />

          {/* 3) CONVERSATION COLUMN: flex-1 */}
          <ConversationColumn
            chat={selectedChat}
            onBack={() => setSelectedChatId(null)}
            onAcceptRequest={handleAcceptRequest}
            onIgnoreRequest={handleIgnoreRequest}
            onRevokeGuest={handleRevokeGuest}
          />
        </>
      )}

      {/* Hero ask-first approval sheet */}
      <ApprovalSheet />
    </div>
  );
}
