import { NextResponse, type NextRequest } from "next/server";
import { authenticateAgent, sendMessage, RelayError } from "@/server/relay/service";
import { SendMessageRequestSchema } from "@/types/relay";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    const authHeader = request.headers.get("authorization");
    const agent = await authenticateAgent(authHeader, requestId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid JSON payload.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const parseResult = SendMessageRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: parseResult.error.issues[0]?.message ?? "Invalid message request.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const result = await sendMessage(
      agent,
      parseResult.data.to_handle,
      parseResult.data.body,
      parseResult.data.idempotency_key,
      requestId,
    );

    return NextResponse.json(
      {
        ok: true,
        message_id: result.message_id,
        status: result.status,
        conversation_id: result.conversation_id,
        seq: result.seq,
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
      msg: `Unexpected error sending message: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to send message.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
