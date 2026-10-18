import { NextResponse } from "next/server";
import { logger, newRequestId } from "@/lib/logger";

export async function GET() {
  const requestId = newRequestId();

  logger.info({
    msg: "healthz check passed",
    request_id: requestId,
    route: "/api/healthz",
  });

  return NextResponse.json({
    status: "ok",
    request_id: requestId,
  });
}
