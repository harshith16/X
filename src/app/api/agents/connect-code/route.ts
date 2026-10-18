import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createConnectCode, RelayError } from "@/server/relay/service";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
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
            message: "You must be signed in to generate a connect code.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    const { code, expires_at } = await createConnectCode(user.id, requestId);

    return NextResponse.json(
      {
        ok: true,
        code,
        expires_at,
        request_id: requestId,
      },
      { status: 201 },
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
      msg: `Unexpected error generating connect code: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to generate connect code.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
