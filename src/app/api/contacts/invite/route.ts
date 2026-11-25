import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createContactInvite, ContactError } from "@/server/contacts/service";
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
            message: "You must be signed in to create an invite link.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const invite = await createContactInvite(user.id, requestId, appUrl);

    return NextResponse.json(
      {
        ok: true,
        ...invite,
        request_id: requestId,
      },
      { status: 201 },
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
      msg: `Unexpected error in POST /api/contacts/invite: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "SERVER_ERROR",
          message: "An unexpected error occurred while creating contact invite.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
