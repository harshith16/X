import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createGuestInvite,
  getOwnerGuestInvites,
  GuestError,
} from "@/server/guests/service";
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
            message: "You must be signed in to create guest invites.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    let expiresAtOverride: string | undefined;
    try {
      const body = await request.json();
      if (body?.test_expired && process.env.NODE_ENV !== "production") {
        expiresAtOverride = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      }
    } catch {}

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const { invite, rawToken } = await createGuestInvite(
      user.id,
      requestId,
      appUrl,
      undefined,
      expiresAtOverride,
    );

    return NextResponse.json(
      {
        invite: {
          ...invite,
          token: rawToken,
        },
        request_id: requestId,
      },
      { status: 201 },
    );
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
      msg: `Unexpected error in POST /api/guests: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred while creating a guest invite.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}

export async function GET() {
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
            message: "You must be signed in to view guest invites.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const { getOwnerAgent } = await import("@/server/identity/claim");
    const agent = await getOwnerAgent(user.id, requestId);
    if (!agent) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Guest accounts cannot list owner invites.",
            request_id: requestId,
          },
        },
        { status: 403 },
      );
    }

    const invites = await getOwnerGuestInvites(user.id, requestId);

    return NextResponse.json({
      items: invites,
      request_id: requestId,
    });
  } catch (err: unknown) {
    logger.error({
      msg: `Unexpected error in GET /api/guests: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to retrieve guest invites.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
