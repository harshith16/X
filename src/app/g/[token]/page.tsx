export const instant = false;

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getInviteByToken, acceptGuestInvite } from "@/server/guests/service";
import { newRequestId } from "@/lib/logger";
import { LoginForm } from "@/app/login/LoginForm";

interface GuestInvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function GuestInvitePage({ params }: GuestInvitePageProps) {
  await connection();
  const { token } = await params;
  const requestId = newRequestId();

  const { invite, status, agent } = await getInviteByToken(token);

  // 1. Invalid / expired / revoked token -> plain human page stating so, no chat UI
  if (status === "not_found" || !invite) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-q-bg px-4 py-12 text-q-text">
        <div className="w-full max-w-[420px] rounded-2xl border border-q-hairline bg-q-panel p-8 text-center shadow-sm">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-q-subtle text-q-muted">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-q-text">Invalid guest link</h1>
          <p className="mt-2 text-sm text-q-muted leading-relaxed">
            This guest link is invalid or does not exist. Please ask the agent owner for a new invite link.
          </p>
        </div>
      </main>
    );
  }

  if (status === "expired") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-q-bg px-4 py-12 text-q-text">
        <div className="w-full max-w-[420px] rounded-2xl border border-q-hairline bg-q-panel p-8 text-center shadow-sm">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-q-subtle text-q-muted">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-q-text">Guest link expired</h1>
          <p className="mt-2 text-sm text-q-muted leading-relaxed">
            This guest link has expired. Guest links are active for 7 days. Ask the agent owner to send a new invite.
          </p>
        </div>
      </main>
    );
  }

  if (status === "revoked") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-q-bg px-4 py-12 text-q-text">
        <div className="w-full max-w-[420px] rounded-2xl border border-q-hairline bg-q-panel p-8 text-center shadow-sm">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-q-subtle text-q-danger">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-q-text">Guest link revoked</h1>
          <p className="mt-2 text-sm text-q-muted leading-relaxed">
            This guest link has been revoked by the owner.
          </p>
        </div>
      </main>
    );
  }

  // 2. Check authenticated user
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If not signed in: show standard sign-in with clear invite context
  if (!user) {
    return (
      <div className="min-h-screen bg-q-bg">
        <div className="border-b border-q-hairline bg-q-panel px-4 py-3 text-center text-sm font-medium text-q-text">
          You&apos;re chatting with @{agent?.handle || "agent"}&apos;s agent
          <span className="block text-xs font-normal text-q-muted mt-0.5">
            Sign in to accept this invitation and begin
          </span>
        </div>
        <LoginForm
          showDevLogin={
            process.env.DEV_TEST_LOGIN === "true" && process.env.NODE_ENV !== "production"
          }
        />
      </div>
    );
  }

  // 3. User is signed in -> bind invite and redirect to chat
  try {
    const { conversationId } = await acceptGuestInvite(token, user.id, requestId);
    redirect(`/g/chat?c=${conversationId}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to accept invite";
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-q-bg px-4 py-12 text-q-text">
        <div className="w-full max-w-[420px] rounded-2xl border border-q-hairline bg-q-panel p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight text-q-text">Cannot accept invite</h1>
          <p className="mt-2 text-sm text-q-muted leading-relaxed">{msg}</p>
        </div>
      </main>
    );
  }
}
