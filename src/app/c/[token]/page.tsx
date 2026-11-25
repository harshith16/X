export const instant = false;

import Link from "next/link";
import { connection } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveContactInvite } from "@/server/contacts/service";
import { LoginForm } from "@/app/login/LoginForm";
import { ContactInviteClient } from "./ContactInviteClient";

interface ContactInvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function ContactInvitePage({ params }: ContactInvitePageProps) {
  await connection();
  const { token } = await params;

  // 1. Resolve invite status
  const resolution = await resolveContactInvite(token);

  // Invalid / expired / revoked / already used -> plain human page, no UI dead-ends
  if (resolution.status !== "valid") {
    let title = "Invalid invite link";
    let message = resolution.message;

    if (resolution.status === "expired") {
      title = "Invite link expired";
      message = "This contact invite link has expired. Invite links are valid for 7 days. Ask for a new invite link.";
    } else if (resolution.status === "revoked") {
      title = "Invite link revoked";
      message = "This contact invite link was revoked by the sender.";
    } else if (resolution.status === "used") {
      title = "Invite link already used";
      message = "This one-time contact invite link has already been used and cannot be claimed again.";
    }

    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-q-bg px-4 py-12 text-q-text">
        <div className="w-full max-w-[420px] rounded-2xl border border-q-separator bg-q-panel p-8 text-center shadow-sm">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-q-secondary-elevated text-q-text-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-q-text">{title}</h1>
          <p className="mt-2 text-sm text-q-text-2 leading-relaxed">{message}</p>
          <div className="mt-6">
            <Link
              href="/"
              id="go-to-chats-btn"
              className="apple-btn inline-flex h-10 w-full items-center justify-center rounded-xl bg-q-accent text-sm font-medium text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
            >
              Return to Qurelium
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // 2. Check authenticated user
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If not signed in: show sign-in with clear context
  if (!user) {
    return (
      <div className="min-h-screen bg-q-bg">
        <div className="border-b border-q-separator bg-q-panel px-4 py-3 text-center text-sm font-medium text-q-text">
          Add @{resolution.inviterHandle} as a contact on Qurelium
          <span className="block text-xs font-normal text-q-text-2 mt-0.5">
            Sign in to accept this invitation and connect your agents
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

  const isSelf = user.id === resolution.inviterOwnerId;

  return (
    <ContactInviteClient
      token={token}
      inviterHandle={resolution.inviterHandle}
      inviterDisplayName={resolution.inviterDisplayName}
      currentUserEmail={user.email || ""}
      isSelf={isSelf}
    />
  );
}
