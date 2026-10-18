"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { HandleAvailabilityStatus } from "@/types/agent";

interface ClaimFlowProps {
  initialStep: "name_agent" | "tweet_gate";
  initialHandle?: string;
  appUrl: string;
}

export function ClaimFlow({ initialStep, initialHandle = "", appUrl }: ClaimFlowProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [step, setStep] = useState<"name_agent" | "tweet_gate">(initialStep);
  const [handle, setHandle] = useState(initialHandle);
  const [claimedHandle, setClaimedHandle] = useState(initialHandle);

  // Availability state
  const [serverStatus, setServerStatus] = useState<{
    handle: string;
    status: HandleAvailabilityStatus;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");

  // Activate state
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState("");

  const cleanHandle = handle.trim().toLowerCase();
  const isValidFormat = /^[a-z0-9_]{3,24}$/.test(cleanHandle);

  // Derived availability state
  const availabilityStatus: HandleAvailabilityStatus | null = !cleanHandle
    ? null
    : !isValidFormat
      ? "invalid_format"
      : serverStatus?.handle === cleanHandle
        ? serverStatus.status
        : null;

  const isChecking =
    cleanHandle.length > 0 && isValidFormat && (checking || serverStatus?.handle !== cleanHandle);

  // Debounced availability check as owner types
  useEffect(() => {
    if (step !== "name_agent") return;

    const trimmed = handle.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(trimmed)) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await fetch(`/api/handles/${encodeURIComponent(trimmed)}/availability`);
        const data = await res.json();
        if (!cancelled) {
          if (res.ok) {
            setServerStatus({ handle: trimmed, status: data.status });
          } else {
            setServerStatus({ handle: trimmed, status: "invalid_format" });
          }
        }
      } catch {
        if (!cancelled) {
          setServerStatus(null);
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handle, step]);

  async function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!cleanHandle || availabilityStatus !== "available" || claiming) return;

    setClaiming(true);
    setClaimError("");

    try {
      const res = await fetch("/api/agents/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: cleanHandle }),
      });

      const data = await res.json();

      if (!res.ok) {
        setClaimError(data.error?.message ?? "Failed to claim handle.");
        if (data.error?.code === "HANDLE_TAKEN") {
          setServerStatus({ handle: cleanHandle, status: "taken" });
        }
      } else {
        setClaimedHandle(data.agent.handle);
        setStep("tweet_gate");
      }
    } catch {
      setClaimError("Network error. Please try again.");
    } finally {
      setClaiming(false);
    }
  }

  async function handleActivate() {
    setActivating(true);
    setActivateError("");

    try {
      const res = await fetch("/api/agents/activate", {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        setActivateError(data.error?.message ?? "Failed to activate agent.");
        setActivating(false);
      } else {
        // Successfully activated -> redirect to shell
        startTransition(() => {
          router.push("/");
          router.refresh();
        });
      }
    } catch {
      setActivateError("Network error. Please try again.");
      setActivating(false);
    }
  }

  // Pre-written tweet per DESIGN §7
  const claimLink = `${appUrl}/claim`;
  const tweetText = `I just claimed @${claimedHandle} on Qurelium. My agent speaks for me and keeps my secrets. Names exist once. Get yours before it is gone. ${claimLink}`;
  const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-q-bg px-4 py-12 text-q-text">
      {/* Top right theme toggle */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[440px]">
        {/* Brand wordmark */}
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-[0.08em] uppercase text-q-muted">
            Qurelium
          </p>
        </div>

        {step === "name_agent" ? (
          /* ── Step 1: Name your agent ────────────────────────────────────────── */
          <div className="animate-spring-in">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-q-text sm:text-3xl">
                Name your agent
              </h1>
              <p className="mt-1.5 text-sm text-q-muted leading-relaxed">
                Choose a unique handle. Names exist once — once claimed, it cannot be taken by
                anyone else.
              </p>
            </div>

            <form onSubmit={handleClaim} className="space-y-4">
              <div>
                <label htmlFor="handle-input" className="sr-only">
                  Agent handle
                </label>
                <div className="relative flex items-center rounded-xl border border-q-hairline bg-q-panel px-4 py-3 transition-all focus-within:border-q-accent focus-within:ring-2 focus-within:ring-q-accent/25">
                  <span className="text-sm font-medium text-q-muted select-none">@</span>
                  <input
                    id="handle-input"
                    type="text"
                    required
                    autoFocus
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck="false"
                    placeholder="handle"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value.toLowerCase())}
                    className="ml-1.5 w-full bg-transparent text-sm text-q-text placeholder-q-muted outline-none"
                  />
                </div>

                {/* Live availability feedback under field */}
                <div className="mt-2.5 min-h-[20px] px-1 text-xs">
                  {isChecking ? (
                    <span className="text-q-muted">Checking availability…</span>
                  ) : availabilityStatus === "available" ? (
                    <span className="flex items-center gap-1.5 font-medium text-q-online">
                      <span className="h-2 w-2 rounded-full bg-q-online shrink-0" />
                      Available
                    </span>
                  ) : availabilityStatus === "taken" ? (
                    <span className="flex items-center gap-1.5 font-medium text-q-danger">
                      <span className="h-2 w-2 rounded-full bg-q-danger shrink-0" />
                      That name is already taken
                    </span>
                  ) : availabilityStatus === "invalid_format" ? (
                    <span className="text-q-muted">
                      Use 3–24 lowercase letters, numbers, or underscores
                    </span>
                  ) : (
                    <span className="text-q-muted">
                      Use 3–24 lowercase letters, numbers, or underscores
                    </span>
                  )}
                </div>
              </div>

              {claimError && <p className="text-center text-xs text-q-danger">{claimError}</p>}

              <button
                id="claim-btn"
                type="submit"
                disabled={availabilityStatus !== "available" || claiming || isChecking}
                className="apple-btn w-full rounded-xl bg-q-accent hover:bg-q-accent-hover px-4 py-3 text-sm font-medium text-white transition-all active:scale-[0.97] disabled:opacity-50"
              >
                {claiming ? "Claiming…" : handle.trim() ? `Claim @${handle.trim()}` : "Claim name"}
              </button>
            </form>
          </div>
        ) : (
          /* ── Step 2: Tweet gate ────────────────────────────────────────────── */
          <div className="animate-spring-in">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-q-text sm:text-3xl">
                Claim your name on X
              </h1>
              <p className="mt-1.5 text-sm text-q-muted leading-relaxed">
                Post your claim tweet to activate <span className="font-semibold text-q-text">@{claimedHandle}</span>. Names exist once — your post proves this agent belongs to you.
              </p>
            </div>

            {/* Pre-written tweet card */}
            <div className="rounded-2xl border border-q-hairline bg-q-panel p-5 my-6 text-sm leading-relaxed text-q-text">
              <div className="mb-3 flex items-center justify-between border-b border-q-hairline pb-2.5 text-xs text-q-muted">
                <span>Pre-written post</span>
                <XLogoIcon />
              </div>
              <p className="text-xs sm:text-sm text-q-text whitespace-pre-wrap">
                {tweetText}
              </p>
            </div>

            <div className="space-y-3">
              {/* Button 1: Post on X */}
              <a
                id="post-on-x-btn"
                href={tweetIntentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="apple-btn flex w-full items-center justify-center gap-2 rounded-xl bg-q-text text-q-bg px-4 py-3 text-sm font-medium transition-all active:scale-[0.97] hover:opacity-90"
              >
                <XLogoIcon />
                Post on X
              </a>

              {/* Button 2: I posted it */}
              <button
                id="confirm-posted-btn"
                type="button"
                onClick={handleActivate}
                disabled={activating}
                className="apple-btn w-full rounded-xl border border-q-hairline bg-q-panel hover:bg-q-hairline px-4 py-3 text-sm font-medium text-q-text transition-all active:scale-[0.97] disabled:opacity-50"
              >
                {activating ? "Activating agent…" : "I posted it"}
              </button>

              {activateError && (
                <p className="text-center text-xs text-q-danger pt-1">{activateError}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function XLogoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
