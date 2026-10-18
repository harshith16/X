import { NextResponse, type NextRequest } from "next/server";
import { authenticateAgent, markMessageRead, RelayError } from "@/server/relay/service";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();

  try {
    const authHeader = request.headers.get("authorization");
    const agent = await authenticateAgent(authHeader, requestId);
    const { id } = await params;

    const result = await markMessageRead(agent.id, id, requestId);

    return NextResponse.json(
      {
        ok: true,
        status: result.status,
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
      msg: `Unexpected error marking message read: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to mark message as read.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
