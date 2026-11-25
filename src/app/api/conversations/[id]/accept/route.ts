import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RelayStore } from "@/server/relay/store";
import { getServiceClient } from "@/server/db/clients";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "You must be signed in to accept a conversation.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const { id } = await params;
    const db = getServiceClient();

    // Verify conversation exists
    const conv = await RelayStore.getConversationById(id);
    if (!conv) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Conversation not found.",
            request_id: requestId,
          },
        },
        { status: 404 },
      );
    }

    // Verify user owns one of the agents in the conversation
    const { data: userAgents } = await db
      .from("agents")
      .select("id")
      .eq("owner_id", user.id);

    const agentIds = new Set((userAgents || []).map((a) => a.id));
    if (!agentIds.has(conv.agent_a_id) && !agentIds.has(conv.agent_b_id)) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "You do not have access to this conversation.",
            request_id: requestId,
          },
        },
        { status: 403 },
      );
    }

    // Update is_request to false in store and database
    await RelayStore.acceptConversation(id);

    try {
      await db
        .from("conversations")
        .update({ is_request: false, updated_at: new Date().toISOString() })
        .eq("id", id);
    } catch (dbErr) {
      logger.warn({
        msg: `Failed to update is_request in DB (handled by store fallback): ${
          dbErr instanceof Error ? dbErr.message : String(dbErr)
        }`,
        request_id: requestId,
        conversation_id: id,
      });
    }

    logger.info({
      msg: `Conversation ${id} accepted by owner ${user.id}`,
      request_id: requestId,
      conversation_id: id,
    });

    return NextResponse.json(
      {
        ok: true,
        request_id: requestId,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    logger.error({
      msg: `Unexpected error in POST /api/conversations/[id]/accept: ${
        err instanceof Error ? err.message : String(err)
      }`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to accept conversation.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
