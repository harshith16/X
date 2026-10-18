import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerConversations, RelayError } from "@/server/relay/service";
import { newRequestId, logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
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
            message: "You must be signed in to view conversations.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const conversations = await getOwnerConversations(user.id, requestId);

    return NextResponse.json(
      {
        ok: true,
        conversations,
        request_id: requestId,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    if (err instanceof RelayError) {
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
      msg: `Unexpected error fetching owner conversations: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch conversations.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
