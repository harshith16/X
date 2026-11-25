export const instant = false;

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/server/db/clients";
import { getGuestConversationContext } from "@/server/guests/service";
import { GuestChatView } from "./GuestChatView";

interface GuestChatPageProps {
  searchParams: Promise<{ c?: string }>;
}

export default async function GuestChatPage({ searchParams }: GuestChatPageProps) {
  await connection();
  const { c: conversationId } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const db = getServiceClient();
  let targetConversationId = conversationId;

  // If no conversationId provided in URL, look up the user's active guest conversation
  if (!targetConversationId) {
    try {
      const { data } = await db
        .from("conversations")
        .select("id")
        .eq("kind", "guest")
        .eq("guest_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        targetConversationId = data.id;
      }
    } catch {}
  }

  if (!targetConversationId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-q-bg px-4 py-12 text-q-text">
        <div className="w-full max-w-[420px] rounded-2xl border border-q-hairline bg-q-panel p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight text-q-text">No active guest conversation</h1>
          <p className="mt-2 text-sm text-q-muted leading-relaxed">
            You don&apos;t have an active guest chat thread. Please use the link provided by the agent owner.
          </p>
        </div>
      </main>
    );
  }

  // Server-enforced isolation check
  const guestCtx = await getGuestConversationContext(targetConversationId, user.id);
  if (!guestCtx) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-q-bg px-4 py-12 text-q-text">
        <div className="w-full max-w-[420px] rounded-2xl border border-q-hairline bg-q-panel p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight text-q-text">Access forbidden</h1>
          <p className="mt-2 text-sm text-q-muted leading-relaxed">
            You do not have permission to view or participate in this conversation.
          </p>
        </div>
      </main>
    );
  }

  // Get agent handle
  let agentHandle = "agent";
  try {
    const { data: agent } = await db
      .from("agents")
      .select("handle")
      .eq("id", guestCtx.agentId)
      .maybeSingle();
    if (agent?.handle) {
      agentHandle = agent.handle;
    }
  } catch {}

  return (
    <GuestChatView
      conversationId={targetConversationId}
      agentHandle={agentHandle}
      guestUserId={user.id}
    />
  );
}
