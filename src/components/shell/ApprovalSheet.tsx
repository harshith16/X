"use client";

import { useState, useEffect } from "react";
import { ApprovalRecord } from "@/types/brain";

interface ApprovalSheetProps {
  approvals?: ApprovalRecord[];
  onResolved?: (approvalId: string, decision: "share" | "not_now" | "never") => void;
}

export function ApprovalSheet({
  approvals: initialApprovals,
  onResolved,
}: ApprovalSheetProps) {
  const [approvals, setApprovals] = useState<ApprovalRecord[]>(initialApprovals || []);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Poll for pending approvals if not provided
  useEffect(() => {
    let isCancelled = false;

    async function loadApprovals() {
      try {
        const res = await fetch("/api/approvals");
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled && data.approvals) {
            setApprovals(data.approvals);
          }
        }
      } catch {
        // Ignore network error
      }
    }

    loadApprovals();
    const interval = setInterval(loadApprovals, 5000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, []);

  const activeApproval = approvals.length > 0 ? approvals[0] : null;

  if (!activeApproval) {
    return null;
  }

  async function handleDecision(decision: "share" | "not_now" | "never") {
    if (!activeApproval || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/approvals/${activeApproval.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });

      if (res.ok) {
        setApprovals((prev) => prev.filter((a) => a.id !== activeApproval.id));
        onResolved?.(activeApproval.id, decision);
      }
    } catch {
      // Ignore error
    } finally {
      setIsSubmitting(false);
    }
  }

  // Format question humanly per docs/DESIGN.md §5:
  // e.g. "Rohan's agent is asking about your Goa trip dates. Share?"
  const questionText = activeApproval.question.endsWith("?")
    ? activeApproval.question
    : `${activeApproval.question}?`;

  return (
    <div
      id="approval-sheet-overlay"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-q-scrim p-4 transition-opacity backdrop-blur-xs"
    >
      <div
        id="approval-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-sheet-title"
        className="animate-spring-in w-full max-w-md rounded-[24px] border border-q-separator bg-q-elevated p-6 shadow-2xl translucent-chrome"
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-q-waiting/15 text-q-waiting">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-q-text-2">
            Agent Sharing Request
          </span>
        </div>

        <h3
          id="approval-sheet-title"
          className="text-[17px] font-semibold leading-snug text-q-text"
        >
          {questionText}
        </h3>

        <p className="mt-2 text-[13px] leading-relaxed text-q-text-2">
          Your agent needs your permission to answer this question.
        </p>

        {/* 3 Human Buttons: Share / Not now / Never per docs/DESIGN.md §5 */}
        <div className="mt-6 flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            id="approval-share-btn"
            disabled={isSubmitting}
            onClick={() => handleDecision("share")}
            className="apple-btn flex-1 rounded-full bg-q-accent py-2.5 px-4 text-center text-sm font-semibold text-white shadow-xs hover:bg-q-accent-hover active:scale-[0.97] transition-all disabled:opacity-40"
          >
            Share
          </button>

          <button
            type="button"
            id="approval-not-now-btn"
            disabled={isSubmitting}
            onClick={() => handleDecision("not_now")}
            className="apple-btn flex-1 rounded-full bg-q-secondary-elevated py-2.5 px-4 text-center text-sm font-medium text-q-text hover:bg-q-separator/50 active:scale-[0.97] transition-all disabled:opacity-40"
          >
            Not now
          </button>

          <button
            type="button"
            id="approval-never-btn"
            disabled={isSubmitting}
            onClick={() => handleDecision("never")}
            className="apple-btn rounded-full py-2.5 px-4 text-center text-sm font-medium text-q-danger hover:bg-q-danger/10 active:scale-[0.97] transition-all disabled:opacity-40"
          >
            Never
          </button>
        </div>
      </div>
    </div>
  );
}
