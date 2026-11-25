import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnerAgent, activateAgent, ClaimError } from "@/server/identity/claim";
import { checkRateLimit } from "@/server/identity/rate_limit";
import {
  validateTweetUrl,
  fetchOEmbed,
  verifyTweetMatching,
} from "@/server/identity/tweet_verifier";
import { VerifyTweetRequestSchema } from "@/types/agent";
import { newRequestId, logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const requestId = newRequestId();

  try {
    // 1. Authenticated session owner only
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "You must be signed in to verify your claim tweet.",
            request_id: requestId,
          },
        },
        { status: 401 },
      );
    }

    // 2. Rate limit: 10 attempts per minute per user
    const rateCheck = checkRateLimit(`verify_tweet:${user.id}`, 10, 60_000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many verification attempts. Please wait a moment before trying again.",
            request_id: requestId,
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateCheck.retryAfterSeconds),
          },
        },
      );
    }

    // 3. Parse JSON payload
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

    const parseResult = VerifyTweetRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: parseResult.error.issues[0]?.message ?? "tweet_url is required.",
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    // 4. Validate URL format (status URL only, profile URLs rejected with 400)
    const urlValidation = validateTweetUrl(parseResult.data.tweet_url);
    if (!urlValidation.valid) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_TWEET_URL",
            message: urlValidation.reason,
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }

    // 5. Retrieve owner agent
    const agent = await getOwnerAgent(user.id, requestId);
    if (!agent) {
      return NextResponse.json(
        {
          error: {
            code: "AGENT_NOT_FOUND",
            message: "No agent found for this owner.",
            request_id: requestId,
          },
        },
        { status: 404 },
      );
    }

    // 6. Fetch oEmbed payload server-side
    let oEmbedRes: { status: number; data: unknown };
    try {
      oEmbedRes = await fetchOEmbed(urlValidation.canonicalUrl, 8000);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Error contacting X";
      logger.warn({
        msg: `oEmbed fetch failed for ${urlValidation.canonicalUrl}: ${errMsg}`,
        request_id: requestId,
        owner_id: user.id,
      });
      return NextResponse.json(
        {
          verified: false,
          reason: "Verification timed out connecting to X. Please check your link and try again.",
          request_id: requestId,
        },
        { status: 200 },
      );
    }

    // 7. Verify post existence, author match, and claim token
    const expectedXHandle = agent.x_handle || agent.display_name || agent.handle;
    const matchingResult = verifyTweetMatching({
      oEmbedStatus: oEmbedRes.status,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      oEmbedData: oEmbedRes.data as any,
      expectedXHandle,
      expectedAgentHandle: agent.handle,
    });

    if (!matchingResult.verified) {
      return NextResponse.json(
        {
          verified: false,
          reason: matchingResult.reason,
          request_id: requestId,
        },
        { status: 200 },
      );
    }

    // 8. Verified -> activate agent
    const { agent: activatedAgent } = await activateAgent(user.id, requestId);

    logger.info({
      msg: `Agent @${agent.handle} verified and activated via tweet ${urlValidation.canonicalUrl}`,
      request_id: requestId,
      owner_id: user.id,
    });

    return NextResponse.json({
      verified: true,
      agent: activatedAgent,
      request_id: requestId,
    });
  } catch (err: unknown) {
    if (err instanceof ClaimError) {
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
      msg: `Unexpected error in verify-tweet: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });

    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred during tweet verification.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
