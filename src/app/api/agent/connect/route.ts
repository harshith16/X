import { NextResponse, type NextRequest } from "next/server";
import { redeemConnectCode, RelayError } from "@/server/relay/service";
import { ConnectAgentRequestSchema } from "@/types/relay";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "CLAIM_CODE_INVALID",
            message: "Invalid JSON payload.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const parseResult = ConnectAgentRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: "CLAIM_CODE_INVALID",
            message: parseResult.error.issues[0]?.message ?? "Invalid connect code.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const result = await redeemConnectCode(parseResult.data.code, requestId);

    return NextResponse.json(
      {
        ok: true,
        agent_id: result.agent_id,
        handle: result.handle,
        credential: result.credential,
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
      msg: `Unexpected error during agent connect: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to connect agent.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
