import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  acceptContactInvite,
  resolveContactInvite,
  ContactError,
} from "@/server/contacts/service";
import { AcceptInviteSchema } from "@/types/contact";
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
            message: "You must be signed in to accept an invite link.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid JSON request body.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const parsed = AcceptInviteSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: parsed.error.issues[0]?.message || "Token is required.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const result = await acceptContactInvite(parsed.data.token, user.id, requestId);

    return NextResponse.json(
      {
        ...result,
        request_id: requestId,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    if (err instanceof ContactError) {
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
      msg: `Unexpected error in POST /api/contacts/invite/accept: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "SERVER_ERROR",
          message: "An unexpected error occurred while accepting contact invite.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
