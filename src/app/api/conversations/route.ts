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

    const { getOwnerAgent } = await import("@/server/identity/claim");
    const agent = await getOwnerAgent(user.id, requestId);
    if (!agent) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Guest accounts cannot list owner conversations.",
            request_id: requestId,
          },
        },
        { status: 403 },
      );
    }

    const conversations = await getOwnerConversations(user.id, requestId);
    const main = conversations.filter((c: any) => !c.is_request);
    const requests = conversations.filter((c: any) => Boolean(c.is_request));

    return NextResponse.json(
      {
        ok: true,
        conversations,
        main,
        requests,
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
