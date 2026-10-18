export const instant = false;

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerAgent } from "@/server/identity/claim";
import { ClaimFlow } from "./ClaimFlow";
import { newRequestId } from "@/lib/logger";

export default async function ClaimPage() {
  await connection();
  const requestId = newRequestId();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Check if owner already has an agent
  const agent = await getOwnerAgent(user.id, requestId);

  // If already active, go directly to shell
  if (agent && agent.status === "active") {
    redirect("/");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <ClaimFlow
      initialStep={
        agent?.status === "pending_claim" ? "tweet_gate" : "name_agent"
      }
      initialHandle={agent?.handle ?? ""}
      appUrl={appUrl}
    />
  );
}
