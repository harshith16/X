import { NextResponse, type NextRequest } from "next/server";
import { authenticateAgent, recordHeartbeat, RelayError } from "@/server/relay/service";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const authHeader = request.headers.get("authorization");
    const agent = await authenticateAgent(authHeader, requestId);

    const result = await recordHeartbeat(agent.id, requestId);

    return NextResponse.json(
      {
        ok: true,
        server_time: result.server_time,
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
      msg: `Unexpected error during agent heartbeat: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to record heartbeat.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
