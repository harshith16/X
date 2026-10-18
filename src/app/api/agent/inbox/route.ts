import { NextResponse, type NextRequest } from "next/server";
import { authenticateAgent, getInbox, RelayError } from "@/server/relay/service";
import { InboxQuerySchema } from "@/types/relay";
import { newRequestId, logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const authHeader = request.headers.get("authorization");
    const agent = await authenticateAgent(authHeader, requestId);

    const { searchParams } = new URL(request.url);
    const queryObj = {
      cursor: searchParams.get("cursor") || undefined,
      wait_seconds: searchParams.has("wait_seconds")
        ? Number(searchParams.get("wait_seconds"))
        : 0,
      limit: searchParams.has("limit") ? Number(searchParams.get("limit")) : 50,
    };

    const parseResult = InboxQuerySchema.safeParse(queryObj);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: parseResult.error.issues[0]?.message ?? "Invalid query parameters.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const { cursor, wait_seconds, limit } = parseResult.data;
    const result = await getInbox(agent, cursor, wait_seconds, limit, requestId);

    return NextResponse.json(
      {
        ok: true,
        messages: result.messages,
        next_cursor: result.next_cursor,
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
      msg: `Unexpected error in agent inbox: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch inbox messages.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
