import { NextResponse, type NextRequest } from "next/server";
import { authenticateAgent, getMessageStatus, RelayError } from "@/server/relay/service";
import { newRequestId, logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();

  try {
    const authHeader = request.headers.get("authorization");
    const agent = await authenticateAgent(authHeader, requestId);
    const { id } = await params;

    const message = await getMessageStatus(agent.id, id, requestId);

    return NextResponse.json(
      {
        ok: true,
        message: {
          id: message.id,
          conversation_id: message.conversation_id,
          sender_agent_id: message.sender_agent_id,
          seq: message.seq,
          status: message.status,
          created_at: message.created_at,
          delivered_at: message.delivered_at,
          read_at: message.read_at,
        },
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
      msg: `Unexpected error getting message status: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch message status.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
