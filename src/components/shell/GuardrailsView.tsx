"use client";

import { useState, useEffect } from "react";
import {
  GuardCategoryKey,
  GuardCategoryMode,
  GuardCategoryState,
  ScreeningActivityItem,
} from "@/types/brain";

export interface GuardEntryItem {
  id: string;
  text: string;
  share_rule: "never" | "ask" | "share";
  created_at: string;
}

interface GuardrailsViewProps {
  onBack?: () => void;
}

const SPECIFICS_ORDER: GuardCategoryKey[] = [
  "home_address",
  "phone_number",
  "personal_email",
  "live_location",
  "money_figures",
  "health_specifics",
  "family_specifics",
];

export function GuardrailsView({ onBack }: GuardrailsViewProps) {
  const [categories, setCategories] = useState<GuardCategoryState[]>([]);
  const [entries, setEntries] = useState<GuardEntryItem[]>([]);
  const [activity, setActivity] = useState<ScreeningActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Form states for Block D
  const [neverText, setNeverText] = useState("");
  const [isSubmittingNever, setIsSubmittingNever] = useState(false);

  const [askText, setAskText] = useState("");
  const [isSubmittingAsk, setIsSubmittingAsk] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      try {
        const [guardrailsRes, activityRes] = await Promise.all([
          fetch("/api/guardrails"),
          fetch("/api/guardrails/activity"),
        ]);

        if (guardrailsRes.ok) {
          const gData = await guardrailsRes.json();
          if (!isCancelled) {
            if (gData.categories) setCategories(gData.categories);
            if (gData.entries) setEntries(gData.entries);
          }
        }

        if (activityRes.ok) {
          const aData = await activityRes.json();
          if (!isCancelled && aData.activity) {
            setActivity(aData.activity);
          }
        }
      } catch {
        // Ignore network errors
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    loadData();
    return () => {
      isCancelled = true;
    };
  }, []);

  async function handleToggleCategory(category: GuardCategoryKey, mode: GuardCategoryMode) {
    setUpdateError(null);
    const previousCategories = [...categories];

    // Optimistic UI update
    setCategories((prev) =>
      prev.map((c) => (c.category === category ? { ...c, mode } : c)),
    );

    try {
      const res = await fetch("/api/guardrails/category", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, mode }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setCategories(previousCategories);
        setUpdateError(errData.error?.message || "Failed to update category.");
      }
    } catch {
      setCategories(previousCategories);
      setUpdateError("Network error updating category.");
    }
  }

  async function handleAddNeverEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!neverText.trim() || isSubmittingNever) return;

    setIsSubmittingNever(true);
    try {
      const res = await fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: neverText.trim(),
          guard: "never",
        }),
      });

      const data = await res.json();
      if (res.ok && data.fact) {
        setEntries((prev) => [data.fact, ...prev.filter((item) => item.id !== data.fact.id)]);
        setNeverText("");
      }
    } catch {
      // Ignore network errors
    } finally {
      setIsSubmittingNever(false);
    }
  }

  async function handleAddAskEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!askText.trim() || isSubmittingAsk) return;

    setIsSubmittingAsk(true);
    try {
      const res = await fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: askText.trim(),
          guard: "ask",
        }),
      });

      const data = await res.json();
      if (res.ok && data.fact) {
        setEntries((prev) => [data.fact, ...prev.filter((item) => item.id !== data.fact.id)]);
        setAskText("");
      }
    } catch {
      // Ignore network errors
    } finally {
      setIsSubmittingAsk(false);
    }
  }

  async function handleDeleteEntry(id: string) {
    try {
      const res = await fetch(`/api/facts/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setEntries((prev) => prev.filter((item) => item.id !== id));
      }
    } catch {
      // Ignore network errors
    }
  }

  const secretsCategory = categories.find((c) => c.category === "secrets");
  const specificsCategories = SPECIFICS_ORDER.map(
    (key) => categories.find((c) => c.category === key),
  ).filter(Boolean) as GuardCategoryState[];

  const neverEntries = entries.filter((e) => e.share_rule === "never");
  const askEntries = entries.filter((e) => e.share_rule === "ask");

  function formatTime(isoStr: string) {
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function getOutcomeLabel(item: ScreeningActivityItem) {
    if (item.outcome === "blocked") {
      return item.category ? `Blocked — ${item.category}` : "Blocked";
    }
    if (item.outcome === "held") {
      return item.category ? `Held — ${item.category}` : "Held for approval";
    }
    if (item.outcome === "shared") {
      return "Delivered";
    }
    if (item.outcome === "never") {
      return "Blocked — never rule";
    }
    return "Check";
  }

  return (
    <div
      id="guardrails-view"
      className="flex flex-1 flex-col bg-q-bg h-full overflow-hidden select-none"
    >
      {/* ── Top Header bar: 60px translucent chrome ──────────────────────── */}
      <header className="translucent-chrome flex h-[60px] shrink-0 items-center justify-between border-b border-q-separator px-6 z-10">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-q-text leading-tight">
            Guardrails
          </h2>
          <p className="text-[13px] text-q-text-2 leading-tight mt-0.5 truncate">
            Your agent answers freely by default. You set the exceptions.
          </p>
        </div>

        {onBack && (
          <button
            type="button"
            id="guardrails-back-btn"
            onClick={onBack}
            className="apple-btn flex items-center gap-1.5 rounded-full bg-q-secondary-elevated px-3 py-1.5 text-xs font-medium text-q-text hover:bg-q-secondary-elevated/80 active:scale-[0.97] transition-colors shrink-0"
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
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Chats
          </button>
        )}
      </header>

      {/* ── Main Scrollable Body: Full Width with standard insets ───────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 w-full space-y-7">
        {updateError && (
          <div className="rounded-[12px] bg-q-elevated border border-q-danger/40 px-4 py-2 text-xs text-q-danger">
            {updateError}
          </div>
        )}

        {/* ── BLOCK A: ALWAYS PROTECTED ────────────────────────────────────── */}
        <section id="block-always-protected" className="space-y-2">
          <h3 className="text-[12px] font-medium uppercase tracking-wider text-q-text-2 px-1">
            Always protected
          </h3>

          <div className="rounded-[14px] border border-q-separator bg-q-elevated overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-q-text">
                  Secrets
                </p>
                <p className="text-[13px] text-q-text-2">
                  Passwords, codes, card numbers, and banking details
                </p>
              </div>

              {/* Two-state segmented control: Never / Ask me */}
              <div
                className="inline-flex items-center rounded-lg bg-q-secondary-elevated p-0.5 border border-q-separator/40 shrink-0 self-start sm:self-auto"
                role="group"
                aria-label="Secrets protection mode"
              >
                <button
                  type="button"
                  id="secrets-mode-never-btn"
                  onClick={() => handleToggleCategory("secrets", "never")}
                  className={`apple-btn rounded-md px-3 py-1 text-xs font-medium transition-all ${
                    (secretsCategory?.mode ?? "never") === "never"
                      ? "bg-q-bg text-q-danger shadow-xs font-semibold"
                      : "text-q-text-2 hover:text-q-text"
                  }`}
                >
                  Never
                </button>
                <button
                  type="button"
                  id="secrets-mode-ask-btn"
                  onClick={() => handleToggleCategory("secrets", "ask")}
                  className={`apple-btn rounded-md px-3 py-1 text-xs font-medium transition-all ${
                    secretsCategory?.mode === "ask"
                      ? "bg-q-bg text-q-text shadow-xs font-semibold"
                      : "text-q-text-2 hover:text-q-text"
                  }`}
                >
                  Ask me
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── BLOCK B: YOUR SPECIFICS ──────────────────────────────────────── */}
        <section id="block-your-specifics" className="space-y-2">
          <h3 className="text-[12px] font-medium uppercase tracking-wider text-q-text-2 px-1">
            Your specifics
          </h3>

          <div className="rounded-[14px] border border-q-separator bg-q-elevated overflow-hidden divide-y divide-q-separator">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-10 rounded-lg bg-q-skeleton animate-pulse" />
                ))}
              </div>
            ) : (
              specificsCategories.map((cat) => (
                <div
                  key={cat.category}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium text-q-text">
                      {cat.label}
                    </p>
                    <p className="text-[13px] text-q-text-2">
                      {cat.description}
                    </p>
                  </div>

                  {/* Three-way segmented control: Share / Ask me / Never */}
                  <div
                    className="inline-flex items-center rounded-lg bg-q-secondary-elevated p-0.5 border border-q-separator/40 shrink-0 self-start sm:self-auto"
                    role="group"
                    aria-label={`${cat.label} protection mode`}
                  >
                    <button
                      type="button"
                      id={`${cat.category}-mode-open-btn`}
                      onClick={() => handleToggleCategory(cat.category, "open")}
                      className={`apple-btn rounded-md px-3 py-1 text-xs font-medium transition-all ${
                        cat.mode === "open"
                          ? "bg-q-bg text-q-text shadow-xs font-semibold"
                          : "text-q-text-2 hover:text-q-text"
                      }`}
                    >
                      Share
                    </button>
                    <button
                      type="button"
                      id={`${cat.category}-mode-ask-btn`}
                      onClick={() => handleToggleCategory(cat.category, "ask")}
                      className={`apple-btn rounded-md px-3 py-1 text-xs font-medium transition-all ${
                        cat.mode === "ask"
                          ? "bg-q-bg text-q-text shadow-xs font-semibold"
                          : "text-q-text-2 hover:text-q-text"
                      }`}
                    >
                      Ask me
                    </button>
                    <button
                      type="button"
                      id={`${cat.category}-mode-never-btn`}
                      onClick={() => handleToggleCategory(cat.category, "never")}
                      className={`apple-btn rounded-md px-3 py-1 text-xs font-medium transition-all ${
                        cat.mode === "never"
                          ? "bg-q-bg text-q-danger shadow-xs font-semibold"
                          : "text-q-text-2 hover:text-q-text"
                      }`}
                    >
                      Never
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── BLOCK C: RECENT CHECKS ───────────────────────────────────────── */}
        <section id="block-recent-checks" className="space-y-2">
          <h3 className="text-[12px] font-medium uppercase tracking-wider text-q-text-2 px-1">
            Recent checks
          </h3>

          <div className="rounded-[14px] border border-q-separator bg-q-elevated overflow-hidden divide-y divide-q-separator">
            {activity.length > 0 ? (
              activity.slice(0, 20).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-[13px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-q-text">
                        {getOutcomeLabel(item)}
                      </span>
                      <span className="text-q-text-3 text-[12px]">
                        {formatTime(item.timestamp)}
                      </span>
                    </div>
                    <p className="text-q-text-2 text-[13px] truncate mt-0.5">
                      {item.text}
                    </p>
                  </div>

                  {item.approval_id && onBack && (
                    <button
                      type="button"
                      onClick={onBack}
                      className="apple-btn text-xs text-q-accent hover:underline shrink-0"
                    >
                      Review
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className="px-4 py-3.5">
                <p className="text-[13px] text-q-text-2">
                  No screening activity yet.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── BLOCK D: SPECIFIC ITEMS ──────────────────────────────────────── */}
        <section id="block-specific-items" className="space-y-4 pt-2">
          <h3 className="text-[12px] font-medium uppercase tracking-wider text-q-text-2 px-1">
            Specific items
          </h3>

          {/* Sub-block 1: Never list */}
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-q-text px-1">
              Never share
            </p>

            <div className="rounded-[14px] border border-q-separator bg-q-elevated overflow-hidden divide-y divide-q-separator">
              {neverEntries.length > 0 ? (
                neverEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
                  >
                    <span className="text-q-text break-words flex-1">
                      {entry.text}
                    </span>
                    <button
                      type="button"
                      aria-label="Delete entry"
                      onClick={() => handleDeleteEntry(entry.id)}
                      className="apple-btn text-xs text-q-danger hover:underline shrink-0"
                    >
                      Delete
                    </button>
                  </div>
                ))
              ) : (
                <div className="px-4 py-3 text-[13px] text-q-text-2">
                  No never items added.
                </div>
              )}

              {/* Small add form */}
              <form
                onSubmit={handleAddNeverEntry}
                className="flex items-center gap-2 px-3 py-2 bg-q-secondary-elevated/40"
              >
                <input
                  type="text"
                  id="add-never-input"
                  value={neverText}
                  onChange={(e) => setNeverText(e.target.value)}
                  placeholder="Add an exact word or code"
                  className="flex-1 bg-transparent px-2 py-1 text-[13px] text-q-text placeholder:text-q-text-3 outline-none"
                />
                <button
                  type="submit"
                  id="add-never-submit-btn"
                  disabled={isSubmittingNever || !neverText.trim()}
                  className="apple-btn rounded-md bg-q-secondary-elevated px-2.5 py-1 text-xs font-medium text-q-text hover:bg-q-secondary-elevated/80 disabled:opacity-40 transition-all shrink-0 border border-q-separator/50"
                >
                  Add
                </button>
              </form>
            </div>
          </div>

          {/* Sub-block 2: Ask list */}
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-q-text px-1">
              Ask first
            </p>

            <div className="rounded-[14px] border border-q-separator bg-q-elevated overflow-hidden divide-y divide-q-separator">
              {askEntries.length > 0 ? (
                askEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
                  >
                    <span className="text-q-text break-words flex-1">
                      {entry.text}
                    </span>
                    <button
                      type="button"
                      aria-label="Delete entry"
                      onClick={() => handleDeleteEntry(entry.id)}
                      className="apple-btn text-xs text-q-danger hover:underline shrink-0"
                    >
                      Delete
                    </button>
                  </div>
                ))
              ) : (
                <div className="px-4 py-3 text-[13px] text-q-text-2">
                  No ask items added.
                </div>
              )}

              {/* Small add form */}
              <form
                onSubmit={handleAddAskEntry}
                className="flex items-center gap-2 px-3 py-2 bg-q-secondary-elevated/40"
              >
                <input
                  type="text"
                  id="add-ask-input"
                  value={askText}
                  onChange={(e) => setAskText(e.target.value)}
                  placeholder="Add an exact word or code"
                  className="flex-1 bg-transparent px-2 py-1 text-[13px] text-q-text placeholder:text-q-text-3 outline-none"
                />
                <button
                  type="submit"
                  id="add-ask-submit-btn"
                  disabled={isSubmittingAsk || !askText.trim()}
                  className="apple-btn rounded-md bg-q-secondary-elevated px-2.5 py-1 text-xs font-medium text-q-text hover:bg-q-secondary-elevated/80 disabled:opacity-40 transition-all shrink-0 border border-q-separator/50"
                >
                  Add
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
