import { NextResponse, type NextRequest } from "next/server";
import { authenticateAgent, RelayError } from "@/server/relay/service";
import { thinkAgent } from "@/server/brain/think";
import { ThinkRequestSchema } from "@/types/brain";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    // 1. Authenticate agent via Bearer credential
    const agent = await authenticateAgent(request.headers.get("authorization"), requestId);

    // 2. Parse and validate body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid JSON in request body.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const parseResult = ThinkRequestSchema.safeParse(body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: issue ? `${issue.path.join(".")}: ${issue.message}` : "Validation failed.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    const { conversation_id, question } = parseResult.data;

    // 3. Coordinate think pipeline
    const result = await thinkAgent(agent, conversation_id, question, requestId);

    return NextResponse.json(result, { status: 200 });
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
      msg: `Unexpected error in POST /api/agent/think: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal server error.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
