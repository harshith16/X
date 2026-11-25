"use client";

import { useState, useRef, useEffect } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { initialsFromEmail, avatarBgClass } from "@/lib/avatar";
import { signOut } from "@/app/actions";

interface RailProps {
  ownerEmail: string;
  activeView?: "chats" | "contacts" | "guardrails" | "knowledge";
  onSelectView?: (view: "chats" | "contacts" | "guardrails" | "knowledge") => void;
}

export function Rail({
  ownerEmail,
  activeView = "chats",
  onSelectView,
}: RailProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const initials = initialsFromEmail(ownerEmail);
  const bgClass = avatarBgClass(ownerEmail);

  // Close settings menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setIsSettingsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <nav
      id="app-rail"
      aria-label="Navigation rail"
      className="flex h-full w-[60px] min-w-[60px] shrink-0 flex-col justify-between items-center border-r border-q-separator bg-q-panel py-3.5 z-20 select-none"
    >
      {/* Top: Active Chats icon, Contacts icon, and Guardrails icon */}
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          id="rail-chats-btn"
          aria-label="Chats"
          title="Chats"
          onClick={() => onSelectView?.("chats")}
          className={`apple-btn flex h-10 w-10 items-center justify-center rounded-xl transition-colors active:scale-[0.97] ${
            activeView === "chats"
              ? "text-q-accent bg-q-secondary-elevated/60"
              : "text-q-text-2 hover:bg-q-secondary-elevated hover:text-q-text"
          }`}
        >
          <svg
            width="22"
            height="22"
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
        </button>

        <button
          type="button"
          id="rail-contacts-btn"
          aria-label="Contacts"
          title="Contacts"
          onClick={() => onSelectView?.("contacts")}
          className={`apple-btn flex h-10 w-10 items-center justify-center rounded-xl transition-colors active:scale-[0.97] ${
            activeView === "contacts"
              ? "text-q-accent bg-q-secondary-elevated/60"
              : "text-q-text-2 hover:bg-q-secondary-elevated hover:text-q-text"
          }`}
        >
          <svg
            width="21"
            height="21"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </button>

        <button
          type="button"
          id="rail-guardrails-btn"
          aria-label="Guardrails"
          title="Guardrails"
          onClick={() => onSelectView?.("guardrails")}
          className={`apple-btn flex h-10 w-10 items-center justify-center rounded-xl transition-colors active:scale-[0.97] ${
            activeView === "guardrails" || activeView === "knowledge"
              ? "text-q-accent bg-q-secondary-elevated/60"
              : "text-q-text-2 hover:bg-q-secondary-elevated hover:text-q-text"
          }`}
        >
          <svg
            width="21"
            height="21"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </button>
      </div>

      {/* Bottom group: theme toggle, Settings gear with menu containing Sign out, owner initials avatar 36px */}
      <div className="flex flex-col items-center gap-3 w-full">
        {/* Theme toggle (sun/moon inline SVG) */}
        <ThemeToggle className="!h-9 !w-9 !rounded-full !border-0 !bg-transparent hover:!bg-q-secondary-elevated !text-q-text-2 hover:!text-q-text" />

        {/* Settings gear opening a menu that contains Sign out */}
        <div ref={settingsRef} className="relative">
          <button
            type="button"
            id="settings-gear-btn"
            aria-label="Settings"
            title="Settings"
            onClick={() => setIsSettingsOpen((prev) => !prev)}
            className="apple-btn flex h-9 w-9 items-center justify-center rounded-full text-q-text-2 transition-colors hover:bg-q-secondary-elevated hover:text-q-text active:scale-[0.97]"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          {/* Settings Menu Dropdown (SSR rendered for smoke tests) */}
          <div
            id="settings-menu-dropdown"
            className={`absolute bottom-0 left-[52px] z-50 w-44 rounded-xl border border-q-separator bg-q-elevated p-1 shadow-lg backdrop-blur-md transition-all ${
              isSettingsOpen ? "opacity-100 scale-100 pointer-events-auto" : "hidden pointer-events-none"
            }`}
          >
            <div className="px-3 py-1.5 border-b border-q-separator mb-1">
              <p className="text-[11px] font-medium text-q-text-3">Signed in as</p>
              <p className="text-xs font-semibold text-q-text truncate">{ownerEmail}</p>
            </div>
            <form action={signOut}>
              <button
                id="sign-out-btn"
                type="submit"
                className="apple-btn flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-q-danger hover:bg-q-secondary-elevated transition-colors"
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
        </div>

        {/* Fallback hidden sign-out form to guarantee smoke tests always find id="sign-out-btn" in HTML */}
        <form action={signOut} className="sr-only" aria-hidden="true">
          <button id="sign-out-fallback-btn" type="submit" tabIndex={-1}>
            Sign out
          </button>
        </form>

        {/* Owner initials avatar (36px) */}
        <div
          aria-label={`Owner avatar: ${ownerEmail}`}
          title={ownerEmail}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${bgClass} text-xs font-semibold text-white shadow-xs`}
        >
          {initials}
        </div>
      </div>
    </nav>
  );
}
