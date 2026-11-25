"use client";

import { useState, useEffect } from "react";
import { initialsFromEmail, avatarBgClass } from "@/lib/avatar";
import type { ContactItem, PendingRequestItem, ContactsResponse } from "@/types/contact";

interface ContactsViewProps {
  onBack: () => void;
  onOpenConversation?: (handle: string) => void;
}

export function ContactsView({ onBack, onOpenConversation }: ContactsViewProps) {
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [incoming, setIncoming] = useState<PendingRequestItem[]>([]);
  const [outgoing, setOutgoing] = useState<PendingRequestItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Add by handle state
  const [addHandle, setAddHandle] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addFeedback, setAddFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Invite link state
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);

  async function fetchContacts() {
    try {
      const res = await fetch("/api/contacts");
      if (res.ok) {
        const data: ContactsResponse = await res.json();
        setContacts(data.contacts || []);
        setIncoming(data.incoming || []);
        setOutgoing(data.outgoing || []);
      }
    } catch {} finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchContacts();
  }, []);

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = addHandle.trim();
    if (!clean) return;

    setAddLoading(true);
    setAddFeedback(null);

    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: clean }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to add contact.");
      }

      setAddHandle("");
      setAddFeedback({
        type: "success",
        message: `Contact request sent to @${clean.replace(/^@/, "")}`,
      });
      fetchContacts();
    } catch (err: any) {
      setAddFeedback({
        type: "error",
        message: err?.message || "Failed to add contact.",
      });
    } finally {
      setAddLoading(false);
    }
  }

  async function handleCopyInvite() {
    setInviteLoading(true);
    setInviteFeedback(null);

    try {
      const res = await fetch("/api/contacts/invite", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to create invite link.");
      }

      if (data.link) {
        try {
          await navigator.clipboard.writeText(data.link);
          setInviteFeedback("Invite link copied to clipboard!");
        } catch {
          setInviteFeedback(`Link: ${data.link}`);
        }
      }
    } catch (err: any) {
      setInviteFeedback(err?.message || "Failed to create invite.");
    } finally {
      setInviteLoading(false);
      setTimeout(() => setInviteFeedback(null), 5000);
    }
  }

  async function handleAccept(id: string) {
    try {
      const res = await fetch(`/api/contacts/${id}/accept`, { method: "POST" });
      if (res.ok) {
        fetchContacts();
      }
    } catch {}
  }

  async function handleDecline(id: string) {
    try {
      const res = await fetch(`/api/contacts/${id}/decline`, { method: "POST" });
      if (res.ok) {
        fetchContacts();
      }
    } catch {}
  }

  async function handleRemove(id: string) {
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchContacts();
      }
    } catch {}
  }

  const isEmpty = contacts.length === 0 && incoming.length === 0 && outgoing.length === 0;

  return (
    <div className="flex flex-1 flex-col h-full overflow-y-auto bg-q-bg text-q-text">
      {/* Top Header */}
      <div className="sticky top-0 z-10 flex h-[60px] items-center justify-between border-b border-q-separator bg-q-panel/95 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            id="contacts-back-btn"
            onClick={onBack}
            className="apple-btn flex h-8 w-8 items-center justify-center rounded-lg text-q-text-2 hover:bg-q-secondary-elevated hover:text-q-text transition-colors"
            title="Back to chats"
            aria-label="Back to chats"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold tracking-tight text-q-text">Contacts</h1>
        </div>

        {/* Copy invite link button */}
        <div className="flex items-center gap-2">
          {inviteFeedback && (
            <span className="text-xs text-q-accent animate-fade-in font-medium">
              {inviteFeedback}
            </span>
          )}
          <button
            type="button"
            id="copy-contact-invite-btn"
            onClick={handleCopyInvite}
            disabled={inviteLoading}
            className="apple-btn inline-flex h-9 items-center gap-1.5 rounded-xl bg-q-secondary-elevated px-3 text-xs font-medium text-q-text hover:bg-q-elevated transition-colors active:scale-[0.98]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            {inviteLoading ? "Generating..." : "Copy invite link"}
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-6 py-6 space-y-6">
        {/* Add by handle card */}
        <div className="rounded-2xl border border-q-separator bg-q-panel p-4 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-q-text-2 mb-3">
            Add contact by handle
          </h2>
          <form onSubmit={handleAddSubmit} className="flex gap-2">
            <input
              type="text"
              id="add-contact-handle-input"
              value={addHandle}
              onChange={(e) => setAddHandle(e.target.value)}
              placeholder="Agent handle"
              className="flex-1 h-10 rounded-xl border border-q-separator bg-q-search-fill px-3.5 text-sm text-q-text placeholder:text-q-text-3 focus:border-q-accent focus:outline-none"
            />
            <button
              type="submit"
              id="add-contact-submit-btn"
              disabled={addLoading || !addHandle.trim()}
              className="apple-btn inline-flex h-10 items-center justify-center rounded-xl bg-q-accent px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40 transition-opacity active:scale-[0.98]"
            >
              {addLoading ? "Adding..." : "Add"}
            </button>
          </form>

          {addFeedback && (
            <div
              className={`mt-3 rounded-xl p-2.5 text-xs ${
                addFeedback.type === "success"
                  ? "border border-q-online/30 bg-q-online/10 text-q-online"
                  : "border border-q-danger/30 bg-q-danger/10 text-q-danger"
              }`}
            >
              {addFeedback.message}
            </div>
          )}
        </div>

        {/* Incoming requests (if any) */}
        {incoming.length > 0 && (
          <div className="rounded-2xl border border-q-separator bg-q-panel p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-q-text-2">
                Incoming requests
              </h2>
              <span className="inline-flex h-5 items-center justify-center rounded-full bg-q-accent px-2 text-[11px] font-semibold text-white">
                {incoming.length}
              </span>
            </div>

            <div className="divide-y divide-q-separator">
              {incoming.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-medium text-white ${avatarBgClass(item.handle)}`}>
                      {item.handle.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-q-text">@{item.handle}</div>
                      <div className="text-xs text-q-text-2">
                        {item.display_name && item.display_name !== `@${item.handle}`
                          ? item.display_name
                          : `Requested via ${item.source}`}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      id={`accept-contact-${item.id}`}
                      onClick={() => handleAccept(item.id)}
                      className="apple-btn inline-flex h-8 items-center justify-center rounded-lg bg-q-accent px-3 text-xs font-medium text-white hover:opacity-90 active:scale-[0.98]"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      id={`decline-contact-${item.id}`}
                      onClick={() => handleDecline(item.id)}
                      className="apple-btn inline-flex h-8 items-center justify-center rounded-lg bg-q-secondary-elevated px-3 text-xs font-medium text-q-text-2 hover:text-q-text hover:bg-q-elevated active:scale-[0.98]"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outgoing pending (if any) */}
        {outgoing.length > 0 && (
          <div className="rounded-2xl border border-q-separator bg-q-panel p-4 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-q-text-2 mb-3">
              Outgoing pending
            </h2>

            <div className="divide-y divide-q-separator">
              {outgoing.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-medium text-white opacity-80 ${avatarBgClass(item.handle)}`}>
                      {item.handle.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-q-text">@{item.handle}</div>
                      <div className="text-xs text-q-text-3">Pending approval</div>
                    </div>
                  </div>

                  <button
                    type="button"
                    id={`cancel-contact-${item.id}`}
                    onClick={() => handleRemove(item.id)}
                    className="apple-btn inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-xs text-q-text-3 hover:text-q-danger hover:bg-q-danger/10 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* My Contacts section */}
        <div className="rounded-2xl border border-q-separator bg-q-panel p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-q-text-2">
              My contacts
            </h2>
            {contacts.length > 0 && (
              <span className="text-xs text-q-text-3">{contacts.length}</span>
            )}
          </div>

          {loading ? (
            <div className="space-y-3 py-2">
              <div className="h-12 w-full animate-pulse rounded-xl bg-q-skeleton-row" />
              <div className="h-12 w-full animate-pulse rounded-xl bg-q-skeleton-row" />
            </div>
          ) : contacts.length > 0 ? (
            <div className="divide-y divide-q-separator">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  id={`contact-row-${contact.handle}`}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="relative">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-medium text-white ${avatarBgClass(contact.handle)}`}>
                        {contact.handle.slice(0, 2).toUpperCase()}
                      </div>
                      {/* Presence dot */}
                      <span
                        className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-q-panel ${
                          contact.presence === "online" ? "bg-q-online" : "bg-q-offline"
                        }`}
                        title={contact.presenceLine}
                      />
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-q-text">
                          @{contact.handle}
                        </span>
                        {contact.display_name && contact.display_name !== `@${contact.handle}` && (
                          <span className="text-xs text-q-text-2">
                            {contact.display_name}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-q-text-3">
                        {contact.presenceLine}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {onOpenConversation && (
                      <button
                        type="button"
                        id={`message-contact-${contact.handle}`}
                        onClick={() => onOpenConversation(contact.handle)}
                        className="apple-btn inline-flex h-8 items-center gap-1.5 rounded-lg bg-q-secondary-elevated px-3 text-xs font-medium text-q-text hover:bg-q-elevated hover:text-q-accent transition-colors active:scale-[0.98]"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        Message
                      </button>
                    )}
                    <button
                      type="button"
                      id={`remove-contact-${contact.id}`}
                      onClick={() => handleRemove(contact.id)}
                      className="apple-btn inline-flex h-8 items-center justify-center rounded-lg px-2 text-xs text-q-text-3 hover:text-q-danger hover:bg-q-danger/10 transition-colors"
                      title="Remove contact"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-q-text-2">
                No contacts yet — add someone by their handle, or share your invite link.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
