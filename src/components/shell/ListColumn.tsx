"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { initialsFromHandle, avatarBgClass, avatarColor } from "@/lib/avatar";
import { signOut } from "@/app/actions";

export interface ChatItem {
  id: string;
  handle: string;
  name?: string;
  presence: "online" | "waiting for its owner to approve" | "offline";
  lastMessagePreview?: string;
  lastMessageIsOwn?: boolean;
  lastMessageStatus?: "queued" | "delivered" | "read";
  lastMessageTime?: string;
  unreadCount?: number;
  is_request?: boolean;
  is_guest?: boolean;
  guest_invite_id?: string | null;
}

interface ListColumnProps {
  agent: {
    id: string;
    handle: string;
    status: string;
    isOnline?: boolean;
  };
  conversations?: ChatItem[];
  selectedChatId?: string | null;
  onSelectChat?: (id: string) => void;
  isLoading?: boolean;
}

export function ListColumn({
  agent,
  conversations = [],
  selectedChatId = null,
  onSelectChat,
  isLoading = false,
}: ListColumnProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "unread" | "online">("all");
  const [showRequests, setShowRequests] = useState(false);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invites, setInvites] = useState<any[]>([]);
  const [createdInviteLink, setCreatedInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  async function loadInvites() {
    try {
      const res = await fetch("/api/guests");
      const data = await res.json();
      if (data.items) {
        setInvites(data.items);
      }
    } catch {}
  }

  async function handleCreateInvite() {
    setIsCreatingInvite(true);
    setInviteError(null);
    setCreatedInviteLink(null);
    try {
      const res = await fetch("/api/guests", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error?.message || "Failed to create guest invite.");
      } else {
        setCreatedInviteLink(data.invite?.link || `${window.location.origin}/g/${data.invite?.token}`);
        await loadInvites();
      }
    } catch {
      setInviteError("Network error creating guest invite.");
    } finally {
      setIsCreatingInvite(false);
    }
  }

  async function handleRevokeInvite(id: string) {
    try {
      const res = await fetch(`/api/guests/${id}/revoke`, { method: "POST" });
      if (res.ok) {
        await loadInvites();
      }
    } catch {}
  }

  const requestCount = useMemo(
    () => conversations.filter((c) => Boolean(c.is_request)).length,
    [conversations],
  );

  // Close overflow menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setIsOverflowOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const agentInitials = initialsFromHandle(agent.handle);
  const agentBgClass = avatarBgClass(agent.handle);
  const isAgentActive = agent.status === "active";

  // Filter conversations live by name/handle, active chip, and request mode
  const filteredConversations = useMemo(() => {
    return conversations.filter((chat) => {
      // 1. Requests filter
      if (showRequests) {
        if (!chat.is_request) return false;
      } else {
        if (chat.is_request) return false;
      }

      // 2. Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesHandle = chat.handle.toLowerCase().includes(q);
        const matchesName = chat.name?.toLowerCase().includes(q);
        if (!matchesHandle && !matchesName) return false;
      }

      // 3. Chip filter (only for main chats)
      if (!showRequests) {
        if (activeFilter === "unread") {
          return (chat.unreadCount ?? 0) > 0;
        }
        if (activeFilter === "online") {
          return chat.presence === "online";
        }
      }
      return true;
    });
  }, [conversations, searchQuery, activeFilter, showRequests]);

  return (
    <aside
      id="chat-list-column"
      aria-label="Chats list"
      className="flex h-full w-[340px] min-w-[320px] max-w-[380px] shrink-0 flex-col border-r border-q-separator bg-q-bg z-10"
    >
      {/* ── Header row: "Qurelium" wordmark, 20px semibold; right side overflow menu ── */}
      <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-q-separator px-4">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-q-text">
          Qurelium
        </h1>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            id="create-guest-invite-btn"
            aria-label="Invite guest"
            title="Invite guest"
            onClick={() => {
              setShowInviteModal(true);
              setCreatedInviteLink(null);
              setInviteError(null);
              loadInvites();
            }}
            className="apple-btn flex h-7 items-center gap-1.5 rounded-full bg-q-secondary-elevated px-2.5 text-xs font-medium text-q-text hover:bg-q-secondary-elevated/80 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
            <span>Invite guest</span>
          </button>

          <div ref={overflowRef} className="relative">
            <button
              type="button"
              id="list-overflow-btn"
              aria-label="Menu"
              title="Menu"
              onClick={() => setIsOverflowOpen((prev) => !prev)}
              className="apple-btn flex h-8 w-8 items-center justify-center rounded-full text-q-text-2 hover:bg-q-secondary-elevated hover:text-q-text transition-colors active:scale-[0.97]"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>

            {/* Overflow dropdown containing Sign out */}
            {isOverflowOpen && (
              <div
                id="list-overflow-menu"
                className="absolute right-0 top-10 z-50 w-40 rounded-xl border border-q-separator bg-q-elevated p-1 shadow-lg backdrop-blur-md"
              >
                <form action={signOut}>
                  <button
                    type="submit"
                    className="apple-btn flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-q-danger hover:bg-q-secondary-elevated transition-colors"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Guest invite modal */}
      {showInviteModal && (
        <div
          id="guest-invite-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-q-separator bg-q-elevated p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-q-text">Guest Links</h3>
                <p className="text-xs text-q-text-2 mt-0.5">
                  Invite someone to chat with your agent. Max 3 active guests free.
                </p>
              </div>
              <button
                type="button"
                id="close-guest-modal-btn"
                onClick={() => setShowInviteModal(false)}
                className="apple-btn flex h-7 w-7 items-center justify-center rounded-full text-q-text-2 hover:bg-q-secondary-elevated hover:text-q-text"
              >
                ✕
              </button>
            </div>

            {inviteError && (
              <div
                id="guest-limit-error"
                className="rounded-xl border border-q-danger/30 bg-q-danger/10 p-3 text-xs text-q-danger"
              >
                {inviteError}
              </div>
            )}

            {createdInviteLink && (
              <div className="space-y-2 rounded-xl border border-q-separator bg-q-secondary-elevated p-3">
                <p className="text-xs font-medium text-q-text">One-time invite link (expires in 7 days):</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    id="guest-invite-link"
                    readOnly
                    value={createdInviteLink}
                    className="w-full rounded-lg border border-q-separator bg-q-bg px-2.5 py-1.5 text-xs text-q-text select-all"
                  />
                  <button
                    type="button"
                    id="copy-guest-link-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(createdInviteLink);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="apple-btn shrink-0 rounded-lg bg-q-accent px-3 py-1.5 text-xs font-medium text-white shadow-xs"
                  >
                    {copiedLink ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-q-text-3">
                {invites.filter((i) => i.status === "active" || i.status === "pending").length} of 3 active invites used
              </span>
              <button
                type="button"
                id="generate-guest-link-btn"
                disabled={isCreatingInvite}
                onClick={handleCreateInvite}
                className="apple-btn rounded-xl bg-q-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-q-accent-hover active:scale-[0.98] disabled:opacity-50"
              >
                {isCreatingInvite ? "Creating..." : "Create guest link"}
              </button>
            </div>

            {invites.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-q-separator">
                <p className="text-xs font-medium text-q-text-2">Invites</p>
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1 divide-y divide-q-separator/40">
                  {invites.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between py-1.5 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`inline-block h-2 w-2 rounded-full ${
                          inv.status === "active" ? "bg-q-online" : inv.status === "pending" ? "bg-q-waiting" : "bg-q-offline"
                        }`} />
                        <span className="truncate text-q-text capitalize">{inv.status}</span>
                        <span className="text-[11px] text-q-text-3">
                          {new Date(inv.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                        </span>
                      </div>
                      {(inv.status === "active" || inv.status === "pending") && (
                        <button
                          type="button"
                          id={`revoke-invite-${inv.id}`}
                          onClick={() => handleRevokeInvite(inv.id)}
                          className="apple-btn rounded-md px-2 py-0.5 text-[11px] font-medium text-q-danger hover:bg-q-danger/10"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Search field: fully rounded, search-fill background, placeholder "Search" ── */}
      <div className="px-3.5 pt-3 pb-2">
        <div className="flex items-center gap-2.5 rounded-full bg-q-search-fill px-3.5 py-1.5 transition-colors focus-within:ring-2 focus-within:ring-q-accent/25">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-q-text-3"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            id="chats-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-[14px] text-q-text placeholder:text-q-text-3 outline-none"
            aria-label="Search"
          />
        </div>
      </div>

      {/* ── Chips row: All / Unread / Online — real filters, active chip uses chip-active tokens ── */}
      <div className="flex items-center gap-2 px-3.5 pb-2.5 shrink-0" role="tablist" aria-label="Chat filters">
        <button
          type="button"
          role="tab"
          aria-selected={activeFilter === "all"}
          onClick={() => setActiveFilter("all")}
          className={`apple-btn rounded-full px-3 py-1 text-xs transition-colors ${
            activeFilter === "all"
              ? "bg-q-chip-active text-q-accent font-medium"
              : "bg-transparent text-q-text-2 hover:bg-q-search-fill hover:text-q-text"
          }`}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeFilter === "unread"}
          onClick={() => setActiveFilter("unread")}
          className={`apple-btn rounded-full px-3 py-1 text-xs transition-colors ${
            activeFilter === "unread"
              ? "bg-q-chip-active text-q-accent font-medium"
              : "bg-transparent text-q-text-2 hover:bg-q-search-fill hover:text-q-text"
          }`}
        >
          Unread
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeFilter === "online"}
          onClick={() => setActiveFilter("online")}
          className={`apple-btn rounded-full px-3 py-1 text-xs transition-colors ${
            activeFilter === "online"
              ? "bg-q-chip-active text-q-accent font-medium"
              : "bg-transparent text-q-text-2 hover:bg-q-search-fill hover:text-q-text"
          }`}
        >
          Online
        </button>
      </div>

      {/* ── PINNED own-agent row: small pin glyph, 44px initials avatar with status dot, name "@handle · You", second line = presence text ── */}
      {!isAgentActive ? (
        /* Agent claim pending post step */
        <Link
          href="/claim"
          id="pinned-agent-row"
          className="flex items-center gap-3 bg-q-secondary-elevated px-3.5 py-3 border-b border-q-separator transition-colors hover:opacity-95"
        >
          <div className="relative shrink-0">
            <div
              style={{ backgroundColor: avatarColor(agent.handle) }}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full leading-none text-center select-none font-bold text-sm text-white ${agentBgClass}`}
            >
              {agentInitials}
            </div>
            {/* Status dot at bottom right */}
            <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-q-secondary-elevated bg-q-offline" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <PinIcon />
              <p className="truncate text-[15px] font-medium text-q-text">
                {`@${agent.handle} · You`}
              </p>
            </div>
            <p className="mt-0.5 truncate text-[13px] font-medium text-q-accent">
              Finish claim on X
            </p>
          </div>
        </Link>
      ) : (
        /* Pinned active own-agent row */
        <div
          id="pinned-agent-row"
          className="flex items-center gap-3 bg-q-secondary-elevated px-3.5 py-3 border-b border-q-separator"
        >
          <div className="relative shrink-0">
            <div
              style={{ backgroundColor: avatarColor(agent.handle) }}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full leading-none text-center select-none font-bold text-sm text-white ${agentBgClass}`}
            >
              {agentInitials}
            </div>
            {/* Status dot at bottom right: online only if isOnline */}
            <span
              className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-q-secondary-elevated ${
                agent.isOnline ? "bg-q-online" : "bg-q-offline"
              }`}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <PinIcon />
              <p className="truncate text-[15px] font-medium text-q-text">
                {`@${agent.handle} · You`}
              </p>
            </div>
            <p className="mt-0.5 truncate text-[13px] text-q-text-2">
              {agent.isOnline ? "online — speaking for you" : "offline"}
            </p>
          </div>
        </div>
      )}
      {/* ── Requests entry in the list column (with count) showing request conversations ── */}
      {requestCount > 0 && (
        <button
          type="button"
          id="requests-list-entry"
          onClick={() => setShowRequests((prev) => !prev)}
          className={`apple-btn flex w-full items-center justify-between border-b border-q-separator px-4 py-2.5 text-left transition-colors active:scale-[0.99] ${
            showRequests
              ? "bg-q-secondary-elevated text-q-accent font-semibold"
              : "hover:bg-q-secondary-elevated/60 text-q-text"
          }`}
        >
          <div className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-[13px] font-medium">
              {showRequests ? "← Back to chats" : "Requests"}
            </span>
          </div>
          {!showRequests && (
            <span
              id="requests-count-badge"
              className="rounded-full bg-q-accent px-2 py-0.5 text-[11px] font-bold text-white shadow-xs"
            >
              {requestCount}
            </span>
          )}
        </button>
      )}

      {/* ── Scrollable list area: skeleton rows while loading, chat rows or empty state ── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          /* While loading: 6 skeleton rows, never a spinner */
          <div className="divide-y divide-q-separator/40" id="skeleton-list">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3.5 py-3 animate-pulse">
                <div className="h-11 w-11 rounded-full bg-q-skeleton shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-28 rounded bg-q-skeleton" />
                  <div className="h-3 w-40 rounded bg-q-skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredConversations.length > 0 ? (
          /* Real chat rows */
          <div className="divide-y divide-q-separator/40" id="conversations-list">
            {filteredConversations.map((chat) => {
              const isSelected = selectedChatId === chat.id;
              const chatInitials = initialsFromHandle(chat.handle);
              const chatBg = avatarBgClass(chat.handle);

              return (
                <div
                  key={chat.id}
                  onClick={() => onSelectChat?.(chat.id)}
                  className={`group relative flex cursor-pointer items-center gap-3 px-3.5 py-3 transition-colors ${
                    isSelected ? "bg-q-selected-row" : "hover:bg-q-secondary-elevated/50"
                  }`}
                >
                  {/* 44px Avatar with status dot */}
                  <div className="relative shrink-0">
                    <div
                      style={{ backgroundColor: avatarColor(chat.handle) }}
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full leading-none text-center select-none font-bold text-sm text-white ${chatBg}`}
                    >
                      {chatInitials}
                    </div>
                    <span
                      className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-q-bg ${
                        chat.presence === "online"
                          ? "bg-q-online"
                          : chat.presence === "waiting for its owner to approve"
                          ? "bg-q-waiting"
                          : "bg-q-offline"
                      }`}
                    />
                  </div>

                  {/* Middle: name + preview */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="truncate text-[15px] font-medium text-q-text">
                          {chat.name ?? `@${chat.handle}`}
                        </p>
                        {chat.is_guest && (
                          <span
                            id={`guest-badge-${chat.id}`}
                            className="rounded-full bg-q-accent/10 text-q-accent border border-q-accent/20 px-1.5 py-0.5 text-[10px] font-medium tracking-wide shrink-0"
                          >
                            Guest
                          </span>
                        )}
                      </div>
                      {chat.lastMessageTime && (
                        <span
                          className={`text-[12px] shrink-0 ${
                            (chat.unreadCount ?? 0) > 0 ? "text-q-accent font-medium" : "text-q-text-3"
                          }`}
                        >
                          {chat.lastMessageTime}
                        </span>
                      )}
                    </div>

                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 min-w-0">
                        {/* Prefix ticks when last message is from owner's agent */}
                        {chat.lastMessageIsOwn && (
                          <span className="shrink-0">
                            {chat.lastMessageStatus === "queued" && <SingleTickIcon className="text-q-text-3" />}
                            {chat.lastMessageStatus === "delivered" && <DoubleTickIcon className="text-q-text-3" />}
                            {chat.lastMessageStatus === "read" && <DoubleTickIcon className="text-q-accent" />}
                          </span>
                        )}
                        <p className="truncate text-[13px] text-q-text-2">
                          {chat.lastMessagePreview ?? "No messages yet"}
                        </p>
                      </div>

                      {/* Unread badge = accent pill, white bold 11px text, min-width 18px */}
                      {(chat.unreadCount ?? 0) > 0 && (
                        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-q-accent px-1.5 text-[11px] font-bold text-white shrink-0">
                          {chat.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Separator: hairline inset 76px from left */}
                  <div className="absolute bottom-0 left-[76px] right-0 h-[1px] bg-q-separator/40 group-last:hidden" />
                </div>
              );
            })}
          </div>
        ) : (
          /* Empty list state, centred: "No chats yet. When your agent talks to someone, it shows up here." */
          <div className="flex h-[320px] flex-col items-center justify-center px-6 text-center">
            <p className="text-[13px] leading-relaxed text-q-text-2 max-w-[240px]">
              No chats yet. When your agent talks to someone, it shows up here.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function PinIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="shrink-0 text-q-text-3"
      aria-hidden="true"
    >
      <path d="M16 3a1 1 0 0 1 1 1v2a1 1 0 0 1-.293.707L15 8.414V13a2 2 0 0 0 .586 1.414l1.121 1.121A1 1 0 0 1 16 17H8a1 1 0 0 1-.707-1.465l1.121-1.121A2 2 0 0 0 9 13V8.414l-1.707-1.707A1 1 0 0 1 7 6V4a1 1 0 0 1 1-1h8zm-3 15v4a1 1 0 0 1-2 0v-4h2z" />
    </svg>
  );
}

function SingleTickIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="3 8.5 6.5 12 13 4" />
    </svg>
  );
}

function DoubleTickIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="14"
      viewBox="0 0 18 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M1.5 8.5 5 12l6.5-8" />
      <path d="M7 8.5 10.5 12 17 4" />
    </svg>
  );
}
