import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/server/db/clients";
import { getGuestConversationContext } from "@/server/guests/service";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();
  const { id: conversationId } = await context.params;

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
            message: "You must be signed in to send guest messages.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    // Server-enforced isolation check: Guest can ONLY access their own conversation
    const guestCtx = await getGuestConversationContext(conversationId, user.id);
    if (!guestCtx) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "You do not have permission to access this conversation.",
            request_id: requestId,
          },
        },
        { status: 403 },
      );
    }

    let payload: { body?: string; idempotency_key?: string };
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid JSON payload.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const messageBody = (payload.body || "").trim();
    if (!messageBody) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Message body cannot be empty.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const idempotencyKey =
      payload.idempotency_key ||
      request.headers.get("Idempotency-Key") ||
      `guest_idemp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Check if the invite is revoked
    if (guestCtx.inviteId) {
      const { isGuestInviteRevoked } = await import("@/server/guests/service");
      const isRevoked = await isGuestInviteRevoked(guestCtx.inviteId);
      if (isRevoked) {
        return NextResponse.json(
          {
            error: {
              code: "INVITE_REVOKED",
              message: "This guest conversation has been closed by the owner.",
              request_id: requestId,
            },
          },
          { status: 403 },
        );
      }
    }

    const { RelayStore } = await import("@/server/relay/store");
    const storedMsg = await RelayStore.insertMessage(
      conversationId,
      null,
      messageBody,
      idempotencyKey,
      user.id,
    );

    // Notify agent inbox if waiting
    try {
      const globalForService = globalThis as any;
      if (globalForService.__relayInboxEvents && guestCtx.agentId) {
        globalForService.__relayInboxEvents.emit(`msg:${guestCtx.agentId}`, storedMsg);
      }
    } catch {}

    return NextResponse.json(
      {
        message_id: storedMsg.id,
        seq: storedMsg.seq,
        status: storedMsg.status,
        request_id: requestId,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    logger.error({
      msg: `Unexpected error sending guest message: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to process message.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();
  const { id: conversationId } = await context.params;

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
            message: "You must be signed in to view guest messages.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    // Server-enforced isolation check
    const guestCtx = await getGuestConversationContext(conversationId, user.id);
    if (!guestCtx) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "You do not have permission to access this conversation.",
            request_id: requestId,
          },
        },
        { status: 403 },
      );
    }

    // Query messages via RelayStore (never return blocked messages to guests)
    const { RelayStore } = await import("@/server/relay/store");
    const msgs = await RelayStore.getMessagesForConversation(conversationId);
    const allowedMsgs = msgs
      .filter((m) => m.status !== "blocked")
      .slice(0, 50)
      .map((m) => ({
        id: m.id,
        seq: m.seq,
        sender: m.sender_owner_id === user.id ? ("own" as const) : ("theirs" as const),
        body: m.body,
        status: m.status,
        created_at: m.created_at,
      }));

    return NextResponse.json({
      messages: allowedMsgs,
      request_id: requestId,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to retrieve messages.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
