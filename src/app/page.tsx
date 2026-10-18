export const instant = false;

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerAgent } from "@/server/identity/claim";
import { newRequestId } from "@/lib/logger";
import { getOwnerConversations, isAgentOnline } from "@/server/relay/service";
import { ShellLayout } from "@/components/shell/ShellLayout";

export default async function ShellPage() {
  await connection();
  const requestId = newRequestId();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards this, but double-check defensively.
  if (!user) {
    redirect("/login");
  }

  // 1. Landing: signed-in owner with NO agent row → / redirects to /claim.
  const agent = await getOwnerAgent(user.id, requestId);
  if (!agent) {
    redirect("/claim");
  }

  const email = user.email ?? "";
  const isOnline = isAgentOnline(agent);
  const conversations = await getOwnerConversations(user.id, requestId);

  return (
    <ShellLayout
      ownerEmail={email}
      agent={{
        id: agent.id,
        handle: agent.handle,
        status: agent.status,
        isOnline,
      }}
      initialConversations={conversations}
    />
  );
}
