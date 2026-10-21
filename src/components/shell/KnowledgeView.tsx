"use client";

import { useState, useEffect } from "react";
import { ShareRule } from "@/types/brain";

export interface FactItem {
  id: string;
  text: string;
  share_rule: ShareRule;
  created_at: string;
}

interface KnowledgeViewProps {
  onBack?: () => void;
}

export function KnowledgeView({ onBack }: KnowledgeViewProps) {
  const [facts, setFacts] = useState<FactItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [newRule, setNewRule] = useState<ShareRule>("share");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadFacts() {
      try {
        const res = await fetch("/api/facts");
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled && data.facts) {
            setFacts(data.facts);
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

    loadFacts();
    return () => {
      isCancelled = true;
    };
  }, []);

  async function handleAddFact(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: newText.trim(),
          share_rule: newRule,
        }),
      });

      const data = await res.json();
      if (res.ok && data.fact) {
        setFacts((prev) => {
          // If already exists, avoid duplicate in local UI
          if (prev.some((f) => f.id === data.fact.id)) return prev;
          return [data.fact, ...prev];
        });
        setNewText("");
      } else {
        setErrorMsg(data.error?.message || "Failed to add fact.");
      }
    } catch {
      setErrorMsg("Network error adding fact.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteFact(id: string) {
    try {
      const res = await fetch(`/api/facts/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setFacts((prev) => prev.filter((f) => f.id !== id));
      }
    } catch {
      // Ignore network errors
    }
  }

  return (
    <div
      id="knowledge-view"
      className="flex flex-1 flex-col bg-q-bg h-full overflow-hidden"
    >
      {/* Header bar: 60px chrome */}
      <header className="translucent-chrome flex h-[60px] shrink-0 items-center justify-between border-b border-q-separator px-6 z-10">
        <div>
          <h2 className="text-[17px] font-semibold text-q-text">
            What your agent knows
          </h2>
          <p className="text-[12px] text-q-text-2">
            Facts your agent uses to answer friends&apos; agents under your sharing rules
          </p>
        </div>

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="apple-btn flex items-center gap-1.5 rounded-full bg-q-secondary-elevated px-3 py-1.5 text-xs font-medium text-q-text hover:bg-q-separator/50 active:scale-[0.97]"
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
            Back to chats
          </button>
        )}
      </header>

      {/* Content scroll area */}
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl w-full mx-auto space-y-6">
        {/* Form to add fact */}
        <form
          onSubmit={handleAddFact}
          id="add-fact-form"
          className="rounded-[20px] border border-q-separator bg-q-elevated p-4 shadow-xs space-y-3"
        >
          <label
            htmlFor="fact-text-input"
            className="block text-xs font-semibold uppercase tracking-wider text-q-text-2"
          >
            Add a new fact
          </label>

          <textarea
            id="fact-text-input"
            rows={2}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="e.g. Goa trip dates are Nov 10 to Nov 15"
            maxLength={2000}
            className="w-full rounded-xl border border-q-separator bg-q-bg p-3 text-[14px] text-q-text placeholder:text-q-text-3 outline-none focus:border-q-accent focus:ring-1 focus:ring-q-accent transition-all resize-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Sharing rule">
              <span className="text-xs text-q-text-2 mr-1">Rule:</span>
              <button
                type="button"
                onClick={() => setNewRule("share")}
                className={`apple-btn rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  newRule === "share"
                    ? "bg-q-online/15 text-q-online font-semibold border border-q-online/30"
                    : "bg-q-secondary-elevated text-q-text-2 hover:text-q-text"
                }`}
              >
                Share freely
              </button>
              <button
                type="button"
                onClick={() => setNewRule("ask")}
                className={`apple-btn rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  newRule === "ask"
                    ? "bg-q-waiting/15 text-q-waiting font-semibold border border-q-waiting/30"
                    : "bg-q-secondary-elevated text-q-text-2 hover:text-q-text"
                }`}
              >
                Ask me first
              </button>
              <button
                type="button"
                onClick={() => setNewRule("never")}
                className={`apple-btn rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  newRule === "never"
                    ? "bg-q-danger/15 text-q-danger font-semibold border border-q-danger/30"
                    : "bg-q-secondary-elevated text-q-text-2 hover:text-q-text"
                }`}
              >
                Never share
              </button>
            </div>

            <button
              type="submit"
              id="add-fact-submit-btn"
              disabled={isSubmitting || !newText.trim()}
              className="apple-btn rounded-full bg-q-accent px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-q-accent-hover active:scale-[0.97] disabled:opacity-40 transition-all"
            >
              {isSubmitting ? "Adding..." : "Add fact"}
            </button>
          </div>

          {errorMsg && (
            <p className="text-xs text-q-danger pt-1">{errorMsg}</p>
          )}
        </form>

        {/* Facts List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-q-text-2">
              Stored Facts ({facts.length})
            </h3>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 rounded-[16px] bg-q-skeleton animate-pulse" />
              ))}
            </div>
          ) : facts.length > 0 ? (
            <div className="space-y-2" id="facts-items-list">
              {facts.map((fact) => (
                <div
                  key={fact.id}
                  className="flex items-start justify-between gap-3 rounded-[16px] border border-q-separator bg-q-elevated p-3.5 shadow-xs transition-colors hover:border-q-separator/80"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-[14px] text-q-text leading-relaxed break-words">
                      {fact.text}
                    </p>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                          fact.share_rule === "share"
                            ? "bg-q-online/15 text-q-online"
                            : fact.share_rule === "ask"
                            ? "bg-q-waiting/15 text-q-waiting"
                            : "bg-q-danger/15 text-q-danger"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            fact.share_rule === "share"
                              ? "bg-q-online"
                              : fact.share_rule === "ask"
                              ? "bg-q-waiting"
                              : "bg-q-danger"
                          }`}
                        />
                        {fact.share_rule === "share"
                          ? "Share freely"
                          : fact.share_rule === "ask"
                          ? "Ask me first"
                          : "Never share"}
                      </span>
                      <span className="text-[11px] text-q-text-3">
                        {new Date(fact.created_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label={`Delete fact: ${fact.text.slice(0, 20)}`}
                    onClick={() => handleDeleteFact(fact.id)}
                    className="apple-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-q-text-3 hover:bg-q-danger/10 hover:text-q-danger active:scale-[0.97] transition-colors"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center rounded-[20px] border border-dashed border-q-separator p-6 text-center">
              <p className="text-[13px] text-q-text-2">
                No facts added yet. Add what you want your agent to know.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
