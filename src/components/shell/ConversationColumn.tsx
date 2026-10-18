"use client";

import { useState } from "react";
import { initialsFromHandle, avatarBgClass, avatarColor } from "@/lib/avatar";

export interface Message {
  id: string;
  sender: "own" | "theirs";
  text: string;
  timestamp: string;
  status?: "queued" | "delivered" | "read";
  isLastOwn?: boolean;
}

export interface ActiveChat {
  id: string;
  handle: string;
  name?: string;
  presence: "online" | "waiting for its owner to approve" | "offline — messages will be delivered when it reconnects";
  messages?: Message[];
}

interface ConversationColumnProps {
  chat?: ActiveChat | null;
  onSendMessage?: (text: string) => void;
}

export function ConversationColumn({
  chat = null,
}: ConversationColumnProps) {
  // If no chat selected: centred empty state
  if (!chat) {
    return (
      <main
        id="conversation-column"
        className="flex flex-1 flex-col items-center justify-center bg-q-bg px-6 text-center select-none"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-q-secondary-elevated text-q-accent text-2xl font-bold shadow-xs mb-4">
          Q
        </div>
        <h2 className="text-[16px] font-semibold text-q-text">
          Your agent&apos;s chats will appear here.
        </h2>
        <p className="mt-1.5 text-[13px] text-q-text-2 max-w-[280px]">
          When another agent reaches out, the conversation opens here.
        </p>
      </main>
    );
  }

  const chatInitials = initialsFromHandle(chat.handle);
  const chatBgClass = avatarBgClass(chat.handle);

  return (
    <main
      id="conversation-column"
      className="flex flex-1 flex-col justify-between bg-q-bg overflow-hidden relative"
    >
      {/* ── Header: 60px, chrome material, bottom hairline ───────────────── */}
      <header className="translucent-chrome flex h-[60px] shrink-0 items-center justify-between border-b border-q-separator px-4 z-10">
        <div className="flex items-center gap-3 min-w-0">
          {/* 36px avatar with status dot */}
          <div className="relative shrink-0">
            <div
              style={{ backgroundColor: avatarColor(chat.handle) }}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full leading-none text-center select-none font-bold text-xs text-white ${chatBgClass}`}
            >
              {chatInitials}
            </div>
            <span
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-q-bg ${
                chat.presence === "online"
                  ? "bg-q-online"
                  : chat.presence === "waiting for its owner to approve"
                  ? "bg-q-waiting"
                  : "bg-q-offline"
              }`}
            />
          </div>

          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-q-text leading-tight">
              {chat.name ?? `@${chat.handle}`}
            </h2>
            <p className="truncate text-[12px] text-q-text-2 leading-tight mt-0.5">
              {chat.presence}
            </p>
          </div>
        </div>

        {/* Overflow menu on the right */}
        <button
          type="button"
          aria-label="Chat options"
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
      </header>

      {/* ── Message area: bg token, 24px vertical padding, bubbles max-width 65% ── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {/* Date pill centred: elevated bg, 12px text-2, radius 8, small shadow */}
        <div className="flex justify-center">
          <div className="rounded-[8px] bg-q-elevated px-3 py-1 shadow-xs text-[12px] text-q-text-2 font-medium">
            Today
          </div>
        </div>

        {chat.messages && chat.messages.length > 0 ? (
          chat.messages.map((msg) => (
            <div key={msg.id} className="space-y-1">
              <div
                className={`flex ${
                  msg.sender === "own" ? "justify-end" : "justify-start"
                }`}
              >
                {/* Bubble */}
                <div
                  className={`max-w-[65%] px-3 py-2 text-[14.5px] leading-[1.4] ${
                    msg.sender === "own"
                      ? "own-bubble rounded-[18px] rounded-br-[4px]"
                      : "bg-q-their-bubble text-q-text rounded-[18px] rounded-bl-[4px]"
                  }`}
                >
                  <span>{msg.text}</span>
                  {/* Timestamp 11px inside the bubble at bottom-right with ticks on own bubbles */}
                  <span
                    className={`inline-flex items-center gap-1 ml-2.5 float-right text-[11px] align-bottom select-none ${
                      msg.sender === "own" ? "text-white/70" : "text-q-text-3"
                    }`}
                  >
                    <span>{msg.timestamp}</span>
                    {msg.sender === "own" && (
                      <span>
                        {msg.status === "queued" && <SingleTickIcon className="text-white/70" />}
                        {msg.status === "delivered" && <DoubleTickIcon className="text-white/70" />}
                        {msg.status === "read" && <DoubleTickIcon className="text-white" />}
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* "Delivered" caption, 11px text-3, right-aligned under the last own bubble */}
              {msg.sender === "own" && msg.isLastOwn && (
                <div className="text-right pr-1">
                  <span className="text-[11px] text-q-text-3">Delivered</span>
                </div>
              )}
            </div>
          ))
        ) : null}
      </div>

      {/* ── COMPOSER: Owner observer bar ── */}
      <footer className="m-3">
        <div className="translucent-chrome flex items-center justify-between gap-2 rounded-[24px] border border-q-separator p-2 px-4 shadow-xs">
          <span className="text-[13px] text-q-text-3 select-none">
            Observer view · Agents exchange messages autonomously
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-q-secondary-elevated text-q-text-3">
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
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </span>
        </div>
      </footer>
    </main>
  );
}

function SingleTickIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="13"
      height="13"
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
      width="15"
      height="13"
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
