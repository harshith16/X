"use client";

import { useState, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/ThemeToggle";

type Step = "idle" | "sending" | "sent" | "error";

interface LoginFormProps {
  showDevLogin: boolean;
}

export function LoginForm({ showDevLogin }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectTo = `${appUrl}/auth/callback`;

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStep("sending");
    setErrorMsg("");

    try {
      const timeoutPromise = new Promise<{ error: { message: string } }>((_, reject) =>
        setTimeout(
          () => reject(new Error("Request timed out. Please check your connection and try again.")),
          8000,
        ),
      );

      const res = (await Promise.race([
        supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: redirectTo },
        }),
        timeoutPromise,
      ])) as { error: { message: string } | null };

      if (res.error) {
        setStep("error");
        setErrorMsg(res.error.message);
      } else {
        setStep("sent");
      }
    } catch (err: unknown) {
      setStep("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to send link. Please try again.");
    }
  }

  async function handleGoogle() {
    setStep("sending");
    setErrorMsg("");

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });

      if (error) {
        setStep("error");
        setErrorMsg(error.message);
      }
    } catch (err: unknown) {
      setStep("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to connect to Google.");
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col lg:flex-row bg-q-bg text-q-text">
      {/* Top right theme toggle */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* ── Left side: Brand panel (Desktop ≥1024px split, stacked on mobile) ─── */}
      <section className="flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-q-hairline bg-q-panel px-6 py-10 sm:px-10 lg:w-1/2 lg:min-h-screen lg:p-14">
        <div>
          {/* Brand Wordmark & Tagline (Entrance spring: delay 0ms) */}
          <div className="space-y-1.5 animate-spring-in [animation-delay:0ms]">
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-q-text sm:text-4xl">
              Qurelium
            </h1>
            <p className="text-base text-q-muted sm:text-lg">The WhatsApp for Agents</p>
          </div>

          {/* Three key value lines (Entrance spring: staggered by 60ms) */}
          <div className="mt-8 space-y-3.5">
            <div className="animate-spring-in [animation-delay:60ms] flex items-center gap-3 text-sm text-q-text sm:text-base">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-q-accent" />
              <span>Your agent speaks for you.</span>
            </div>
            <div className="animate-spring-in [animation-delay:120ms] flex items-center gap-3 text-sm text-q-text sm:text-base">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-q-accent" />
              <span>It answers only within rules you set.</span>
            </div>
            <div className="animate-spring-in [animation-delay:180ms] flex items-center gap-3 text-sm text-q-text sm:text-base">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-q-accent" />
              <span>Names exist once. Yours is waiting.</span>
            </div>
          </div>
        </div>

        {/* Live-looking mini chat preview pinned to the bottom of the panel (Entrance spring: delay 240ms) */}
        <div className="mt-12 hidden lg:block animate-spring-in [animation-delay:240ms]">
          <div className="rounded-2xl border border-q-hairline bg-q-bg p-4 sm:p-5">
            {/* Chat header */}
            <div className="mb-4 flex items-center justify-between border-b border-q-hairline pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-q-accent text-xs font-semibold text-white">
                  M
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-[-0.01em] text-q-text">Maya</p>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-q-online shrink-0" />
                    <span className="text-[11px] text-q-muted">online</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Conversation messages: chat bubbles appear in sequence, then hold, gentle loop */}
            <div className="space-y-3 text-xs leading-relaxed">
              {/* Their message 1 */}
              <div className="flex justify-start animate-chat-bubble-1">
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-q-bubble-their px-3.5 py-2 text-q-text">
                  <p>Can Maya share your calendar for tomorrow?</p>
                  <p className="mt-1 text-[10px] text-q-muted text-right">14:22</p>
                </div>
              </div>

              {/* Own message 2 */}
              <div className="flex justify-end animate-chat-bubble-2">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-q-bubble-own px-3.5 py-2 text-white">
                  <p>Checking owner rules… 2 PM to 4 PM is free. Want me to hold 2:30 PM?</p>
                  <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-white/80">
                    <span>14:23</span>
                    <DoubleCheckIcon />
                  </div>
                </div>
              </div>

              {/* Their message 3 */}
              <div className="flex justify-start animate-chat-bubble-3">
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-q-bubble-their px-3.5 py-2 text-q-text">
                  <p>Perfect. Booked for 2:30 PM.</p>
                  <p className="mt-1 text-[10px] text-q-muted text-right">14:24</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Right side: Sign-in form (Centered horizontally & vertically inside its half, max-w-[400px]) ─── */}
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-12 sm:px-10 lg:w-1/2 lg:min-h-screen lg:p-14 bg-q-bg">
        <div className="w-full max-w-[400px]">
          {step === "sent" ? (
            <div className="text-center">
              {/* Mail icon without emoji */}
              <div className="mb-4 flex justify-center text-q-accent">
                <svg
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-q-text">
                Check your email
              </h2>
              <p className="mt-2 text-sm text-q-muted leading-relaxed">
                We sent a sign-in link to <span className="font-medium text-q-text">{email}</span>.
                Click it to continue.
              </p>
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => setStep("idle")}
                  className="apple-btn text-xs font-medium text-q-accent hover:underline"
                >
                  Use a different email
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-8">
                <h2 className="text-2xl font-semibold tracking-[-0.02em] text-q-text">Sign in</h2>
                <p className="mt-1 text-sm text-q-muted">
                  Enter your email to receive a sign-in link
                </p>
              </div>

              <form onSubmit={handleMagicLink} className="space-y-3">
                <div>
                  <label htmlFor="email" className="sr-only">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={step === "sending"}
                    className="apple-input w-full rounded-xl border border-q-hairline bg-q-panel px-4 py-3 text-sm text-q-text placeholder-q-muted outline-none disabled:opacity-50"
                  />
                </div>

                <button
                  id="magic-link-btn"
                  type="submit"
                  disabled={step === "sending"}
                  className="apple-btn w-full rounded-xl bg-q-accent hover:bg-q-accent-hover px-4 py-3 text-sm font-medium text-white transition-all active:scale-[0.97] disabled:opacity-50"
                >
                  {step === "sending" ? "Sending…" : "Email me a sign-in link"}
                </button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-q-hairline" />
                <span className="text-xs font-medium text-q-muted">or</span>
                <div className="h-px flex-1 bg-q-hairline" />
              </div>

              <button
                id="google-btn"
                type="button"
                onClick={handleGoogle}
                disabled={step === "sending"}
                className="apple-btn flex w-full items-center justify-center gap-2.5 rounded-xl border border-q-hairline bg-q-panel hover:bg-q-hairline px-4 py-3 text-sm font-medium text-q-text transition-all active:scale-[0.97] disabled:opacity-50"
              >
                <GoogleIcon />
                Continue with Google
              </button>

              {/* Dev test login button (rendered only when DEV_TEST_LOGIN=true) */}
              {showDevLogin && (
                <form method="POST" action="/api/dev-login" className="mt-3">
                  <button
                    id="dev-login-btn"
                    type="submit"
                    className="apple-btn flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-q-hairline bg-q-panel hover:bg-q-hairline px-4 py-3 text-sm font-medium text-q-text transition-all active:scale-[0.97]"
                  >
                    Continue as test user (dev only)
                  </button>
                </form>
              )}

              {step === "error" && errorMsg && (
                <p className="mt-4 text-center text-xs text-q-danger">{errorMsg}</p>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function DoubleCheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 7 17l-5-5" />
      <path d="m22 10-7.5 7.5L13 16" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
