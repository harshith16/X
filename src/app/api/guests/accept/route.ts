import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acceptGuestInvite, GuestError } from "@/server/guests/service";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
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
            message: "You must be signed in to accept a guest invite.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    let payload: { token?: string };
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

    const token = (payload.token || "").trim();
    if (!token) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "token is required.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const { conversationId, agent } = await acceptGuestInvite(token, user.id, requestId);

    return NextResponse.json({
      conversation_id: conversationId,
      agent_handle: agent.handle,
      request_id: requestId,
    });
  } catch (err: unknown) {
    if (err instanceof GuestError) {
      return NextResponse.json(
        {
          error: {
            code: err.code,
            message: err.message,
            request_id: requestId,
          },
        },
        { status: err.statusCode },
      );
    }

    logger.error({
      msg: `Unexpected error in POST /api/guests/accept: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to accept guest invite.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
