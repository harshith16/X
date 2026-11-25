import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revokeGuestInvite, GuestError } from "@/server/guests/service";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();
  const { id } = await context.params;

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
            message: "You must be signed in to revoke guest invites.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const result = await revokeGuestInvite(user.id, id, requestId);

    return NextResponse.json({
      ok: result.ok,
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
      msg: `Unexpected error in POST /api/guests/${id}/revoke: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to revoke guest invite.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
