import { NextResponse } from "next/server";
import { logger, newRequestId } from "@/lib/logger";
import { getServiceClient } from "@/server/db/clients";

export async function GET() {
  const requestId = newRequestId();

  try {
    const supabase = getServiceClient();

    // 5-second timeout for database reachability check
    const timeoutPromise = new Promise<{ error: Error }>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Database check timed out after 5000ms"));
      }, 5000);
      timer.unref?.();
    });

    const queryPromise = supabase.from("users").select("id").limit(1);

    const result = (await Promise.race([queryPromise, timeoutPromise])) as {
      error: unknown;
    };

    if (result.error) {
      throw result.error;
    }

    logger.info({
      msg: "readyz check passed",
      request_id: requestId,
      route: "/api/readyz",
    });

    return NextResponse.json({
      status: "ready",
      request_id: requestId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "database unreachable";
    logger.error({
      msg: `readyz check failed: ${message}`,
      request_id: requestId,
      route: "/api/readyz",
    });

    return NextResponse.json(
      {
        error: {
          code: "not_ready",
          message: "database unreachable",
          request_id: requestId,
        },
      },
      { status: 503 },
    );
  }
}
