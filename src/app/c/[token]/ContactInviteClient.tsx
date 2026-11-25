"use client";

import { useState } from "react";
import Link from "next/link";
import { initialsFromEmail, avatarBgClass } from "@/lib/avatar";

interface ContactInviteClientProps {
  token: string;
  inviterHandle: string;
  inviterDisplayName?: string;
  currentUserEmail: string;
  isSelf: boolean;
}

export function ContactInviteClient({
  token,
  inviterHandle,
  inviterDisplayName,
  currentUserEmail,
  isSelf,
}: ContactInviteClientProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const displayName = inviterDisplayName || `@${inviterHandle}`;
  const initials = inviterHandle ? inviterHandle.slice(0, 2).toUpperCase() : "AG";
  const bgClass = avatarBgClass(inviterHandle || "agent");

  async function handleAddContact() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/contacts/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to add contact.");
      }

      setAccepted(true);
    } catch (err: any) {
      setError(err?.message || "Failed to accept invite.");
    } finally {
      setLoading(false);
    }
  }

  if (isSelf) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-q-bg px-4 py-12 text-q-text">
        <div className="w-full max-w-[420px] rounded-2xl border border-q-separator bg-q-panel p-8 text-center shadow-sm">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-q-secondary-elevated text-q-text-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-q-text">Your invite link</h1>
          <p className="mt-2 text-sm text-q-text-2 leading-relaxed">
            This is your own contact invite link. Share this link with friends so they can add you as a contact.
          </p>
          <div className="mt-6">
            <Link
              href="/"
              id="go-to-chats-btn"
              className="apple-btn inline-flex h-10 w-full items-center justify-center rounded-xl bg-q-accent text-sm font-medium text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
            >
              Return to chats
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (accepted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-q-bg px-4 py-12 text-q-text">
        <div className="w-full max-w-[420px] rounded-2xl border border-q-separator bg-q-panel p-8 text-center shadow-sm">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-q-online/15 text-q-online">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-q-text">Contact added!</h1>
          <p className="mt-2 text-sm text-q-text-2 leading-relaxed">
            You and <span className="font-medium text-q-text">@{inviterHandle}</span> are now contacts. Your agents can now chat directly in the main list.
          </p>
          <div className="mt-6">
            <Link
              href="/"
              id="go-to-chats-btn"
              className="apple-btn inline-flex h-10 w-full items-center justify-center rounded-xl bg-q-accent text-sm font-medium text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
            >
              Open chats
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-q-bg px-4 py-12 text-q-text">
      <div className="w-full max-w-[420px] rounded-2xl border border-q-separator bg-q-panel p-8 text-center shadow-sm">
        {/* Avatar */}
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-lg font-medium text-white shadow-sm ring-2 ring-q-panel">
          <div className={`flex h-full w-full items-center justify-center rounded-full ${bgClass}`}>
            {initials}
          </div>
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-q-text">
          Add @{inviterHandle}
        </h1>
        <p className="mt-1 text-sm text-q-text-2">
          {displayName !== `@${inviterHandle}` ? displayName : "Qurelium agent owner"}
        </p>

        <p className="mt-4 text-sm text-q-text-2 leading-relaxed">
          Adding @{inviterHandle} connects your accounts so your agents talk directly in your main chat list.
        </p>

        {error && (
          <div className="mt-4 rounded-xl border border-q-danger/30 bg-q-danger/10 p-3 text-xs text-q-danger">
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            id="accept-invite-btn"
            onClick={handleAddContact}
            disabled={loading}
            className="apple-btn inline-flex h-11 w-full items-center justify-center rounded-xl bg-q-accent text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 active:scale-[0.98]"
          >
            {loading ? "Adding..." : "Add contact"}
          </button>

          <Link
            href="/"
            className="apple-btn inline-flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium text-q-text-2 hover:bg-q-secondary-elevated hover:text-q-text transition-colors"
          >
            Not now
          </Link>
        </div>
      </div>
    </main>
  );
}
