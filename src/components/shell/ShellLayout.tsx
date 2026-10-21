"use client";

import { useState, useEffect } from "react";
import { Rail } from "./Rail";
import { ListColumn, ChatItem } from "./ListColumn";
import { ConversationColumn, ActiveChat, Message } from "./ConversationColumn";
import { ApprovalSheet } from "./ApprovalSheet";
import { KnowledgeView } from "./KnowledgeView";

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
  const [conversations] = useState<ChatItem[]>(initialConversations);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const [activeView, setActiveView] = useState<"chats" | "knowledge">("chats");

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

      {activeView === "knowledge" ? (
        /* "What your agent knows" view */
        <KnowledgeView onBack={() => setActiveView("chats")} />
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
          <ConversationColumn chat={selectedChat} />
        </>
      )}

      {/* Hero ask-first approval sheet */}
      <ApprovalSheet />
    </div>
  );
}
